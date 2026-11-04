import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { posix } from "node:path";
import { performance } from "node:perf_hooks";

import { analyzeCss, optimizeCss } from "@zealakit/css-doctor-binding";
import type {
  JsChunkOutput,
  JsSelectorStat,
} from "@zealakit/css-doctor-binding";
import type { Compilation, Compiler } from "@rspack/core";

import { printReport } from "./reporter";
import type {
  ChunkInfo,
  CssAssetDiagnostic,
  CssDoctorRsbuildDiagnostics,
  CssDoctorRsbuildOptions,
  EmittedCssChunk,
  PageCoverageOptions,
  SizeBudgetOptions,
} from "./types";

const PLUGIN_NAME = "css-doctor:rsbuild";
const DEFAULT_MIN_PAGE_RATIO = 0.5;
const DEFAULT_MAX_CHUNK_SIZE = 60 * 1_024;

type RspackChunkLike = {
  name?: string;
  files?: Iterable<string>;
  auxiliaryFiles?: Iterable<string>;
};

type RspackEntrypointLike = {
  name?: string;
  chunks?: Iterable<RspackChunkLike>;
  getFiles?: () => Iterable<string>;
};

type RspackModuleLike = {
  resource?: string;
  modules?: Iterable<RspackModuleLike>;
  originalSource?: () => { source: () => unknown } | null;
};

type PageInfo = {
  name: string;
  classes: Set<string>;
  cssFiles: Set<string>;
  jsFiles: Set<string>;
};

type PagesResult = {
  pages: PageInfo[];
  pagesByCss: Map<string, Set<string>>;
};

type ResolvedOptions = {
  pageCoverage: Required<PageCoverageOptions> & { forceCommon: string[] };
  sizeBudget: Required<SizeBudgetOptions>;
  minify: boolean;
  report: boolean;
  include: Array<string | RegExp>;
  exclude: Array<string | RegExp>;
};

/**
 * Rspack compilation plugin that runs the css-doctor two-tier pipeline for
 * global CSS assets. CSS Modules assets are deliberately skipped.
 */
export class CssDoctorRspackPlugin {
  private readonly options: ResolvedOptions;
  private readonly configurationWarnings: string[] = [];

  constructor(options: CssDoctorRsbuildOptions = {}) {
    const configuredMinPageRatio =
      options.pageCoverage?.minPageRatio ?? DEFAULT_MIN_PAGE_RATIO;
    const configuredMaxChunkSize =
      options.sizeBudget?.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;

    const minPageRatio =
      Number.isFinite(configuredMinPageRatio) &&
      configuredMinPageRatio >= 0 &&
      configuredMinPageRatio <= 1
        ? configuredMinPageRatio
        : DEFAULT_MIN_PAGE_RATIO;
    const maxChunkSize =
      Number.isInteger(configuredMaxChunkSize) && configuredMaxChunkSize > 0
        ? configuredMaxChunkSize
        : DEFAULT_MAX_CHUNK_SIZE;

    if (minPageRatio !== configuredMinPageRatio) {
      this.configurationWarnings.push(
        "minPageRatio must be a number between 0 and 1; using 0.5",
      );
    }

    if (maxChunkSize !== configuredMaxChunkSize) {
      this.configurationWarnings.push(
        "maxChunkSize must be a positive integer; using 61440",
      );
    }

    this.options = {
      pageCoverage: {
        enabled: options.pageCoverage?.enabled ?? true,
        minPageRatio,
        forceCommon: options.pageCoverage?.forceCommon ?? [],
      },
      sizeBudget: {
        enabled: options.sizeBudget?.enabled ?? true,
        maxChunkSize,
        isolateVariables: options.sizeBudget?.isolateVariables ?? true,
      },
      minify: options.minify ?? true,
      report: options.report ?? true,
      include: options.include ?? [],
      exclude: options.exclude ?? [],
    };
  }

  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        {
          name: PLUGIN_NAME,
          stage: compiler.rspack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
        },
        async () => {
          try {
            await this.process(compiler, compilation);
          } catch (error) {
            compilation
              .getLogger(PLUGIN_NAME)
              .warn(
                `[css-doctor] diagnostics failed without interrupting the build: ${describeError(
                  error,
                )}`,
              );
          }
        },
      );
    });
  }

  private async process(
    compiler: Compiler,
    compilation: Compilation,
  ): Promise<void> {
    const startedAt = performance.now();
    const logger = compilation.getLogger(PLUGIN_NAME);
    for (const warning of this.configurationWarnings) {
      logger.warn(`[css-doctor] ${warning}`);
    }
    const pagesResult = await collectPages(compilation);
    const pageNames = pagesResult.pages.map((page) => page.name);
    const allPages = new Set(pageNames);
    const pageUsage: Record<string, string[]> = {};
    const pageUsageCounts: Record<string, number> = {};

    for (const page of pagesResult.pages) {
      const classes = [...page.classes].sort();
      pageUsage[page.name] = classes;
      pageUsageCounts[page.name] = classes.length;
    }

    const hasPageClasses = pagesResult.pages.some(
      (page) => page.classes.size > 0,
    );
    const pageCoverageApplied =
      this.options.pageCoverage.enabled && hasPageClasses;
    const diagnostics: CssDoctorRsbuildDiagnostics = {
      plugin: PLUGIN_NAME,
      generatedAt: new Date().toISOString(),
      durationMs: 0,
      totalOriginalSize: 0,
      totalOptimizedSize: 0,
      deadCodeSelectorsCount: 0,
      chunks: [],
      minify: this.options.minify,
      pages: pageNames,
      pageUsage: pageUsageCounts,
      splitApplied: pageCoverageApplied,
      totalCssAssets: 0,
      analyzedCssAssets: 0,
      skippedCssAssets: 0,
      failedCssAssets: 0,
      totalSelectors: 0,
      totalRules: 0,
      commonCssBytes: 0,
      pageSpecificCssBytes: 0,
      emittedPageChunks: [],
      emittedCssChunks: [],
      sizeBudget: {
        enabled: this.options.sizeBudget.enabled,
        maxChunkSize: this.options.sizeBudget.maxChunkSize,
        isolateVariables: this.options.sizeBudget.isolateVariables,
        splitChunks: 0,
        oversizedChunks: 0,
      },
      usageMatrix: [],
      files: [],
      errors: [],
    };

    const matrix = new Map<string, JsSelectorStat>();
    const pageFiles = new Map<string, string[]>();
    const usedAssetNames = new Set(
      compilation.getAssets().map((asset) => asset.name),
    );
    const RawSource = compiler.rspack.sources.RawSource;

    const emitCssChunk = (chunk: JsChunkOutput): string => {
      const hash = createHash("sha256")
        .update(chunk.css)
        .digest("hex")
        .slice(0, 8);
      const safeName =
        chunk.name
          .replace(/[^a-zA-Z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .toLowerCase() || "chunk";
      let fileName = `static/css/${safeName}.${hash}.css`;
      let index = 2;

      while (usedAssetNames.has(fileName)) {
        fileName = `static/css/${safeName}.${hash}-${index}.css`;
        index += 1;
      }

      compilation.emitAsset(fileName, new RawSource(chunk.css));
      usedAssetNames.add(fileName);
      return fileName;
    };

    for (const asset of compilation.getAssets()) {
      if (!asset.name.endsWith(".css")) {
        continue;
      }

      diagnostics.totalCssAssets += 1;

      if (
        this.shouldSkipAsset(asset.name, sourceToString(asset.source.source()))
      ) {
        diagnostics.skippedCssAssets += 1;
        continue;
      }

      const associatedPages = [
        ...(pagesResult.pagesByCss.get(asset.name) ?? allPages),
      ].sort();
      const originalCss = sourceToString(asset.source.source());
      const file = createDiagnostic(asset.name, originalCss, associatedPages);

      try {
        const analysis = analyzeCss(originalCss);
        file.selectorCount = analysis.stats.selectorCount;
        file.ruleCount = analysis.stats.ruleCount;
        const moduleClasses = collectCssModuleClasses(originalCss);
        const assetPageUsage =
          moduleClasses.length > 0
            ? withCommonClasses(pageUsage, moduleClasses)
            : pageUsage;
        const pipeline = optimizeCss({
          cssContent: originalCss,
          pageUsage: assetPageUsage,
          pageCoverage: {
            enabled: pageCoverageApplied,
            minPageRatio: this.options.pageCoverage.minPageRatio,
            forceCommon: this.options.pageCoverage.forceCommon,
          },
          sizeBudget: {
            enabled: this.options.sizeBudget.enabled,
            maxChunkSize: this.options.sizeBudget.maxChunkSize,
            isolateVariables: this.options.sizeBudget.isolateVariables,
          },
          minify: this.options.minify,
        });

        const commonChunks = pipeline.chunks.filter(
          (chunk) => chunk.page === undefined && chunk.sourceChunk === "common",
        );
        const pageChunks = pipeline.chunks.filter(
          (chunk) =>
            chunk.page !== undefined &&
            (associatedPages.includes(chunk.page) ||
              !pagesResult.pagesByCss.has(asset.name)),
        );
        const commonWasSplit =
          commonChunks.length > 1 ||
          commonChunks.some((chunk) => chunk.splitDueToSize);
        const embeddedCommon = commonWasSplit ? undefined : commonChunks[0];
        const commonFileNames: string[] = [];
        let commonSize = 0;

        for (const chunk of commonChunks) {
          const embedded = chunk === embeddedCommon;
          const fileName = embedded ? asset.name : emitCssChunk(chunk);
          commonSize += chunk.sizeBytes;
          commonFileNames.push(fileName);

          diagnostics.emittedCssChunks.push(
            toEmittedChunk(chunk, fileName, embedded),
          );

          if (chunk.splitDueToSize) {
            diagnostics.sizeBudget.splitChunks += 1;
          }

          if (chunk.oversized) {
            diagnostics.sizeBudget.oversizedChunks += 1;
          }
        }

        if (commonWasSplit) {
          const imports = commonFileNames
            .map((fileName) => {
              const relativePath = posix.relative(
                posix.dirname(asset.name),
                fileName,
              );
              return `@import "./${relativePath}";`;
            })
            .join("\n");
          compilation.updateAsset(asset.name, new RawSource(imports));
        } else {
          compilation.updateAsset(
            asset.name,
            new RawSource(embeddedCommon?.css ?? ""),
          );
        }

        let pageSpecificSize = 0;

        for (const chunk of pageChunks) {
          if (!chunk.page) {
            continue;
          }

          const fileName = emitCssChunk(chunk);
          pageSpecificSize += chunk.sizeBytes;
          const files = pageFiles.get(chunk.page) ?? [];
          files.push(fileName);
          pageFiles.set(chunk.page, files);

          diagnostics.emittedPageChunks.push({
            page: chunk.page,
            fileName,
            sizeBytes: chunk.sizeBytes,
          });
          diagnostics.emittedCssChunks.push(
            toEmittedChunk(chunk, fileName, false),
          );

          if (chunk.splitDueToSize) {
            diagnostics.sizeBudget.splitChunks += 1;
          }

          if (chunk.oversized) {
            diagnostics.sizeBudget.oversizedChunks += 1;
          }
        }

        file.sizeAfterBytes = commonWasSplit
          ? commonSize
          : Buffer.byteLength(embeddedCommon?.css ?? "", "utf8");
        file.deadCodeCount = pipeline.deadCodeCount;
        diagnostics.deadCodeSelectorsCount += pipeline.deadCodeCount;
        diagnostics.commonCssBytes += commonSize;
        diagnostics.pageSpecificCssBytes += pageSpecificSize;
        diagnostics.totalOriginalSize += file.sizeBeforeBytes;
        diagnostics.totalOptimizedSize += commonSize + pageSpecificSize;

        for (const stat of pipeline.stats) {
          const previous = matrix.get(stat.selector);

          if (!previous || stat.totalOccurrences > previous.totalOccurrences) {
            matrix.set(stat.selector, stat);
          }
        }
      } catch (error) {
        file.error = describeError(error);
        diagnostics.failedCssAssets += 1;
        diagnostics.errors.push(`${asset.name}: ${file.error}`);
        logger.warn(`[css-doctor] ${asset.name}: ${file.error}`);
      }

      diagnostics.analyzedCssAssets += 1;
      diagnostics.totalSelectors += file.selectorCount;
      diagnostics.totalRules += file.ruleCount;
      diagnostics.files.push(file);
    }

    if (pageFiles.size > 0) {
      injectPageCssLoaders(
        compilation,
        pageFiles,
        new Map(pagesResult.pages.map((page) => [page.name, page])),
        RawSource,
      );
    }

    diagnostics.chunks = diagnostics.emittedCssChunks.map(toChunkInfo);
    diagnostics.usageMatrix = [...matrix.values()].sort((left, right) =>
      left.selector.localeCompare(right.selector),
    );
    diagnostics.durationMs = roundMs(performance.now() - startedAt);

    if (
      this.options.report &&
      (diagnostics.totalCssAssets > 0 || diagnostics.errors.length > 0)
    ) {
      try {
        printReport(diagnostics);
      } catch (error) {
        logger.warn(`[css-doctor] reporter failed: ${describeError(error)}`);
      }
    }
  }

  private shouldSkipAsset(assetName: string, source: string): boolean {
    if (/\.module\.(css|scss|sass|less|styl|stylus)$/i.test(assetName)) {
      return true;
    }

    // Rspack may hash CSS Modules assets so the original `.module.css` name is
    // no longer present. Next/Rsbuild default local identifiers use `_local__hash`.
    if (/\.[A-Za-z0-9_-]+_[A-Za-z0-9_-]+__[A-Za-z0-9_-]+/.test(source)) {
      return true;
    }

    // Rsbuild/Rspack default CSS Modules local identifiers are
    // `<local>-<6-char-hash>`, e.g. `.card-Glm32v`.
    if (hasRsbuildCssModuleClass(source)) {
      return true;
    }

    if (this.options.include.length > 0) {
      if (!matchesPatterns(assetName, this.options.include)) {
        return true;
      }
    }

    return (
      this.options.exclude.length > 0 &&
      matchesPatterns(assetName, this.options.exclude)
    );
  }
}

function createDiagnostic(
  fileName: string,
  css: string,
  associatedPages: string[],
): CssAssetDiagnostic {
  return {
    fileName,
    sizeBeforeBytes: Buffer.byteLength(css, "utf8"),
    sizeAfterBytes: Buffer.byteLength(css, "utf8"),
    selectorCount: 0,
    ruleCount: 0,
    associatedPages,
    deadCodeCount: 0,
  };
}

function toEmittedChunk(
  chunk: JsChunkOutput,
  fileName: string,
  embedded: boolean,
): EmittedCssChunk {
  return {
    name: chunk.name,
    fileName,
    sourceChunk: chunk.sourceChunk,
    kind: chunk.kind as EmittedCssChunk["kind"],
    page: chunk.page,
    size: chunk.sizeBytes,
    isVariableChunk: chunk.variables,
    isPartChunk: chunk.part !== undefined,
    embedded,
    oversized: chunk.oversized,
    splitDueToSize: chunk.splitDueToSize,
  };
}

function toChunkInfo(chunk: EmittedCssChunk): ChunkInfo {
  return {
    name: chunk.name,
    size: chunk.size,
    isVariableChunk: chunk.isVariableChunk,
    isPartChunk: chunk.isPartChunk,
  };
}

async function collectPages(compilation: Compilation): Promise<PagesResult> {
  const pages: PageInfo[] = [];
  const pagesByCss = new Map<string, Set<string>>();
  const sourceCache = new Map<string, Promise<string | undefined>>();
  const entrypoints = compilation.entrypoints as ReadonlyMap<
    string,
    RspackEntrypointLike
  >;

  for (const [entryName, entry] of entrypoints) {
    const pageName = normalizePageName(entryName);
    const page: PageInfo = {
      name: pageName,
      classes: new Set<string>(),
      cssFiles: new Set<string>(),
      jsFiles: new Set<string>(),
    };

    const files = entryFiles(entry);
    for (const file of files) {
      if (file.endsWith(".css")) {
        if (!/\.module\.(css|scss|sass|less|styl|stylus)$/i.test(file)) {
          page.cssFiles.add(file);
        }
      } else if (file.endsWith(".js")) {
        page.jsFiles.add(file);
      }
    }

    for (const chunk of entry.chunks ?? []) {
      for (const file of chunk.files ?? []) {
        if (file.endsWith(".css")) {
          page.cssFiles.add(file);
        } else if (file.endsWith(".js")) {
          page.jsFiles.add(file);
        }
      }

      for (const module of chunkModules(compilation, chunk)) {
        await scanModule(module, page.classes, sourceCache);
      }
    }

    for (const cssFile of page.cssFiles) {
      const owners = pagesByCss.get(cssFile) ?? new Set<string>();
      owners.add(pageName);
      pagesByCss.set(cssFile, owners);
    }

    pages.push(page);
  }

  if (pages.length === 0) {
    pages.push({
      name: "main",
      classes: new Set<string>(),
      cssFiles: new Set<string>(),
      jsFiles: new Set<string>(),
    });
  }

  // Rsbuild SPA apps have one entrypoint and route pages in async chunks.
  // Replace the shell-only page with page chunks when they are discoverable.
  if (entrypoints.size === 1 && pages.length === 1) {
    const shell = pages[0];
    const entryChunks = new Set<RspackChunkLike>();

    for (const [, entry] of entrypoints) {
      for (const chunk of entry.chunks ?? []) {
        entryChunks.add(chunk);
      }
    }

    const pageChunks = findPageChunks(compilation, entryChunks);

    if (pageChunks.length > 0 && shell) {
      pages.length = 0;
      pagesByCss.clear();

      for (const { chunk: pageChunk, name: pageName } of pageChunks) {
        const page: PageInfo = {
          name: pageName,
          classes: new Set(shell.classes),
          cssFiles: new Set(shell.cssFiles),
          jsFiles: new Set<string>(),
        };

        for (const file of pageChunk.files ?? []) {
          if (file.endsWith(".css")) {
            page.cssFiles.add(file);
          } else if (file.endsWith(".js")) {
            page.jsFiles.add(file);
          }
        }

        for (const file of pageChunk.auxiliaryFiles ?? []) {
          if (file.endsWith(".css")) {
            page.cssFiles.add(file);
          }
        }

        for (const module of chunkModules(compilation, pageChunk)) {
          await scanModule(module, page.classes, sourceCache);
        }

        for (const cssFile of page.cssFiles) {
          const owners = pagesByCss.get(cssFile) ?? new Set<string>();
          owners.add(pageName);
          pagesByCss.set(cssFile, owners);
        }

        pages.push(page);
      }
    }
  }

  return { pages, pagesByCss };
}

type PageChunk = {
  chunk: RspackChunkLike;
  name: string;
};

function findPageChunks(
  compilation: Compilation,
  entryChunks: Set<RspackChunkLike>,
): PageChunk[] {
  const pages = new Map<RspackChunkLike, string>();
  const chunkGraph = compilation.chunkGraph as unknown as {
    getModuleChunksIterable: (
      module: RspackModuleLike,
    ) => Iterable<RspackChunkLike>;
  };
  const modules = compilation.modules as unknown as Iterable<RspackModuleLike>;

  for (const module of modules) {
    const pageName = pageNameFromModule(module);

    if (!pageName) {
      continue;
    }

    for (const chunk of chunkGraph.getModuleChunksIterable(module)) {
      if (!entryChunks.has(chunk) && !pages.has(chunk)) {
        pages.set(chunk, pageName);
      }
    }
  }

  const chunks = compilation.chunks as unknown as Iterable<RspackChunkLike>;

  for (const chunk of chunks) {
    if (entryChunks.has(chunk) || pages.has(chunk)) {
      continue;
    }

    const pageName = findPageName(compilation, chunk);

    if (pageName) {
      pages.set(chunk, pageName);
    }
  }

  return [...pages].map(([chunk, name]) => ({ chunk, name }));
}

function pageNameFromModule(module: RspackModuleLike): string | null {
  const resource = module.resource?.split("?")[0] ?? module.resource;
  const match = resource?.match(/\/pages\/([^/]+?)\.(?:tsx?|jsx?)$/i);

  if (match?.[1]) {
    return normalizePageName(match[1]).replace(/^page-/i, "") || "page";
  }

  for (const child of module.modules ?? []) {
    const pageName = pageNameFromModule(child);

    if (pageName) {
      return pageName;
    }
  }

  return null;
}
function findPageName(
  compilation: Compilation,
  chunk: RspackChunkLike,
): string | null {
  for (const module of chunkModules(compilation, chunk)) {
    const pageName = pageNameFromModule(module);

    if (pageName) {
      return pageName;
    }
  }

  const name = chunk.name;

  if (name && /^page-/i.test(name)) {
    return normalizePageName(name).replace(/^page-/i, "") || "page";
  }

  return null;
}

function entryFiles(entry: RspackEntrypointLike): Set<string> {
  const files = new Set<string>();

  if (typeof entry.getFiles === "function") {
    for (const file of entry.getFiles()) {
      files.add(file);
    }
  }

  return files;
}

function chunkModules(
  compilation: Compilation,
  chunk: RspackChunkLike,
): Iterable<RspackModuleLike> {
  const chunkGraph = compilation.chunkGraph as unknown as {
    getChunkModulesIterable: (chunk: unknown) => Iterable<RspackModuleLike>;
  };

  try {
    return chunkGraph.getChunkModulesIterable(chunk);
  } catch {
    return [];
  }
}

async function scanModule(
  module: RspackModuleLike,
  classes: Set<string>,
  sourceCache: Map<string, Promise<string | undefined>>,
): Promise<void> {
  const nested = module.modules;

  if (nested) {
    for (const child of nested) {
      await scanModule(child, classes, sourceCache);
    }
  }

  const resource = module.resource;

  if (resource && isStyleFile(resource)) {
    return;
  }

  const source = readModuleSource(module);

  if (source) {
    scanClasses(source, classes);
    return;
  }

  if (!resource) {
    return;
  }

  const filePath = resource.split("?")[0];

  if (!filePath) {
    return;
  }

  let pending = sourceCache.get(filePath);

  if (!pending) {
    pending = readFile(filePath, "utf8").catch(() => undefined);
    sourceCache.set(filePath, pending);
  }

  const fresh = await pending;

  if (fresh) {
    scanClasses(fresh, classes);
  }
}

function readModuleSource(module: RspackModuleLike): string | undefined {
  try {
    const source = module.originalSource?.();

    if (!source) {
      return undefined;
    }

    return sourceToString(source.source());
  } catch {
    return undefined;
  }
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
        if (isClassToken(token)) {
          classes.add(token.toLowerCase());
        }
      }
    }
  }
}

/** Accept Tailwind-style tokens (`md:flex`, `w-1/2`, `w-[10px]`, `!p-2`). */
function isClassToken(token: string): boolean {
  if (!token || token.length > 256) {
    return false;
  }

  if (/[`${}]/.test(token)) {
    return false;
  }

  return /[A-Za-z_]/.test(token);
}

function injectPageCssLoaders(
  compilation: Compilation,
  cssByPage: Map<string, string[]>,
  pageByName: Map<string, PageInfo>,
  RawSource: new (source: string) => unknown,
): void {
  const publicPath = compilation.options.output.publicPath;
  const base =
    typeof publicPath === "string" && publicPath.length > 0 ? publicPath : "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;

  for (const [page, files] of cssByPage) {
    const jsFiles = pageByName.get(page)?.jsFiles;

    if (!jsFiles || files.length === 0) {
      continue;
    }

    const hrefs = files.map((file) => `${normalizedBase}${file}`);
    const snippet = `(()=>{const __cssDoctorPageStyles=${JSON.stringify(hrefs)};if(typeof document!=="undefined"){for(const __cssDoctorPageHref of __cssDoctorPageStyles){if(!Array.from(document.querySelectorAll("link[data-css-doctor-page]")).some((link)=>link.dataset.cssDoctorPage===__cssDoctorPageHref)){const __cssDoctorPageLink=document.createElement("link");__cssDoctorPageLink.rel="stylesheet";__cssDoctorPageLink.href=__cssDoctorPageHref;__cssDoctorPageLink.dataset.cssDoctorPage=__cssDoctorPageHref;document.head.append(__cssDoctorPageLink);}}}})();\n`;

    for (const jsFile of jsFiles) {
      const asset = compilation.getAsset(jsFile);

      if (!asset) {
        continue;
      }

      compilation.updateAsset(
        jsFile,
        new RawSource(snippet + sourceToString(asset.source.source())) as never,
      );
    }
  }
}

function normalizePageName(name: string): string {
  const normalized = name.trim();

  if (!normalized) {
    return "main";
  }

  return (
    normalized
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "main"
  );
}

function isStyleFile(filePath: string): boolean {
  return /\.(css|scss|sass|less|styl|stylus)(\?|$)/i.test(filePath);
}

function hasRsbuildCssModuleClass(css: string): boolean {
  const pattern =
    /\.([A-Za-z_][A-Za-z0-9_-]*-[A-Za-z0-9]{6})(?=[\s,{:.#>+~[])/g;

  for (const match of css.matchAll(pattern)) {
    const className = match[1];

    if (className && isRsbuildCssModuleClass(className)) {
      return true;
    }
  }

  return false;
}

function isRsbuildCssModuleClass(className: string): boolean {
  const hash = className.split("-").at(-1) ?? "";

  return hash.length === 6 && /[A-Z]/.test(hash) && /[0-9]/.test(hash);
}

function collectCssModuleClasses(css: string): string[] {
  const classes = new Set<string>();
  const pattern =
    /\.([A-Za-z_][A-Za-z0-9_-]*-[A-Za-z0-9]{6})(?=[\s,{:.#>+~[])/g;

  for (const match of css.matchAll(pattern)) {
    const className = match[1];

    if (className && isRsbuildCssModuleClass(className)) {
      classes.add(className.toLowerCase());
    }
  }

  return [...classes];
}

function withCommonClasses(
  pageUsage: Record<string, string[]>,
  classes: string[],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const [page, pageClasses] of Object.entries(pageUsage)) {
    result[page] = [...new Set([...pageClasses, ...classes])];
  }

  return result;
}

function matchesPatterns(
  value: string,
  patterns: Array<string | RegExp>,
): boolean {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? value.includes(pattern) : pattern.test(value),
  );
}

function sourceToString(source: unknown): string {
  if (typeof source === "string") {
    return source;
  }

  if (source instanceof Uint8Array) {
    return Buffer.from(source).toString("utf8");
  }

  return String(source);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}
