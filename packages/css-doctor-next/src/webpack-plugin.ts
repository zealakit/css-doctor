import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, posix, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { analyzeCss, optimizeCss } from "@zealakit/css-doctor-binding";
import type {
  JsChunkOutput,
  JsCssAnalysisResult,
  JsSelectorStat,
} from "@zealakit/css-doctor-binding";
import type { Compilation, Compiler, Entrypoint, Module } from "webpack";

import { printDiagnostics } from "./reporter";
import type {
  CssAssetDiagnostic,
  CssAssetWarning,
  CssDoctorNextDiagnostics,
  CssDoctorWebpackPluginOptions,
  EmittedCssChunk,
  PageCoverageOptions,
  SizeBudgetOptions,
} from "./types";

const PLUGIN_NAME = "CssDoctorWebpackPlugin";
const DEFAULT_MIN_PAGE_RATIO = 0.5;
const DEFAULT_MAX_CHUNK_SIZE = 60 * 1_024;
const LARGE_CSS_ASSET_BYTES = 500 * 1_024;

type PageInfo = {
  name: string;
  classes: Set<string>;
  cssFiles: Set<string>;
  jsFiles: Set<string>;
};

type PageEntry = {
  entry: Entrypoint;
  name: string;
  sourceName: string;
};

type CollectedPages = {
  pages: PageInfo[];
  pagesByCss: Map<string, Set<string>>;
};

/**
 * Webpack compiler plugin that splits emitted client CSS by page coverage and
 * removes selectors no route uses.
 *
 * All work happens inside `processAssets` at the optimize stage. Failures are
 * logged through the compilation logger and never abort the Next.js build.
 */
export class CssDoctorWebpackPlugin {
  private readonly options: CssDoctorWebpackPluginOptions;
  private readonly pageCoverage: Required<PageCoverageOptions> & {
    forceCommon: string[];
  };
  private readonly sizeBudget: Required<SizeBudgetOptions>;
  private readonly minify: boolean;
  private readonly include: Array<string | RegExp>;
  private readonly exclude: Array<string | RegExp>;
  private readonly configurationErrors: string[] = [];

  constructor(options: CssDoctorWebpackPluginOptions = {}) {
    this.options = options;
    const ratio =
      options.pageCoverage?.minPageRatio ??
      options.minPageRatio ??
      DEFAULT_MIN_PAGE_RATIO;
    const maxChunkSize =
      options.sizeBudget?.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;

    this.pageCoverage = {
      enabled: options.pageCoverage?.enabled ?? true,
      minPageRatio:
        Number.isFinite(ratio) && ratio >= 0 && ratio <= 1
          ? ratio
          : DEFAULT_MIN_PAGE_RATIO,
      forceCommon:
        options.pageCoverage?.forceCommon ?? options.forceCommonSelectors ?? [],
    };

    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      this.configurationErrors.push(
        "minPageRatio must be a number between 0 and 1; using 0.5",
      );
    }

    this.sizeBudget = {
      enabled: options.sizeBudget?.enabled ?? true,
      maxChunkSize:
        Number.isInteger(maxChunkSize) && maxChunkSize > 0
          ? maxChunkSize
          : DEFAULT_MAX_CHUNK_SIZE,
      isolateVariables: options.sizeBudget?.isolateVariables ?? true,
    };

    if (
      options.sizeBudget?.enabled !== false &&
      (!Number.isInteger(maxChunkSize) || maxChunkSize <= 0)
    ) {
      this.configurationErrors.push(
        "maxChunkSize must be a positive integer; using 61440",
      );
    }

    this.minify = options.minify ?? true;
    this.include = options.include ?? [];
    this.exclude = options.exclude ?? [];
  }

  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(PLUGIN_NAME, (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        {
          name: PLUGIN_NAME,
          stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE,
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
    const pagesResult = await collectPages(compilation, this.options.pageUsage);
    const pageNames = pagesResult.pages.map((page) => page.name);
    const pageByName = new Map(
      pagesResult.pages.map((page) => [page.name, page]),
    );
    const allPages = new Set(pageNames);
    const pageUsage: Record<string, string[]> = {};
    const pageUsageCounts: Record<string, number> = {};

    for (const page of pagesResult.pages) {
      const classes = [...page.classes].sort();
      pageUsage[page.name] = classes;
      pageUsageCounts[page.name] = classes.length;
    }

    const pageCoverageApplied =
      this.pageCoverage.enabled && pageNames.length > 0;
    const diagnostics: CssDoctorNextDiagnostics = {
      plugin: "css-doctor-next",
      generatedAt: new Date().toISOString(),
      durationMs: 0,
      minPageRatio: this.pageCoverage.minPageRatio,
      minify: this.minify,
      pageCoverage: {
        enabled: this.pageCoverage.enabled,
        minPageRatio: this.pageCoverage.minPageRatio,
      },
      sizeBudget: {
        enabled: this.sizeBudget.enabled,
        maxChunkSize: this.sizeBudget.maxChunkSize,
        isolateVariables: this.sizeBudget.isolateVariables,
        splitChunks: 0,
        oversizedChunks: 0,
      },
      pages: pageNames,
      pageUsage: pageUsageCounts,
      splitApplied: pageCoverageApplied,
      totalCssAssets: 0,
      analyzedCssAssets: 0,
      failedCssAssets: 0,
      skippedCssAssets: 0,
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

    diagnostics.errors.push(...this.configurationErrors);

    const matrix = new Map<string, JsSelectorStat>();
    const pageFiles = new Map<string, string[]>();
    const usedAssetNames = new Set(
      compilation.getAssets().map((asset) => asset.name),
    );
    const RawSource = compiler.webpack.sources.RawSource;

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
        this.shouldSkipAsset(
          compilation,
          asset.name,
          sourceToString(asset.source.source()),
        )
      ) {
        diagnostics.skippedCssAssets += 1;
        continue;
      }

      const associatedPages = [
        ...(pagesResult.pagesByCss.get(asset.name) ?? allPages),
      ].sort();
      const file = analyzeAsset(asset.name, asset.source.source());
      file.associatedPages = associatedPages;

      if (file.error) {
        diagnostics.failedCssAssets += 1;
        diagnostics.errors.push(`${asset.name}: ${file.error}`);
        diagnostics.files.push(file);
        logger.warn(`[css-doctor] ${asset.name}: ${file.error}`);
        continue;
      }

      const originalCss = sourceToString(asset.source.source());

      try {
        const pipeline = optimizeCss({
          cssContent: originalCss,
          pageUsage,
          pageCoverage: {
            enabled: this.pageCoverage.enabled,
            minPageRatio: this.pageCoverage.minPageRatio,
            forceCommon: this.pageCoverage.forceCommon,
          },
          sizeBudget: {
            enabled: this.sizeBudget.enabled,
            maxChunkSize: this.sizeBudget.maxChunkSize,
            isolateVariables: this.sizeBudget.isolateVariables,
          },
          minify: this.minify,
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

        const commonFileNames: string[] = [];
        let commonSizeBytes = 0;

        for (const chunk of commonChunks) {
          const embedded = chunk === embeddedCommon;
          const fileName = embedded ? asset.name : emitCssChunk(chunk);
          commonSizeBytes += chunk.sizeBytes;
          commonFileNames.push(fileName);

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

        let pageSpecificSizeBytes = 0;

        for (const chunk of pageChunks) {
          const page = chunk.page;

          if (!page) {
            continue;
          }

          const fileName = emitCssChunk(chunk);
          pageSpecificSizeBytes += chunk.sizeBytes;
          const files = pageFiles.get(page) ?? [];
          files.push(fileName);
          pageFiles.set(page, files);

          diagnostics.emittedPageChunks.push({
            page,
            fileName,
            sizeBytes: chunk.sizeBytes,
          });
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
          : Buffer.byteLength(embeddedCommon?.css ?? "", "utf8");
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
        const message = `failed to optimize CSS: ${describeError(error)}`;
        diagnostics.errors.push(`${asset.name}: ${message}`);
        logger.warn(`[css-doctor] ${asset.name}: ${message}`);
      }

      diagnostics.analyzedCssAssets += 1;
      diagnostics.totalSizeBeforeBytes += file.sizeBeforeBytes;
      diagnostics.totalSizeAfterBytes += file.sizeAfterBytes;
      diagnostics.totalSelectors += file.selectorCount;
      diagnostics.totalRules += file.ruleCount;
      diagnostics.files.push(file);
    }

    if (pageFiles.size > 0) {
      injectPageJsLoaders(compilation, pageFiles, pageByName, RawSource);
    }

    diagnostics.usageMatrix = [...matrix.values()].sort((left, right) =>
      left.selector.localeCompare(right.selector),
    );
    diagnostics.durationMs = roundMs(performance.now() - startedAt);

    if (this.options.onDiagnostics) {
      try {
        await this.options.onDiagnostics(diagnostics);
      } catch (error) {
        const message = `onDiagnostics callback failed: ${describeError(
          error,
        )}`;
        diagnostics.errors.push(message);
        logger.warn(`[css-doctor] ${message}`);
      }
    }

    if (
      this.options.report !== false &&
      (diagnostics.totalCssAssets > 0 || diagnostics.errors.length > 0)
    ) {
      try {
        printDiagnostics(diagnostics);
      } catch (error) {
        logger.warn(`[css-doctor] reporter failed: ${describeError(error)}`);
      }
    }
  }

  private shouldSkipAsset(
    compilation: Compilation,
    assetName: string,
    source: string,
  ): boolean {
    if (isCssModuleAsset(compilation, assetName, source)) {
      return true;
    }

    if (this.include.length > 0 && !matchesPatterns(assetName, this.include)) {
      return true;
    }

    return this.exclude.length > 0 && matchesPatterns(assetName, this.exclude);
  }
}

function injectPageJsLoaders(
  compilation: Compilation,
  cssByPage: Map<string, string[]>,
  pageByName: Map<string, PageInfo>,
  RawSource: new (source: string) => import("webpack").sources.Source,
): void {
  const publicPath =
    typeof compilation.options.output.publicPath === "string" &&
    compilation.options.output.publicPath.length > 0
      ? compilation.options.output.publicPath
      : "/_next/";
  const normalizedBase = publicPath.endsWith("/")
    ? publicPath
    : `${publicPath}/`;

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

      const source = sourceToString(asset.source.source());
      compilation.updateAsset(jsFile, new RawSource(snippet + source));
    }
  }
}

function matchesPatterns(
  value: string,
  patterns: Array<string | RegExp>,
): boolean {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? value.includes(pattern) : pattern.test(value),
  );
}

function isCssModuleAsset(
  compilation: Compilation,
  assetName: string,
  source: string,
): boolean {
  if (/\.module\.(css|scss|sass|less|styl|stylus)$/i.test(assetName)) {
    return true;
  }

  // Next.js emits CSS Modules as content-hashed `static/css/<hash>.css`
  // assets whose original `.module.css` name is no longer in the asset name.
  // Its default local-identifier format is `<file>_<local>__<hash>`.
  if (/\.[A-Za-z0-9_-]+_[A-Za-z0-9_-]+__[A-Za-z0-9_-]+/.test(source)) {
    return true;
  }

  for (const chunk of compilation.chunks) {
    if (!chunk.files.has(assetName) && !chunk.auxiliaryFiles.has(assetName)) {
      continue;
    }

    for (const module of compilation.chunkGraph.getChunkModulesIterable(
      chunk,
    )) {
      if (moduleHasCssModule(module)) {
        return true;
      }
    }
  }

  return false;
}

function moduleHasCssModule(module: Module): boolean {
  const nested = (module as Module & { modules?: Iterable<Module> }).modules;

  if (nested) {
    for (const child of nested) {
      if (moduleHasCssModule(child)) {
        return true;
      }
    }
  }

  const resource = (module as Module & { resource?: unknown }).resource;
  return (
    typeof resource === "string" &&
    /\.module\.(css|scss|sass|less|styl|stylus)(\?|$)/i.test(resource)
  );
}

function analyzeAsset(
  fileName: string,
  source: string | Buffer,
): CssAssetDiagnostic {
  try {
    const css = sourceToString(source);
    const sizeBeforeBytes = Buffer.byteLength(css, "utf8");
    const analysis = analyzeCss(css);
    const warnings = collectSyntaxWarnings(analysis);

    if (sizeBeforeBytes >= LARGE_CSS_ASSET_BYTES) {
      warnings.push({
        kind: "large-asset",
        message: `CSS asset is larger than ${formatBytes(
          LARGE_CSS_ASSET_BYTES,
        )}; consider route-level code splitting.`,
      });
    }

    return {
      fileName,
      sizeBeforeBytes,
      sizeAfterBytes: sizeBeforeBytes,
      selectorCount: analysis.stats.selectorCount,
      ruleCount: analysis.stats.ruleCount,
      associatedPages: [],
      warnings,
      analysis,
    };
  } catch (error) {
    return {
      fileName,
      sizeBeforeBytes: 0,
      sizeAfterBytes: 0,
      selectorCount: 0,
      ruleCount: 0,
      associatedPages: [],
      warnings: [],
      error: describeError(error),
    };
  }
}

async function collectPages(
  compilation: Compilation,
  directPageUsage: Record<string, string[]> | undefined,
): Promise<CollectedPages> {
  const entries = [...compilation.entrypoints.values()];
  const pageEntries: PageEntry[] = [];
  const sharedEntries: Entrypoint[] = [];
  const fallbackEntries: PageEntry[] = [];

  for (const entry of entries) {
    const name = entryName(entry);

    if (!name) {
      continue;
    }

    if (isPageEntry(name)) {
      const route = routeNameForEntry(name) ?? name;
      pageEntries.push({ entry, name: route, sourceName: name });
    } else if (isSharedEntry(name)) {
      sharedEntries.push(entry);
    } else if (!isInternalEntry(name)) {
      fallbackEntries.push({
        entry,
        name: routeNameForEntry(name) ?? name,
        sourceName: name,
      });
    }
  }

  const selectedPages = pageEntries.length > 0 ? pageEntries : fallbackEntries;
  const direct = directPageUsage
    ? Object.keys(directPageUsage).length > 0
    : false;
  const pages = new Map<string, PageInfo>();
  const pagesByCss = new Map<string, Set<string>>();

  if (direct && directPageUsage) {
    for (const [rawName, classes] of Object.entries(directPageUsage)) {
      const name = rawName.trim();

      if (!name) {
        continue;
      }

      pages.set(name, {
        name,
        classes: new Set(classes.map((className) => className.toLowerCase())),
        cssFiles: new Set(),
        jsFiles: new Set(),
      });
    }
  } else {
    const sourceCache = new Map<string, Promise<string | undefined>>();
    const sharedClasses = new Set<string>();

    const projectRoot = process.cwd();

    for (const entry of sharedEntries) {
      for (const className of await collectEntryClasses(
        compilation,
        entry,
        sourceCache,
      )) {
        sharedClasses.add(className);
      }

      const name = entryName(entry);

      if (name) {
        for (const className of await collectNameSourceClasses(
          name,
          projectRoot,
          sourceCache,
        )) {
          sharedClasses.add(className);
        }
      }
    }

    for (const { entry, name, sourceName } of selectedPages) {
      const page = pages.get(name) ?? {
        name,
        classes: new Set<string>(),
        cssFiles: new Set<string>(),
        jsFiles: collectEntryJsFiles(entry),
      };
      for (const jsFile of collectEntryJsFiles(entry)) {
        page.jsFiles.add(jsFile);
      }

      for (const className of sharedClasses) {
        page.classes.add(className);
      }

      for (const className of await collectEntryClasses(
        compilation,
        entry,
        sourceCache,
      )) {
        page.classes.add(className);
      }

      for (const className of await collectPageSourceClasses(
        sourceName,
        projectRoot,
        sourceCache,
      )) {
        page.classes.add(className);
      }

      pages.set(name, page);
    }
  }

  const targetPages = [...pages.keys()];

  for (const { entry, name } of selectedPages) {
    const cssFiles = collectEntryCssFiles(entry);

    if (direct) {
      const directPage = pages.get(name);

      if (directPage) {
        for (const cssFile of cssFiles) {
          directPage.cssFiles.add(cssFile);
        }
      }
    } else {
      const page = pages.get(name);

      if (page) {
        for (const cssFile of cssFiles) {
          page.cssFiles.add(cssFile);
        }
      }
    }
  }

  const sharedCssFiles = new Set<string>();

  for (const entry of sharedEntries) {
    for (const cssFile of collectEntryCssFiles(entry)) {
      sharedCssFiles.add(cssFile);
    }
  }

  for (const page of pages.values()) {
    for (const cssFile of page.cssFiles) {
      addCssOwner(pagesByCss, cssFile, page.name);
    }
  }

  for (const cssFile of sharedCssFiles) {
    for (const page of targetPages) {
      addCssOwner(pagesByCss, cssFile, page);
    }
  }

  return {
    pages: [...pages.values()],
    pagesByCss,
  };
}

async function collectPageSourceClasses(
  entryName: string,
  projectRoot: string,
  sourceCache: Map<string, Promise<string | undefined>>,
): Promise<Set<string>> {
  const classes = new Set<string>();
  const visited = new Set<string>();
  const normalized = normalizeSlashes(entryName);
  const candidates: string[] = [];

  if (normalized.startsWith("app/")) {
    const path = normalized.slice(4);

    if (path === "page" || path.endsWith("/page")) {
      const pagePath = path === "page" ? "app/page" : `app/${path}`;
      candidates.push(resolve(projectRoot, pagePath));

      if (path === "_not-found/page") {
        candidates.push(resolve(projectRoot, "app/not-found"));
      }

      const directories = path.split("/").slice(0, -1).filter(Boolean);
      const layoutPaths = ["app"];

      for (let index = 0; index < directories.length; index += 1) {
        layoutPaths.push(`app/${directories.slice(0, index + 1).join("/")}`);
      }

      for (const layoutPath of layoutPaths) {
        candidates.push(resolve(projectRoot, `${layoutPath}/layout`));
      }
    } else {
      candidates.push(resolve(projectRoot, normalized));
    }
  } else if (normalized.startsWith("pages/")) {
    candidates.push(resolve(projectRoot, normalized));
    candidates.push(resolve(projectRoot, "pages/_app"));
  } else {
    candidates.push(resolve(projectRoot, normalized));
  }

  for (const candidate of candidates) {
    const file = findSourceFile(candidate);

    if (file) {
      await scanSourceFile(file, classes, projectRoot, sourceCache, visited);
    }
  }

  return classes;
}

async function collectNameSourceClasses(
  entryName: string,
  projectRoot: string,
  sourceCache: Map<string, Promise<string | undefined>>,
): Promise<Set<string>> {
  const classes = new Set<string>();
  const visited = new Set<string>();
  const candidate = resolve(projectRoot, normalizeSlashes(entryName));
  const file = findSourceFile(candidate);

  if (file) {
    await scanSourceFile(file, classes, projectRoot, sourceCache, visited);
  }

  return classes;
}

async function scanSourceFile(
  filePath: string,
  classes: Set<string>,
  projectRoot: string,
  sourceCache: Map<string, Promise<string | undefined>>,
  visited: Set<string>,
): Promise<void> {
  const absolutePath = resolve(filePath);

  if (visited.has(absolutePath)) {
    return;
  }

  visited.add(absolutePath);

  let pending = sourceCache.get(absolutePath);

  if (!pending) {
    pending = readFile(absolutePath, "utf8").catch(() => undefined);
    sourceCache.set(absolutePath, pending);
  }

  const source = await pending;

  if (!source) {
    return;
  }

  scanClasses(source, classes);

  for (const specifier of extractImportSpecifiers(source)) {
    const resolved = resolveImportSpecifier(
      specifier,
      absolutePath,
      projectRoot,
    );

    if (resolved && !visited.has(resolved)) {
      await scanSourceFile(
        resolved,
        classes,
        projectRoot,
        sourceCache,
        visited,
      );
    }
  }
}

const SOURCE_EXTENSIONS = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".mdx",
];

function findSourceFile(basePath: string): string | null {
  if (isStyleFile(basePath)) {
    return null;
  }

  if (extname(basePath) && existsSync(basePath)) {
    return basePath;
  }

  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `${basePath}${extension}`;

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = resolve(basePath, `index${extension}`);

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers = new Set<string>();
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];

      if (specifier) {
        specifiers.add(specifier);
      }
    }
  }

  return [...specifiers];
}

function resolveImportSpecifier(
  specifier: string,
  fromFile: string,
  projectRoot: string,
): string | null {
  let basePath: string;

  if (specifier.startsWith("@/")) {
    basePath = resolve(projectRoot, specifier.slice(2));
  } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    basePath = resolve(dirname(fromFile), specifier);
  } else {
    return null;
  }

  if (isStyleFile(basePath)) {
    return null;
  }

  return findSourceFile(basePath);
}

async function collectEntryClasses(
  compilation: Compilation,
  entry: Entrypoint,
  sourceCache: Map<string, Promise<string | undefined>>,
): Promise<Set<string>> {
  const classes = new Set<string>();
  const visitedModules = new Set<Module>();

  for (const chunk of entry.chunks) {
    for (const module of compilation.chunkGraph.getChunkModulesIterable(
      chunk,
    )) {
      await scanModule(module, classes, sourceCache, visitedModules);
    }
  }

  return classes;
}

async function scanModule(
  module: Module,
  classes: Set<string>,
  sourceCache: Map<string, Promise<string | undefined>>,
  visited: Set<Module>,
): Promise<void> {
  if (visited.has(module)) {
    return;
  }

  visited.add(module);

  const nested = (module as Module & { modules?: Iterable<Module> }).modules;

  if (nested) {
    for (const child of nested) {
      await scanModule(child, classes, sourceCache, visited);
    }
  }

  const resource = (module as Module & { resource?: unknown }).resource;

  if (typeof resource !== "string" || isStyleFile(resource)) {
    return;
  }

  const source = readModuleSource(module);

  if (source) {
    scanClasses(source, classes);
    return;
  }

  if (!isScannableSource(resource)) {
    return;
  }

  const filePath = resource.split("?")[0] ?? resource;

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

function readModuleSource(module: Module): string | undefined {
  try {
    const source = module.originalSource();

    if (!source) {
      return undefined;
    }

    return sourceToString(source.source());
  } catch {
    return undefined;
  }
}

function collectEntryJsFiles(entry: Entrypoint): Set<string> {
  const files = new Set<string>();

  for (const file of entry.getFiles()) {
    if (file.endsWith(".js")) {
      files.add(file);
    }
  }

  return files;
}

function collectEntryCssFiles(entry: Entrypoint): Set<string> {
  const cssFiles = new Set<string>();

  for (const file of entry.getFiles()) {
    if (file.endsWith(".css")) {
      cssFiles.add(file);
    }
  }

  for (const chunk of entry.chunks) {
    for (const file of chunk.files) {
      if (file.endsWith(".css")) {
        cssFiles.add(file);
      }
    }

    for (const file of chunk.auxiliaryFiles) {
      if (file.endsWith(".css")) {
        cssFiles.add(file);
      }
    }
  }

  return cssFiles;
}

function entryName(entry: Entrypoint): string | undefined {
  if (entry.name) {
    return entry.name;
  }

  const chunk = entry.getEntrypointChunk();
  return chunk.name ?? undefined;
}

function isPageEntry(name: string): boolean {
  const normalized = normalizeSlashes(name);

  if (normalized.startsWith("app/")) {
    const path = normalized.slice(4);
    return path === "page" || path.endsWith("/page");
  }

  if (normalized.startsWith("pages/")) {
    const path = normalized.slice(6);
    return (
      path.length > 0 &&
      !path.split("/").some((segment) => segment.startsWith("_"))
    );
  }

  return false;
}

function isSharedEntry(name: string): boolean {
  const normalized = normalizeSlashes(name);

  return (
    (normalized.startsWith("app/") &&
      (normalized === "app/layout" || normalized.endsWith("/layout"))) ||
    normalized === "pages/_app" ||
    normalized === "pages/_document"
  );
}

function isInternalEntry(name: string): boolean {
  const normalized = normalizeSlashes(name);
  const base = normalized.split("/").pop() ?? normalized;

  return (
    base === "main" ||
    base === "main-app" ||
    base === "polyfills" ||
    base === "webpack" ||
    base === "app-pages-internals" ||
    base === "middleware" ||
    base === "instrumentation"
  );
}

function routeNameForEntry(name: string): string | null {
  const normalized = normalizeSlashes(name).replace(/^\.\//, "");

  if (normalized.startsWith("app/")) {
    let path = normalized.slice(4);

    if (path === "page") {
      return "/";
    }

    if (path.endsWith("/page")) {
      path = path.slice(0, -"/page".length);
    }

    if (!path || path.endsWith("layout")) {
      return null;
    }

    return `/${path}`;
  }

  if (normalized.startsWith("pages/")) {
    let path = normalized.slice(6);

    if (!path || path.startsWith("_")) {
      return null;
    }

    path = path.replace(/\/?index$/, "");
    return path.length > 0 ? `/${path}` : "/";
  }

  return normalized.length > 0 ? normalized : null;
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isStyleFile(resource: string): boolean {
  return /\.(css|scss|sass|less|styl|stylus)(\?|$)/i.test(resource);
}

function isScannableSource(resource: string): boolean {
  return /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts|html?|vue|svelte|mdx)(\?|$)/i.test(
    resource,
  );
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

function addCssOwner(
  pagesByCss: Map<string, Set<string>>,
  cssFile: string,
  page: string,
): void {
  const owners = pagesByCss.get(cssFile) ?? new Set<string>();
  owners.add(page);
  pagesByCss.set(cssFile, owners);
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

function sourceToString(source: string | Buffer | Uint8Array): string {
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
