/** GUI report schema version (independent of CSS Doctor engine versions). */
export const GUI_REPORT_SCHEMA_VERSION = 1 as const;

export type GuiSeverity = "error" | "warning" | "info" | "unknown";

export type GuiReportSourceKind =
  | "check-json"
  | "health-json"
  | "generated-check"
  | "optimize-json"
  | "split-json"
  | "diff-json";

export type GuiReportSource = {
  kind: GuiReportSourceKind;
  command: "check" | "health" | "optimize" | "split" | "diff";
  toolVersion?: string;
  path?: string;
};

export type GuiDimension = {
  id: string;
  score: number | null;
  weight: number;
  effectiveWeight: number;
  evaluated: boolean;
  issueCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  diagnosticCodes: string[];
  recommendations: string[];
  note?: string;
};

export type GuiHealth = {
  overall: number;
  grade: string;
  status: string;
  schemaVersion: number;
  dimensions: GuiDimension[];
  recommendations: string[];
  summary: {
    files: number;
    rules: number;
    selectors: number;
    declarations: number;
    sizeBytes: number;
    errors: number;
    warnings: number;
    suggestions: number;
    analysisMs: number;
  };
};

export type GuiDiagnostic = {
  id: string;
  severity: GuiSeverity;
  code: string;
  message: string;
  category?: string;
  filePath?: string;
  line?: number;
  column?: number;
  selector?: string;
  remediation?: string;
  source: "health" | "check";
};

export type GuiFileInsight = {
  path: string;
  absolutePath?: string;
  sizeBytes: number;
  ok: boolean;
  issueCount: number;
  error?: string;
  selectorCount?: number;
  ruleCount?: number;
  declarationCount?: number;
  importantDeclarationCount?: number;
  uniqueClassCount?: number;
  uniqueIdCount?: number;
  uniqueTagCount?: number;
  maxNestingDepth?: number;
  warningCount?: number;
};

export type GuiReportSummary = {
  fileCount: number;
  analyzedFileCount: number;
  failedFileCount: number;
  filesWithIssues: number;
  totalSizeBytes: number;
  rules: number;
  selectors: number;
  declarations: number;
  analysisMs?: number;
  totalMs?: number;
};

export type GuiDiagnosticCounts = {
  error: number;
  warning: number;
  info: number;
  unknown: number;
  total: number;
};

export type GuiCountBucket = {
  key: string;
  count: number;
};

export type GuiSelectorRow = {
  id: string;
  filePath: string;
  raw: string;
  kinds: string[];
  /** Class names without a leading dot (from Core analyzeCss). */
  classes: string[];
  /** ID names without a leading `#`. */
  ids: string[];
  /** Element/type names. */
  tags: string[];
  /** Attribute local names (values not currently exported by Core). */
  attributes: string[];
  specificityIds: number;
  specificityClasses: number;
  specificityTypes: number;
  nestingDepth: number;
  line?: number;
  column?: number;
};

export type GuiDeadCssCandidate = {
  id: string;
  status: "candidate";
  code: string;
  message: string;
  filePath?: string;
  selector?: string;
  line?: number;
  column?: number;
  remediation?: string;
};

/** Per-file usage hit for a class token (HTML/JS/pageUsage — future). */
export type GuiClassUsageHit = {
  file: string;
  count: number;
};

/**
 * Source usage locations keyed by symbol kind.
 * Older reports may only populate `byClass`.
 */
export type GuiCssUsage = {
  byClass: Record<string, GuiClassUsageHit[]>;
  byId: Record<string, GuiClassUsageHit[]>;
  byTag: Record<string, GuiClassUsageHit[]>;
  byAttribute: Record<string, GuiClassUsageHit[]>;
};

/** Canonical selector analysis (from check `selectorAnalysis`). */
export type GuiSelectorAnalysis = {
  schemaVersion: number;
  completeness: "full" | "symbols-only" | "legacy-class-only" | "absent";
  metrics: {
    totalSelectors: number;
    totalDefinitions: number;
    confirmedUsages: number;
    distinctUsageFiles: number | null;
    confirmedMatchedElements: number;
    partialMatches: number;
    unresolvedSelectors: number;
    unusedSelectors: number;
  };
  selectors: Array<{
    selector: string;
    category: string;
    status: "used" | "unused" | "partial" | "unknown";
    confidence: string;
    matchedElements: number;
    usageOccurrences: number;
    usageFiles: number;
    partialElements: number;
    unresolvedElements: number;
    hasUnprovenRuntimeState: boolean;
    hasUnprovenPositional: boolean;
    definitions: Array<{
      file: string;
      line?: number;
      column?: number;
      count: number;
    }>;
    usageByFile: Array<{ file: string; count: number }>;
    notes: string[];
  }>;
  notes: string[];
};

/**
 * CSS analysis extracted from check `analyzeCss` results.
 * Usage matrix / at-rule inventories are not present on check JSON → null.
 */
export type GuiCssAnalysis = {
  totals: {
    files: number;
    sizeBytes: number;
    rules: number;
    selectors: number;
    declarations: number;
    importantDeclarations: number;
    uniqueClasses: number;
    uniqueIds: number;
    uniqueTags: number;
    maxNestingDepth: number;
    warningCount: number;
  };
  files: GuiFileInsight[];
  selectors: GuiSelectorRow[];
  kindDistribution: GuiCountBucket[];
  specificityBuckets: GuiCountBucket[];
  deadCssCandidates: GuiDeadCssCandidate[];
  /**
   * Page/file usage of class tokens. Null until a report source provides
   * pageUsage (not fabricated from CSS definition selectors).
   */
  usage: GuiCssUsage | null;
  /**
   * Canonical selector analysis contract. Null when absent on the envelope
   * (legacy reports). Empty selectors with completeness `legacy-class-only`
   * means class bags only — not full selector analysis.
   */
  selectorAnalysis: GuiSelectorAnalysis | null;
  /** At-rule inventory — not exported by analyzeCss today. */
  atRules: null;
  notes: string[];
};

export type GuiOptimizationDecision = {
  id: string;
  category: string;
  type: string;
  title: string;
  explanation: string;
  reason: string;
  confidence: string;
  changed: boolean;
  filePath?: string;
  selector?: string;
  bytesBefore?: number | null;
  bytesAfter?: number | null;
};

export type GuiOptimizationFile = {
  path: string;
  inputBytes: number;
  outputBytes: number;
  /** Core-reported eliminated bytes (may include redistribution — see notes). */
  bytesEliminated: number;
  eliminationPercent: number | null;
  emittedBytesTotal: number;
  redistributedBytes: number;
  chunks: Array<{
    name: string;
    kind: string;
    sizeBytes: number;
    oversized: boolean;
    variables: boolean;
    page?: string | null;
  }>;
};

export type GuiOptimization = {
  command: "optimize" | "split";
  dryRun: boolean;
  summary: {
    inputBytes: number;
    /** Serialized/emitted CSS bytes after the pipeline. */
    outputBytes: number;
    /** Core `impact.bytesEliminated` (do not equate to net download savings alone). */
    bytesEliminated: number;
    eliminationPercent: number | null;
    emittedBytesTotal: number;
    redistributedBytes: number;
    rulesRemovedEstimate: number;
    selectorsRemoved: number;
    chunksCreated: number;
    fileCount: number;
  };
  operations: {
    minified: boolean;
    pageCoverageSplit: boolean;
    sizeBudgetSplit: boolean;
    variablesIsolated: boolean;
    deadCodeEliminated: boolean;
  };
  files: GuiOptimizationFile[];
  decisions: GuiOptimizationDecision[];
  warnings: string[];
  notes: string[];
};

export type GuiSplitStatus =
  | "completed"
  | "completed_with_warnings"
  | "failed"
  | "unavailable";

export type GuiChunkClassification =
  | "common"
  | "page-specific"
  | "variables"
  | "other";

export type GuiChunk = {
  id: string;
  name: string;
  kind: string;
  sizeBytes: number;
  oversized: boolean;
  variables: boolean;
  page?: string | null;
  sourceFile: string;
  classification: GuiChunkClassification;
};

export type GuiSplitting = {
  status: GuiSplitStatus;
  inputFileCount: number;
  chunkCount: number;
  totalChunkBytes: number;
  oversizedCount: number;
  pageCoverageSplit: boolean;
  sizeBudgetSplit: boolean;
  warnings: string[];
  chunks: GuiChunk[];
  relatedDecisions: GuiOptimizationDecision[];
  notes: string[];
};

export type GuiRegressionStatus =
  | "healthy"
  | "improved"
  | "regressed"
  | "mixed"
  | "inconclusive";

export type GuiComparisonStatus =
  | "completed"
  | "baseline_missing"
  | "baseline_incompatible"
  | "failed"
  | "unavailable";

export type GuiSnapshotRef = {
  score: number;
  grade: string;
  status: string;
  timestamp: string;
  toolVersion: string;
  sizeBytes: number;
  rules: number;
  selectors: number;
  declarations: number;
  files: number;
};

export type GuiSizeDelta = {
  baseline: number;
  current: number;
  changeBytes: number;
  changePercent: number | null;
};

export type GuiCountDelta = {
  baseline: number;
  current: number;
  change: number;
  changePercent: number | null;
};

export type GuiDimensionDelta = {
  id: string;
  baseline: number | null;
  current: number | null;
  change: number | null;
  evaluatedBaseline: boolean;
  evaluatedCurrent: boolean;
};

export type GuiDiagnosticDiffEntry = {
  fingerprint: string;
  code: string;
  severity: string;
  category: string;
  filePath?: string;
  selector?: string;
  message: string;
};

export type GuiFileDiffEntry = {
  path: string;
  baselineSizeBytes?: number | null;
  currentSizeBytes?: number | null;
  sizeChangePercent?: number | null;
  contentChanged: boolean;
  qualityRegressed: boolean;
};

export type GuiRegression = {
  comparisonStatus: GuiComparisonStatus;
  /** Core regression status when comparison completed; null otherwise. */
  status: GuiRegressionStatus | null;
  baselinePath?: string;
  baseline: GuiSnapshotRef | null;
  current: GuiSnapshotRef | null;
  scoreChange: number | null;
  changes: {
    cssSize: GuiSizeDelta;
    rules: GuiCountDelta;
    selectors: GuiCountDelta;
    declarations: GuiCountDelta;
    dimensions: GuiDimensionDelta[];
  } | null;
  diagnostics: {
    new: GuiDiagnosticDiffEntry[];
    resolved: GuiDiagnosticDiffEntry[];
    persistent: GuiDiagnosticDiffEntry[];
    changed: GuiDiagnosticDiffEntry[];
  } | null;
  files: {
    added: GuiFileDiffEntry[];
    removed: GuiFileDiffEntry[];
    modified: GuiFileDiffEntry[];
    regressed: GuiFileDiffEntry[];
    unchanged: number;
  } | null;
  warnings: string[];
  errors: string[];
  qualityGates: {
    passed: boolean;
    results: Array<{
      id: string;
      label: string;
      passed: boolean;
      detail: string;
    }>;
    failureSummary?: string;
  } | null;
  notes: string[];
};

export type GuiExplorerFile = {
  path: string;
  sizeBytes?: number;
  selectorCount?: number;
  declarationCount?: number;
  diagnosticCount?: number;
  hasAnalysis: boolean;
  hasOptimization: boolean;
  hasSplitting: boolean;
  hasRegression: boolean;
  qualityRegressed?: boolean;
  chunkNames: string[];
};

/**
 * Normalized report for the GUI.
 * Optional sections are `null` when the source did not provide them (not empty).
 */
export type GuiReport = {
  schemaVersion: typeof GUI_REPORT_SCHEMA_VERSION;
  loadedAt: string;
  source: GuiReportSource;
  metadata: {
    generatedAt?: string;
    cwd?: string;
    patterns?: string[];
    success?: boolean;
    errors: string[];
    threshold?: number | null;
    failUnder?: number | null;
    dryRun?: boolean;
    baselinePath?: string;
  };
  summary: GuiReportSummary | null;
  health: GuiHealth | null;
  diagnostics: GuiDiagnostic[];
  diagnosticCounts: GuiDiagnosticCounts;
  files: GuiFileInsight[] | null;
  cssAnalysis: GuiCssAnalysis | null;
  optimization: GuiOptimization | null;
  splitting: GuiSplitting | null;
  regression: GuiRegression | null;
};

export type GuiReportLoadResult =
  | { ok: true; report: GuiReport }
  | {
      ok: false;
      code:
        | "not_found"
        | "invalid_json"
        | "unsupported_format"
        | "incompatible_schema"
        | "permission_denied"
        | "read_failure"
        | "validation_error"
        | "analysis_failure"
        | "no_report";
      message: string;
    };
