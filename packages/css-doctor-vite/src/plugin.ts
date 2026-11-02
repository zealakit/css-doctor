import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { performance } from "node:perf_hooks";

import { createFilter } from "@rollup/pluginutils";
import { analyzeCss, optimizeCss } from "@zealakit/css-doctor-binding";
import type {
  JsCssAnalysisResult,
  JsSelectorStat,
} from "@zealakit/css-doctor-binding";
import type { Plugin } from "vite";

import { printDiagnostics } from "./reporter";
import type {
  CssAssetDiagnostic,
  CssAssetWarning,
  CssDoctorDiagnostics,
  CssDoctorViteOptions,
  EmittedCssChunk,
  EmittedPageChunk,
  PageCoverageOptions,
  SizeBudgetOptions,
} from "./types";

const DEFAULT_MIN_PAGE_RATIO = 0.5;
const DEFAULT_MAX_CHUNK_SIZE = 60 * 1_024;
const LARGE_CSS_ASSET_BYTES = 500 * 1_024;

type CssAssetLike = {
  type: "asset";
  fileName: string;
  source: string | Uint8Array;
};

type ViteChunkLike = {
  type: "chunk";
  fileName: string;
  name: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  code: string;
  modules: Record<string, unknown>;
  imports: string[];
  dynamicImports: string[];
  viteMetadata?: {
    importedCss?: Set<string>;
  };
};

type PageInfo = {
  name: string;
  classes: Set<string>;
  cssFiles: Set<string>;
  chunkFile: string | null;
};

type EmitAsset = {
  type: "asset";
  name?: string;
  fileName?: string;
  source: string | Uint8Array;
};

type AnalysisEnvironment = {
  getModuleInfo: (id: string) => { code?: string | null } | null;
  emitFile: (asset: EmitAsset) => string;
  getFileName: (referenceId: string) => string;
};

/**
 * Creates a Vite plugin that splits emitted CSS by page coverage and removes
 * selectors that no scanned page uses.
 *
 * The plugin is read-only with respect to existing assets except for replacing
 * their contents with the common chunk. New page-specific files are emitted
 * with `this.emitFile`. Read, parse, split and callback failures are contained
 * so the user's build is never interrupted.
 */
export function cssDoctor(options: CssDoctorViteOptions = {}): Plugin {
  const pageCoverage: PageCoverageOptions = {
    enabled: options.pageCoverage?.enabled ?? true,
    minPageRatio:
      options.pageCoverage?.minPageRatio ??
      options.minPageRatio ??
      DEFAULT_MIN_PAGE_RATIO,
    forceCommon:
      options.pageCoverage?.forceCommon ?? options.forceCommonSelectors ?? [],
  };
  const sizeBudget: SizeBudgetOptions = {
    enabled: options.sizeBudget?.enabled ?? true,
    maxChunkSize: options.sizeBudget?.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE,
    isolateVariables: options.sizeBudget?.isolateVariables ?? true,
  };
  const report = options.report ?? true;
  const minPageRatio = pageCoverage.minPageRatio ?? DEFAULT_MIN_PAGE_RATIO;
  const maxChunkSize = sizeBudget.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
  let base = "/";
  let minify = options.minify ?? true;

  if (!Number.isFinite(minPageRatio) || minPageRatio < 0 || minPageRatio > 1) {
    throw new RangeError(
      "css-doctor: minPageRatio must be a number between 0 and 1",
    );
  }

  if (
    !Number.isFinite(maxChunkSize) ||
    !Number.isInteger(maxChunkSize) ||
    maxChunkSize <= 0
  ) {
    throw new RangeError("css-doctor: maxChunkSize must be a positive integer");
  }

  const filter = createFilter(options.include, options.exclude, {
    resolve: false,
  });

  return {
    name: "vite-plugin-css-doctor",
    apply: "build",
    enforce: "post",

    config(config) {
      if (options.minify === false) {
        config.build ??= {};
        config.build.cssMinify = false;
      }
    },

    configResolved(config) {
      base = config.base;
      minify =
        options.minify ??
        (config.mode === "production" || config.command === "build");
    },

    async generateBundle(_outputOptions, bundle) {
      try {
        const diagnostics = await analyzeAndSplit(
          bundle,
          {
            getModuleInfo: (id) => this.getModuleInfo(id),
            emitFile: (asset) => this.emitFile(asset),
            getFileName: (referenceId) => this.getFileName(referenceId),
          },
          {
            filter,
            pageCoverage: {
              enabled: pageCoverage.enabled ?? true,
              minPageRatio,
              forceCommon: pageCoverage.forceCommon ?? [],
            },
            sizeBudget: {
              enabled: sizeBudget.enabled ?? true,
              maxChunkSize,
              isolateVariables: sizeBudget.isolateVariables ?? true,
            },
            directPageUsage: options.pageUsage,
            base,
            minify,
            skipVueScopedStyles: options.skipVueScopedStyles ?? false,
            wrapCommonImports: options.wrapCommonImports ?? false,
          },
        );

        if (options.onDiagnostics) {
          try {
            await options.onDiagnostics(diagnostics);
          } catch (error) {
            const message = `onDiagnostics callback failed: ${describeError(error)}`;
            diagnostics.errors.push(message);
            this.warn(`[css-doctor] ${message}`);
          }
        }

        if (
          report &&
          (diagnostics.totalCssAssets > 0 || diagnostics.errors.length > 0)
        ) {
          printDiagnostics(diagnostics);
        }
      } catch (error) {
        this.warn(
          `[css-doctor] diagnostics failed without interrupting the build: ${describeError(error)}`,
        );
      }
    },
  };
}

type SplitOptions = {
  filter: (id: string) => boolean;
  pageCoverage: Required<PageCoverageOptions> & { forceCommon: string[] };
  sizeBudget: Required<SizeBudgetOptions>;
  directPageUsage: Record<string, string[]> | undefined;
  base: string;
  minify: boolean;
  skipVueScopedStyles: boolean;
  wrapCommonImports: boolean;
};

async function analyzeAndSplit(
  bundle: Record<string, unknown>,
  environment: AnalysisEnvironment,
  options: SplitOptions,
): Promise<CssDoctorDiagnostics> {
  const startedAt = performance.now();
  const { pages, pagesByCss } = await collectPages(
    bundle,
    environment.getModuleInfo,
    options.directPageUsage,
  );
  const pageNames = pages.map((page) => page.name);
  const pageNameSet = new Set(pageNames);
  const pageChunkFiles = new Map<string, string>();

  for (const page of pages) {
    if (page.chunkFile) {
      pageChunkFiles.set(page.name, page.chunkFile);
    }
  }
  const pageUsage: Record<string, string[]> = {};
  const pageUsageCounts: Record<string, number> = {};

  for (const page of pages) {
    const classes = [...page.classes].sort();
    pageUsage[page.name] = classes;
    pageUsageCounts[page.name] = classes.length;
  }

  const splitApplied = options.pageCoverage.enabled && pageNames.length > 0;
  const diagnostics: CssDoctorDiagnostics = {
    plugin: "vite-plugin-css-doctor",
    generatedAt: new Date().toISOString(),
    durationMs: 0,
    minPageRatio: options.pageCoverage.minPageRatio,
    minify: options.minify,
    pageCoverage: {
      enabled: options.pageCoverage.enabled,
      minPageRatio: options.pageCoverage.minPageRatio,
    },
    sizeBudget: {
      enabled: options.sizeBudget.enabled,
      maxChunkSize: options.sizeBudget.maxChunkSize,
      isolateVariables: options.sizeBudget.isolateVariables,
      splitChunks: 0,
      oversizedChunks: 0,
    },
    pages: pageNames,
    pageUsage: pageUsageCounts,
    splitApplied,
    totalCssAssets: 0,
    analyzedCssAssets: 0,
    skippedCssAssets: 0,
    failedCssAssets: 0,
    totalSizeBeforeBytes: 0,
    totalSizeAfterBytes: 0,
    totalSelectors: 0,
    totalRules: 0,
    commonCssBytes: 0,
    pageSpecificCssBytes: 0,
    emittedPageChunks: [],
    emittedCssChunks: [],
    usageMatrix: [],
    deadCodeCount: 0,
    files: [],
    errors: [],
  };

  const matrix = new Map<string, JsSelectorStat>();
  const htmlLinks: string[] = [];
  const commonFileNames: string[] = [];
  const pageCssFiles = new Map<string, string[]>();

  for (const output of Object.values(bundle)) {
    if (!isCssAsset(output)) {
      continue;
    }

    diagnostics.totalCssAssets += 1;

    if (!options.filter(output.fileName)) {
      diagnostics.skippedCssAssets += 1;
      continue;
    }

    if (isCssModuleAsset(output.fileName, sourceToCss(output.source))) {
      diagnostics.skippedCssAssets += 1;
      continue;
    }

    if (
      options.skipVueScopedStyles &&
      isVueScopedAsset(sourceToCss(output.source))
    ) {
      diagnostics.skippedCssAssets += 1;
      continue;
    }

    const associatedPages = [
      ...(pagesByCss.get(output.fileName) ?? pageNameSet),
    ].sort();

    const file = analyzeAsset(output, associatedPages);

    if (file.error) {
      diagnostics.failedCssAssets += 1;
      diagnostics.errors.push(`${file.fileName}: ${file.error}`);
      diagnostics.files.push(file);
      continue;
    }

    const originalContent = sourceToCss(output.source);

    try {
      const pipeline = optimizeCss({
        cssContent: originalContent,
        pageUsage,
        pageCoverage: {
          enabled: options.pageCoverage.enabled,
          minPageRatio: options.pageCoverage.minPageRatio,
          forceCommon: options.pageCoverage.forceCommon,
        },
        sizeBudget: {
          enabled: options.sizeBudget.enabled,
          maxChunkSize: options.sizeBudget.maxChunkSize,
          isolateVariables: options.sizeBudget.isolateVariables,
        },
        minify: options.minify,
      });

      const commonChunks = pipeline.chunks.filter(
        (chunk) => chunk.page === undefined && chunk.sourceChunk === "common",
      );
      const pageChunks = pipeline.chunks.filter(
        (chunk) => chunk.page !== undefined,
      );
      const commonWasSplit =
        commonChunks.length > 1 ||
        commonChunks.some((chunk) => chunk.splitDueToSize);
      const embeddedCommon = commonWasSplit ? undefined : commonChunks[0];

      output.source = embeddedCommon?.css ?? "";
      file.sizeAfterBytes = Buffer.byteLength(output.source, "utf8");

      let commonSizeBytes = 0;
      let pageSpecificSizeBytes = 0;

      for (const chunk of commonChunks) {
        const embedded = chunk === embeddedCommon;
        const fileName = embedded
          ? output.fileName
          : emitCssAsset(environment, `${chunk.name}.css`, chunk.css);
        commonSizeBytes += chunk.sizeBytes;

        if (!embedded) {
          htmlLinks.push(fileName);
          commonFileNames.push(fileName);
        }

        diagnostics.emittedCssChunks.push({
          fileName,
          sourceChunk: chunk.sourceChunk,
          kind: chunk.kind as EmittedCssChunk["kind"],
          page: chunk.page,
          variables: chunk.variables,
          part: chunk.part,
          sizeBytes: chunk.sizeBytes,
          oversized: chunk.oversized,
          splitDueToSize: chunk.splitDueToSize,
          embedded,
        });

        if (chunk.splitDueToSize) {
          diagnostics.sizeBudget.splitChunks += 1;
        }

        if (chunk.oversized) {
          diagnostics.sizeBudget.oversizedChunks += 1;
        }
      }

      if (options.wrapCommonImports && commonWasSplit) {
        output.source = commonFileNames
          .map((fileName) => `@import "./${basename(fileName)}";`)
          .join("\n");
      }

      for (const chunk of pageChunks) {
        const page = chunk.page;

        if (!page) {
          continue;
        }

        const fileName = emitCssAsset(
          environment,
          `${chunk.name}.css`,
          chunk.css,
        );
        pageSpecificSizeBytes += chunk.sizeBytes;
        const files = pageCssFiles.get(page) ?? [];
        files.push(fileName);
        pageCssFiles.set(page, files);

        const emittedPage: EmittedPageChunk = {
          page,
          fileName,
          sizeBytes: chunk.sizeBytes,
        };

        diagnostics.emittedPageChunks.push(emittedPage);
        diagnostics.emittedCssChunks.push({
          fileName,
          sourceChunk: chunk.sourceChunk,
          kind: chunk.kind as EmittedCssChunk["kind"],
          page,
          variables: chunk.variables,
          part: chunk.part,
          sizeBytes: chunk.sizeBytes,
          oversized: chunk.oversized,
          splitDueToSize: chunk.splitDueToSize,
          embedded: false,
        });

        if (chunk.splitDueToSize) {
          diagnostics.sizeBudget.splitChunks += 1;
        }

        if (chunk.oversized) {
          diagnostics.sizeBudget.oversizedChunks += 1;
        }
      }

      file.sizeAfterBytes = commonWasSplit
        ? commonSizeBytes
        : Buffer.byteLength(output.source, "utf8");
      file.split = {
        associatedPages,
        commonSizeBytes,
        pageSpecificSizeBytes,
        deadCodeCount: pipeline.deadCodeCount,
      };

      for (const stat of pipeline.stats) {
        const previous = matrix.get(stat.selector);

        if (!previous || stat.totalOccurrences > previous.totalOccurrences) {
          matrix.set(stat.selector, stat);
        }
      }

      diagnostics.deadCodeCount += pipeline.deadCodeCount;
      diagnostics.commonCssBytes += commonSizeBytes;
      diagnostics.pageSpecificCssBytes += pageSpecificSizeBytes;
    } catch (error) {
      diagnostics.errors.push(
        `${file.fileName}: failed to optimize CSS: ${describeError(error)}`,
      );
    }

    diagnostics.analyzedCssAssets += 1;
    diagnostics.totalSizeBeforeBytes += file.sizeBeforeBytes;
    diagnostics.totalSizeAfterBytes += file.sizeAfterBytes;
    diagnostics.totalSelectors += file.selectorCount;
    diagnostics.totalRules += file.ruleCount;
    diagnostics.files.push(file);
  }

  if (htmlLinks.length > 0) {
    injectStylesheetLinks(bundle, htmlLinks, options.base);
  }

  if (pageCssFiles.size > 0) {
    injectPageChunkStyles(bundle, pageCssFiles, pageChunkFiles, options.base);
  }

  diagnostics.usageMatrix = [...matrix.values()].sort((left, right) =>
    left.selector.localeCompare(right.selector),
  );
  diagnostics.durationMs = roundMs(performance.now() - startedAt);

  return diagnostics;
}

function emitCssAsset(
  environment: AnalysisEnvironment,
  name: string,
  source: string,
): string {
  const referenceId = environment.emitFile({
    type: "asset",
    name,
    source,
  });

  return environment.getFileName(referenceId);
}

function injectPageChunkStyles(
  bundle: Record<string, unknown>,
  cssByPage: Map<string, string[]>,
  chunkByPage: Map<string, string>,
  base: string,
): void {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;

  for (const [page, fileNames] of cssByPage) {
    if (fileNames.length === 0) {
      continue;
    }

    const chunkFile = chunkByPage.get(page);
    const hrefs = fileNames.map((fileName) => `${normalizedBase}${fileName}`);
    const htmlOutput = findPageHtmlAsset(bundle, page);
    const output = htmlOutput ?? (chunkFile ? bundle[chunkFile] : undefined);

    if (isHtmlAsset(output)) {
      const tags = hrefs
        .map(
          (href) =>
            `    <link rel="stylesheet" href="${href}" data-css-doctor-page>`,
        )
        .join("\n");

      if (!output.source.includes(tags) && output.source.includes("</head>")) {
        output.source = output.source.replace("</head>", `${tags}\n  </head>`);
      }
      continue;
    }

    if (!isChunk(output)) {
      continue;
    }

    const snippet = `(()=>{const __cssDoctorPageStyles=${JSON.stringify(hrefs)};if(typeof document!=="undefined"){for(const __cssDoctorPageHref of __cssDoctorPageStyles){if(!Array.from(document.querySelectorAll("link[data-css-doctor-page]")).some((link)=>link.dataset.cssDoctorPage===__cssDoctorPageHref)){const __cssDoctorPageLink=document.createElement("link");__cssDoctorPageLink.rel="stylesheet";__cssDoctorPageLink.href=__cssDoctorPageHref;__cssDoctorPageLink.dataset.cssDoctorPage=__cssDoctorPageHref;document.head.append(__cssDoctorPageLink);}}}})();\n`;

    output.code = snippet + output.code;
  }
}

function injectStylesheetLinks(
  bundle: Record<string, unknown>,
  fileNames: string[],
  base: string,
): void {
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const tags = fileNames
    .map(
      (fileName) =>
        `    <link rel="stylesheet" href="${normalizedBase}${fileName}">`,
    )
    .join("\n");

  for (const output of Object.values(bundle)) {
    if (!isHtmlAsset(output) || output.source.includes(tags)) {
      continue;
    }

    if (output.source.includes("</head>")) {
      output.source = output.source.replace("</head>", `${tags}\n  </head>`);
    }
  }
}

function findPageHtmlAsset(
  bundle: Record<string, unknown>,
  page: string,
): unknown {
  const names =
    page === "index"
      ? ["index.html"]
      : [
          `page-${page}/index.html`,
          `page-${page}.html`,
          `${page}/index.html`,
          `${page}.html`,
        ];

  for (const name of names) {
    const output = bundle[name];

    if (isHtmlAsset(output)) {
      return output;
    }
  }

  return undefined;
}

function isHtmlAsset(
  value: unknown,
): value is { type: "asset"; fileName: string; source: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    type?: unknown;
    fileName?: unknown;
    source?: unknown;
  };

  return (
    candidate.type === "asset" &&
    typeof candidate.fileName === "string" &&
    candidate.fileName.endsWith(".html") &&
    typeof candidate.source === "string"
  );
}

function analyzeAsset(
  output: CssAssetLike,
  associatedPages: string[],
): CssAssetDiagnostic {
  const analysisStartedAt = performance.now();

  try {
    const css = sourceToCss(output.source);
    const sizeBeforeBytes = Buffer.byteLength(css, "utf8");
    const analysis = analyzeCss(css);
    const warnings = collectSyntaxWarnings(analysis);

    if (sizeBeforeBytes >= LARGE_CSS_ASSET_BYTES) {
      warnings.push({
        kind: "large-asset",
        message:
          `CSS asset is larger than ${formatBytes(LARGE_CSS_ASSET_BYTES)}; ` +
          "consider route-level code splitting.",
      });
    }

    return {
      fileName: output.fileName,
      sizeBeforeBytes,
      sizeAfterBytes: sizeBeforeBytes,
      selectorCount: analysis.stats.selectorCount,
      ruleCount: analysis.stats.ruleCount,
      declarationCount: analysis.stats.declarationCount,
      importantDeclarationCount: analysis.stats.importantDeclarationCount,
      uniqueClassCount: analysis.stats.uniqueClassCount,
      uniqueIdCount: analysis.stats.uniqueIdCount,
      uniqueTagCount: analysis.stats.uniqueTagCount,
      syntaxWarningCount: analysis.warnings.length,
      analysisMs: roundMs(performance.now() - analysisStartedAt),
      associatedPages,
      warnings,
      analysis,
    };
  } catch (error) {
    return {
      fileName: output.fileName,
      sizeBeforeBytes: 0,
      sizeAfterBytes: 0,
      selectorCount: 0,
      ruleCount: 0,
      declarationCount: 0,
      importantDeclarationCount: 0,
      uniqueClassCount: 0,
      uniqueIdCount: 0,
      uniqueTagCount: 0,
      syntaxWarningCount: 0,
      analysisMs: roundMs(performance.now() - analysisStartedAt),
      associatedPages,
      warnings: [],
      error: describeError(error),
    };
  }
}

async function collectPages(
  bundle: Record<string, unknown>,
  getModuleInfo: AnalysisEnvironment["getModuleInfo"],
  directPageUsage: Record<string, string[]> | undefined,
): Promise<{
  pages: PageInfo[];
  pagesByCss: Map<string, Set<string>>;
}> {
  const chunks = Object.values(bundle).filter(isChunk);
  const chunksByFileName = new Map(
    chunks.map((chunk) => [chunk.fileName, chunk]),
  );
  const pages = new Map<string, PageInfo>();
  const entryFileNames = new Set(
    chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName),
  );

  for (const entry of chunks.filter((chunk) => chunk.isEntry)) {
    if (isInternalPageEntry(entry)) {
      continue;
    }

    const shell = collectChunkContent(
      entry,
      chunksByFileName,
      getModuleInfo,
      false,
    );

    if (entry.facadeModuleId && isHtmlFile(entry.facadeModuleId)) {
      try {
        scanClasses(
          await readFile(entry.facadeModuleId, "utf8"),
          shell.classes,
        );
      } catch {
        // The HTML source may be virtual or removed by another plugin. The
        // generated chunk code and pageUsage option still provide coverage.
      }
    }

    const routeChunks = entry.dynamicImports
      .map((fileName) => chunksByFileName.get(fileName))
      .filter((chunk): chunk is ViteChunkLike => chunk !== undefined);

    if (routeChunks.length > 0) {
      // A SPA shell usually owns the HTML, navigation and global CSS, while
      // every direct dynamic import is a route. Treat those chunks as pages
      // and apply the shell classes/CSS to each one, instead of collapsing all
      // routes into the single index entry.
      for (const routeChunk of routeChunks) {
        const page: PageInfo = {
          name: uniquePageName(cleanPageName(routePageName(routeChunk)), pages),
          classes: new Set(shell.classes),
          cssFiles: new Set(shell.cssFiles),
          chunkFile: routeChunk.fileName,
        };
        const route = collectChunkContent(
          routeChunk,
          chunksByFileName,
          getModuleInfo,
          true,
          entryFileNames,
        );

        for (const className of route.classes) {
          page.classes.add(className);
        }

        for (const cssFile of route.cssFiles) {
          page.cssFiles.add(cssFile);
        }

        pages.set(page.name, page);
      }

      continue;
    }

    const page: PageInfo = {
      name: uniquePageName(cleanPageName(pageNameFor(entry)), pages),
      classes: new Set(shell.classes),
      cssFiles: new Set(shell.cssFiles),
      chunkFile: entry.fileName,
    };

    pages.set(page.name, page);
  }

  if (directPageUsage) {
    for (const [rawName, classes] of Object.entries(directPageUsage)) {
      const name = rawName.trim();

      if (name.length === 0) {
        continue;
      }

      let page = pages.get(name);

      if (!page) {
        page = {
          name,
          classes: new Set(),
          cssFiles: new Set(),
          chunkFile: null,
        };
        pages.set(name, page);
      }

      for (const className of classes) {
        page.classes.add(className.toLowerCase());
      }
    }
  }

  const pagesByCss = new Map<string, Set<string>>();

  for (const page of pages.values()) {
    for (const cssFile of page.cssFiles) {
      const owners = pagesByCss.get(cssFile) ?? new Set<string>();
      owners.add(page.name);
      pagesByCss.set(cssFile, owners);
    }
  }

  return {
    pages: [...pages.values()],
    pagesByCss,
  };
}

function collectChunkContent(
  startChunk: ViteChunkLike,
  chunksByFileName: Map<string, ViteChunkLike>,
  getModuleInfo: AnalysisEnvironment["getModuleInfo"],
  includeDynamicImports: boolean,
  skipFileNames: ReadonlySet<string> = new Set<string>(),
): {
  classes: Set<string>;
  cssFiles: Set<string>;
} {
  const classes = new Set<string>();
  const cssFiles = new Set<string>();
  const visited = new Set<string>();
  const stack = [startChunk.fileName];

  while (stack.length > 0) {
    const fileName = stack.pop();

    if (!fileName || visited.has(fileName) || skipFileNames.has(fileName)) {
      continue;
    }

    visited.add(fileName);

    const chunk = chunksByFileName.get(fileName);

    if (!chunk) {
      continue;
    }

    scanClasses(chunk.code, classes);

    for (const moduleId of Object.keys(chunk.modules)) {
      if (isStyleModule(moduleId)) {
        continue;
      }

      const moduleInfo = getModuleInfo(moduleId);

      if (moduleInfo?.code) {
        scanClasses(moduleInfo.code, classes);
      }
    }

    for (const cssFile of chunk.viteMetadata?.importedCss ?? []) {
      cssFiles.add(cssFile);
    }

    stack.push(...chunk.imports);

    if (includeDynamicImports) {
      stack.push(...chunk.dynamicImports);
    }
  }

  return { classes, cssFiles };
}

function scanClasses(source: string, classes: Set<string>): void {
  const patterns = [
    /(?:class|className)\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g,
    /(?:^|[,{;\s])(?:class|className)\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g,
    /classList\.(?:add|remove|toggle|contains)\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[1] ?? match[2] ?? match[3];

      if (!value) {
        continue;
      }

      for (const token of value.split(/\s+/)) {
        if (/^-?[_a-zA-Z][\w-]*$/.test(token)) {
          classes.add(token.toLowerCase());
        }
      }
    }
  }
}

function isInternalPageEntry(chunk: ViteChunkLike): boolean {
  const name = pageNameFor(chunk);

  return (
    name.startsWith("_") ||
    name.startsWith("noop-") ||
    name.includes("@astro-renderers")
  );
}

function cleanPageName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/@_@[a-z]+$/i, "")
    .replace(/^page-/, "");

  return normalized || "page";
}

function routePageName(chunk: ViteChunkLike): string {
  const name = pageNameFor(chunk).toLowerCase();

  return name.startsWith("page-") ? name.slice("page-".length) : name;
}

function isCssModuleAsset(fileName: string, css: string): boolean {
  if (/\.module\.(css|scss|sass|less|styl|stylus)$/i.test(fileName)) {
    return true;
  }

  // Vite's default CSS Modules local identifier is `_local_hash_index`
  // (for example `_card_1udun_1`). The emitted asset name is hashed, so
  // detect the scoped class shape in the source as a safety boundary.
  return /\.[A-Za-z0-9_-]+_[A-Za-z0-9]{5,}_[0-9]+/.test(css);
}

function isVueScopedAsset(css: string): boolean {
  return /\[data-v-[0-9a-f]+\]/.test(css);
}

function pageNameFor(chunk: ViteChunkLike): string {
  if (chunk.name.length > 0) {
    return chunk.name;
  }

  if (chunk.facadeModuleId) {
    return basename(chunk.facadeModuleId, extname(chunk.facadeModuleId));
  }

  return chunk.fileName.replace(/\.[^.]+$/, "");
}

function uniquePageName(base: string, pages: Map<string, PageInfo>): string {
  const normalized = base.trim() || "page";

  if (!pages.has(normalized)) {
    return normalized;
  }

  let index = 2;

  while (pages.has(`${normalized}-${index}`)) {
    index += 1;
  }

  return `${normalized}-${index}`;
}

function isCssAsset(value: unknown): value is CssAssetLike {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    type?: unknown;
    fileName?: unknown;
    source?: unknown;
  };

  return (
    candidate.type === "asset" &&
    typeof candidate.fileName === "string" &&
    candidate.fileName.endsWith(".css") &&
    (typeof candidate.source === "string" ||
      candidate.source instanceof Uint8Array)
  );
}

function isChunk(value: unknown): value is ViteChunkLike {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as {
    type?: unknown;
    fileName?: unknown;
    name?: unknown;
    isEntry?: unknown;
    facadeModuleId?: unknown;
    code?: unknown;
    modules?: unknown;
    imports?: unknown;
    dynamicImports?: unknown;
  };

  return (
    candidate.type === "chunk" &&
    typeof candidate.fileName === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.isEntry === "boolean" &&
    typeof candidate.code === "string" &&
    typeof candidate.modules === "object" &&
    candidate.modules !== null &&
    Array.isArray(candidate.imports) &&
    Array.isArray(candidate.dynamicImports)
  );
}

function isStyleModule(moduleId: string): boolean {
  return /\.(css|scss|sass|less|styl|stylus)(\?|$)/i.test(moduleId);
}

function isHtmlFile(moduleId: string): boolean {
  return /\.(html?|vue)$/i.test(moduleId);
}

function collectSyntaxWarnings(
  analysis: JsCssAnalysisResult,
): CssAssetWarning[] {
  return analysis.warnings.map((warning) => ({
    kind: "syntax",
    message: warning.message,
    ...(warning.location
      ? {
          line: warning.location.line,
          column: warning.location.column,
        }
      : {}),
  }));
}

function sourceToCss(source: string | Uint8Array): string {
  return typeof source === "string"
    ? source
    : Buffer.from(source).toString("utf8");
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) {
    return `${bytes} B`;
  }

  if (bytes < 1_024 * 1_024) {
    return `${(bytes / 1_024).toFixed(1)} KB`;
  }

  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

function roundMs(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
