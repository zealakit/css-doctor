export type RegressionStatus =
  | "healthy"
  | "improved"
  | "regressed"
  | "mixed"
  | "inconclusive";

export type SnapshotRef = {
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

export type SizeDelta = {
  baseline: number;
  current: number;
  changeBytes: number;
  changePercent: number | null;
};

export type CountDelta = {
  baseline: number;
  current: number;
  change: number;
  changePercent: number | null;
};

export type DimensionDelta = {
  id: string;
  baseline: number | null;
  current: number | null;
  change: number | null;
  evaluatedBaseline: boolean;
  evaluatedCurrent: boolean;
};

export type DiagnosticDiffEntry = {
  fingerprint: string;
  code: string;
  severity: string;
  category: string;
  filePath?: string | null;
  selector?: string | null;
  message: string;
};

export type FileDiffEntry = {
  path: string;
  baselineSizeBytes?: number | null;
  currentSizeBytes?: number | null;
  sizeChangePercent?: number | null;
  contentChanged: boolean;
  qualityRegressed: boolean;
};

export type GateCheckResult = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type GateEvaluation = {
  passed: boolean;
  results: GateCheckResult[];
  failureSummary?: string | null;
};

export type RegressionReport = {
  schemaVersion: number;
  status: RegressionStatus;
  baseline: SnapshotRef;
  current: SnapshotRef;
  changes: {
    score: number;
    cssSize: SizeDelta;
    rules: CountDelta;
    selectors: CountDelta;
    declarations: CountDelta;
    dimensions: DimensionDelta[];
  };
  diagnostics: {
    new: DiagnosticDiffEntry[];
    resolved: DiagnosticDiffEntry[];
    persistent: DiagnosticDiffEntry[];
    changed: DiagnosticDiffEntry[];
  };
  files: {
    added: FileDiffEntry[];
    removed: FileDiffEntry[];
    modified: FileDiffEntry[];
    regressed: FileDiffEntry[];
    unchanged: number;
  };
  warnings: string[];
  qualityGates?: GateEvaluation | null;
};
