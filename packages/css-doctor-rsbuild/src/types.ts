import type { JsSelectorStat } from "@zealakit/css-doctor-binding";

/** Tier 1: semantic page-coverage splitting. */
export type PageCoverageOptions = {
  /** Enable page-coverage splitting. @default true */
  enabled?: boolean;
  /** Minimum page coverage for common rules. Range: 0..1. @default 0.5 */
  minPageRatio?: number;
  /** Selectors or classes that always stay in the common chunk. */
  forceCommon?: string[];
  /**
   * Class matching strictness for page coverage.
   * - `"conservative"` (default): a selector is used when any required class is.
   * - `"precise"`: every class a selector strictly requires must be used on the
   *   page, so `.btn.primary` is removed where `.primary` never appears.
   *   Classes added at runtime that are not statically visible can be removed
   *   wrongly; use `forceCommon` / `pageUsage` for those.
   */
  matching?: "conservative" | "precise";
  /**
   * Dead-code removal only acts on selectors whose "unused" verdict has at
   * least this confidence. Static-only evidence is `"medium"` (default, the
   * long-standing behavior); `"high"` also requires runtime coverage evidence
   * via `runtimeUnused`.
   */
  removeUnusedMinConfidence?: "low" | "medium" | "high";
  /** Selectors a browser run matched (from `css-doctor coverage`); never removed. */
  runtimeUsed?: string[];
  /** Selectors covered browser runs never matched; makes "unused" high confidence. */
  runtimeUnused?: string[];
};

/** Tier 2: physical size-budget splitting. */
export type SizeBudgetOptions = {
  /** Enable size-budget splitting. @default true */
  enabled?: boolean;
  /** Maximum serialized bytes per body chunk. @default 60 * 1024 */
  maxChunkSize?: number;
  /** Isolate CSS variables before splitting. @default true */
  isolateVariables?: boolean;
};

/** Configuration for the Rsbuild integration. */
export type CssDoctorRsbuildOptions = {
  /** Tier 1 configuration. */
  pageCoverage?: PageCoverageOptions;
  /** Tier 2 configuration. */
  sizeBudget?: SizeBudgetOptions;
  /**
   * Explicit page → class usage. Merged with route/entrypoint scanning when
   * both are available.
   */
  pageUsage?: Record<string, string[]>;
  /** Minify emitted CSS. Defaults to true for production builds. */
  minify?: boolean;
  /** Print the diagnostics summary. @default true */
  report?: boolean;
  /**
   * Function names resolved as class helpers when scanning source
   * (`cn("a", { b: on })`). Defaults to clsx, cn, cx, classnames, classNames,
   * twMerge, twJoin, cva, tv. `[]` disables helper resolution.
   */
  classHelpers?: string[];
  /** Only process CSS assets whose name matches these patterns. */
  include?: Array<string | RegExp>;
  /** Skip CSS assets whose name matches these patterns. */
  exclude?: Array<string | RegExp>;
  /** Optional diagnostics callback. Failures are reported, never thrown. */
  onDiagnostics?: (result: CssDoctorRsbuildDiagnostics) => void | Promise<void>;
};

/** One final CSS chunk produced by either pipeline tier. */
export type ChunkInfo = {
  name: string;
  size: number;
  isVariableChunk?: boolean;
  isPartChunk?: boolean;
};

/** Compact result summary used by the reporter and diagnostics. */
export type OptimizationSummary = {
  totalOriginalSize: number;
  totalOptimizedSize: number;
  deadCodeSelectorsCount: number;
  chunks: ChunkInfo[];
};

/** One final CSS chunk with Rsbuild-specific metadata. */
export type EmittedCssChunk = ChunkInfo & {
  fileName: string;
  sourceChunk: string;
  kind: "common" | "page" | "variables" | "part";
  page?: string;
  embedded: boolean;
  oversized: boolean;
  splitDueToSize: boolean;
};

/** A page-specific CSS file emitted by the plugin. */
export type EmittedPageChunk = {
  page: string;
  fileName: string;
  sizeBytes: number;
};

/** Tier 2 summary for the diagnostics report. */
export type SizeBudgetDiagnostics = {
  enabled: boolean;
  maxChunkSize: number;
  isolateVariables: boolean;
  splitChunks: number;
  oversizedChunks: number;
};

/** Analysis metadata for one CSS asset. */
export type CssAssetDiagnostic = {
  fileName: string;
  sizeBeforeBytes: number;
  sizeAfterBytes: number;
  selectorCount: number;
  ruleCount: number;
  associatedPages: string[];
  deadCodeCount: number;
  error?: string;
};

/** Complete diagnostics emitted by the Rsbuild plugin. */
export type CssDoctorRsbuildDiagnostics = OptimizationSummary & {
  plugin: "css-doctor:rsbuild";
  generatedAt: string;
  durationMs: number;
  minify: boolean;
  pages: string[];
  pageUsage: Record<string, number>;
  splitApplied: boolean;
  totalCssAssets: number;
  analyzedCssAssets: number;
  skippedCssAssets: number;
  failedCssAssets: number;
  totalSelectors: number;
  totalRules: number;
  commonCssBytes: number;
  pageSpecificCssBytes: number;
  emittedPageChunks: EmittedPageChunk[];
  emittedCssChunks: EmittedCssChunk[];
  sizeBudget: SizeBudgetDiagnostics;
  usageMatrix: JsSelectorStat[];
  files: CssAssetDiagnostic[];
  errors: string[];
};
