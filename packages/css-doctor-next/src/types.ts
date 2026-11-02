import type {
  JsCssAnalysisResult,
  JsSelectorStat,
} from "@zealakit/css-doctor-binding";

/** Tier 1: semantic page-coverage splitting. */
export type PageCoverageOptions = {
  /** Enable page-coverage splitting. @default true */
  enabled?: boolean;
  /** Minimum page coverage for common rules. Range: 0..1. @default 0.5 */
  minPageRatio?: number;
  /** Selectors or classes that always stay in the common chunk. */
  forceCommon?: string[];
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

/** Configuration for the Next.js integration. */
export type CssDoctorNextOptions = {
  /** Tier 1 configuration. */
  pageCoverage?: PageCoverageOptions;
  /** Tier 2 configuration. */
  sizeBudget?: SizeBudgetOptions;
  /** Minify emitted CSS. Defaults to true for production builds. */
  minify?: boolean;
  /** Print diagnostics during `next build`. @default true */
  report?: boolean;
  /** Only process CSS assets whose name matches these patterns. */
  include?: Array<string | RegExp>;
  /** Skip CSS assets whose name matches these patterns. */
  exclude?: Array<string | RegExp>;
  /**
   * Explicit page class usage. When provided, it replaces route scanning for
   * coverage calculations while route entrypoints are still used to associate
   * CSS assets with pages.
   */
  pageUsage?: Record<string, string[]>;
  /**
   * Explicit cssd.config.* path. When absent and no inline options are passed,
   * the loader searches the project root.
   */
  configFile?: string;
  /** Called once per client production build with the full diagnostics. */
  onDiagnostics?: (result: CssDoctorNextDiagnostics) => void | Promise<void>;
  /** @deprecated Use `pageCoverage.minPageRatio`. */
  minPageRatio?: number;
  /** @deprecated Use `pageCoverage.forceCommon`. */
  forceCommonSelectors?: string[];
};

/** Options passed to the internal webpack plugin. */
export type CssDoctorWebpackPluginOptions = Omit<
  CssDoctorNextOptions,
  "configFile"
>;

export type CssAssetWarningKind = "syntax" | "large-asset";

/** A non-fatal warning attached to a CSS asset. */
export type CssAssetWarning = {
  kind: CssAssetWarningKind;
  message: string;
  line?: number;
  column?: number;
};

/** Page-coverage split metadata for one CSS asset. */
export type CssAssetSplitInfo = {
  associatedPages: string[];
  commonSizeBytes: number;
  pageSpecificSizeBytes: number;
  deadCodeCount: number;
};

/** Analysis metadata for one CSS asset. */
export type CssAssetDiagnostic = {
  fileName: string;
  sizeBeforeBytes: number;
  sizeAfterBytes: number;
  selectorCount: number;
  ruleCount: number;
  associatedPages: string[];
  split?: CssAssetSplitInfo;
  warnings: CssAssetWarning[];
  analysis?: JsCssAnalysisResult;
  error?: string;
};

/** A page-specific CSS asset emitted by the plugin. */
export type EmittedPageChunk = {
  page: string;
  fileName: string;
  sizeBytes: number;
};

/** One final CSS chunk produced by either pipeline tier. */
export type EmittedCssChunk = {
  fileName: string;
  sourceChunk: string;
  kind: "common" | "page" | "variables" | "part";
  page?: string;
  variables: boolean;
  part?: number;
  sizeBytes: number;
  oversized: boolean;
  splitDueToSize: boolean;
  embedded: boolean;
};

/** Tier 2 summary for the diagnostics report. */
export type SizeBudgetDiagnostics = {
  enabled: boolean;
  maxChunkSize: number;
  isolateVariables: boolean;
  splitChunks: number;
  oversizedChunks: number;
};

/** Complete diagnostics emitted by a Next.js client production build. */
export type CssDoctorNextDiagnostics = {
  plugin: "css-doctor-next";
  generatedAt: string;
  durationMs: number;
  minPageRatio: number;
  minify: boolean;
  pageCoverage: {
    enabled: boolean;
    minPageRatio: number;
  };
  sizeBudget: SizeBudgetDiagnostics;
  pages: string[];
  pageUsage: Record<string, number>;
  splitApplied: boolean;
  totalCssAssets: number;
  analyzedCssAssets: number;
  failedCssAssets: number;
  skippedCssAssets: number;
  totalSizeBeforeBytes: number;
  totalSizeAfterBytes: number;
  totalSelectors: number;
  totalRules: number;
  commonCssBytes: number;
  pageSpecificCssBytes: number;
  emittedPageChunks: EmittedPageChunk[];
  emittedCssChunks: EmittedCssChunk[];
  usageMatrix: JsSelectorStat[];
  deadCodeCount: number;
  files: CssAssetDiagnostic[];
  errors: string[];
};
