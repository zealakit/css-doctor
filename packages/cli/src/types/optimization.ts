export type OptimizationDecision = {
  id: string;
  category: string;
  type: string;
  title: string;
  explanation: string;
  reason: string;
  source: {
    file?: string | null;
    selector?: string | null;
    line?: number | null;
    column?: number | null;
  };
  destination?: string | null;
  impact: {
    bytesBefore?: number | null;
    bytesAfter?: number | null;
    rulesAffected?: number | null;
    selectorsAffected?: number | null;
  };
  confidence: string;
  changed: boolean;
  relatedDiagnostics: string[];
  routes: string[];
};

export type OptimizationReport = {
  schemaVersion: number;
  input: {
    files: number;
    bytes: number;
    rules: number;
    selectors: number;
    declarations: number;
  };
  output: {
    files: number;
    bytes: number;
    rules: number;
    selectors: number;
    declarations: number;
  };
  impact: {
    bytesEliminated: number;
    eliminationPercent: number | null;
    emittedBytesTotal: number;
    redistributedBytes: number;
    rulesRemovedEstimate: number;
    selectorsRemoved: number;
    chunksCreated: number;
    variablesChunks: number;
  };
  operations: {
    minified: boolean;
    pageCoverageSplit: boolean;
    sizeBudgetSplit: boolean;
    variablesIsolated: boolean;
    deadCodeEliminated: boolean;
  };
  chunks: Array<{
    name: string;
    kind: string;
    sizeBytes: number;
    oversized: boolean;
    variables: boolean;
    page?: string | null;
  }>;
  decisions: OptimizationDecision[];
  warnings: string[];
  analysisMs: number;
};

export type FixCatalogEntry = {
  id: string;
  description: string;
  safety: "safe" | "review" | "unsafe";
  reason: string;
};

export type FixApplicationResult = {
  schemaVersion: number;
  filePath?: string | null;
  originalCss: string;
  fixedCss: string;
  changed: boolean;
  dryRun: boolean;
  plan: {
    schemaVersion: number;
    safeCount: number;
    reviewCount: number;
    unsafeCount: number;
    items: Array<{
      id: string;
      rule: string;
      safety: string;
      message: string;
      applied: boolean;
      skippedReason?: string | null;
      selector?: string | null;
    }>;
  };
  decisions: OptimizationDecision[];
  bytesBefore: number;
  bytesAfter: number;
};
