import * as http from 'http';
import { IncomingMessage, ServerResponse, Server } from 'node:http';

type CreateGuiHttpServerOptions = {
    staticDir?: string;
    apiOnly?: boolean;
};
declare function createGuiHttpServer(options?: CreateGuiHttpServerOptions): http.Server<typeof IncomingMessage, typeof ServerResponse>;

declare const DEFAULT_HOST = "127.0.0.1";
/** Prefer 4193 — Vite's preview default is 4173 and often conflicts. */
declare const PREFERRED_PORT = 4193;
declare const FALLBACK_PORT_MAX = 4293;

type GuiServerOptions = {
    host?: string;
    port?: number;
    strictPort?: boolean;
    open?: boolean;
    staticDir?: string;
    /** When true, do not serve SPA assets (API-only, used with Vite proxy). */
    apiOnly?: boolean;
    /** Optional JSON report to preload into the session before listen. */
    reportPath?: string;
};
type GuiServerListenResult = {
    host: string;
    port: number;
    url: string;
    close: () => Promise<void>;
};
type GuiHealthResponse = {
    ok: true;
    service: "css-doctor-gui";
    mode: "web";
    version: string;
    now: string;
};

declare function listenGuiServer(server: Server, options?: GuiServerOptions): Promise<GuiServerListenResult>;

type StartGuiServerOptions = GuiServerOptions & {
    /** Print listen URL to stdout (default true). */
    printUrl?: boolean;
};
/**
 * Starts the local Web runtime: API + optional SPA static assets.
 */
declare function startGuiServer(options?: StartGuiServerOptions): Promise<GuiServerListenResult>;

/**
 * Best-effort browser open. Failures are returned, never thrown.
 */
declare function openBrowser(url: string): Promise<{
    ok: true;
} | {
    ok: false;
    error: string;
}>;

type DesktopLaunchResult = {
    ok: true;
    command: string;
    args: string[];
    path: string;
} | {
    ok: false;
    code: "not_installed" | "not_found";
    message: string;
};
/**
 * Resolves a built CSS Doctor desktop binary/app without starting Web mode.
 * Desktop requires a prior `pnpm --filter css-doctor-gui desktop:build`.
 */
declare function resolveDesktopApp(): DesktopLaunchResult;
declare function launchDesktopApp(): Promise<DesktopLaunchResult>;

/** GUI report schema version (independent of CSS Doctor engine versions). */
declare const GUI_REPORT_SCHEMA_VERSION: 1;
type GuiSeverity = "error" | "warning" | "info" | "unknown";
type GuiReportSourceKind$1 = "check-json" | "health-json" | "generated-check" | "optimize-json" | "split-json" | "diff-json";
type GuiReportSource = {
    kind: GuiReportSourceKind$1;
    command: "check" | "health" | "optimize" | "split" | "diff";
    toolVersion?: string;
    path?: string;
};
type GuiDimension = {
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
type GuiHealth = {
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
type GuiDiagnostic = {
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
type GuiFileInsight = {
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
type GuiReportSummary = {
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
type GuiDiagnosticCounts = {
    error: number;
    warning: number;
    info: number;
    unknown: number;
    total: number;
};
type GuiCountBucket = {
    key: string;
    count: number;
};
type GuiSelectorRow = {
    id: string;
    filePath: string;
    raw: string;
    kinds: string[];
    specificityIds: number;
    specificityClasses: number;
    specificityTypes: number;
    nestingDepth: number;
    line?: number;
    column?: number;
};
type GuiDeadCssCandidate = {
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
/**
 * CSS analysis extracted from check `analyzeCss` results.
 * Usage matrix / at-rule inventories are not present on check JSON → null.
 */
type GuiCssAnalysis = {
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
    /** Page usage / coverage — not available from check/health alone. */
    usage: null;
    /** At-rule inventory — not exported by analyzeCss today. */
    atRules: null;
    notes: string[];
};
type GuiOptimizationDecision = {
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
type GuiOptimizationFile = {
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
type GuiOptimization = {
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
type GuiSplitStatus = "completed" | "completed_with_warnings" | "failed" | "unavailable";
type GuiChunkClassification = "common" | "page-specific" | "variables" | "other";
type GuiChunk = {
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
type GuiSplitting = {
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
type GuiRegressionStatus = "healthy" | "improved" | "regressed" | "mixed" | "inconclusive";
type GuiComparisonStatus = "completed" | "baseline_missing" | "baseline_incompatible" | "failed" | "unavailable";
type GuiSnapshotRef = {
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
type GuiSizeDelta = {
    baseline: number;
    current: number;
    changeBytes: number;
    changePercent: number | null;
};
type GuiCountDelta = {
    baseline: number;
    current: number;
    change: number;
    changePercent: number | null;
};
type GuiDimensionDelta = {
    id: string;
    baseline: number | null;
    current: number | null;
    change: number | null;
    evaluatedBaseline: boolean;
    evaluatedCurrent: boolean;
};
type GuiDiagnosticDiffEntry = {
    fingerprint: string;
    code: string;
    severity: string;
    category: string;
    filePath?: string;
    selector?: string;
    message: string;
};
type GuiFileDiffEntry = {
    path: string;
    baselineSizeBytes?: number | null;
    currentSizeBytes?: number | null;
    sizeChangePercent?: number | null;
    contentChanged: boolean;
    qualityRegressed: boolean;
};
type GuiRegression = {
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
/**
 * Normalized report for the GUI.
 * Optional sections are `null` when the source did not provide them (not empty).
 */
type GuiReport = {
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
type GuiReportLoadResult = {
    ok: true;
    report: GuiReport;
} | {
    ok: false;
    code: "not_found" | "invalid_json" | "unsupported_format" | "incompatible_schema" | "permission_denied" | "read_failure" | "validation_error" | "analysis_failure" | "no_report";
    message: string;
};

type LoadReportFileOptions = {
    /** Absolute or relative path to a JSON report. */
    path: string;
    /** Base directory for relative paths (defaults to process.cwd()). */
    cwd?: string;
};
declare function loadReportFromFile(options: LoadReportFileOptions): Promise<GuiReportLoadResult>;

type GenerateCheckOptions = {
    patterns: string[];
    cwd?: string;
    threshold?: number;
};
/**
 * Runs a check-like analysis via the NAPI binding and normalizes to GuiReport.
 * Mirrors CLI `runCheck` outputs without depending on the CLI package (avoids
 * a workspace cycle: cli → gui).
 */
declare function generateCheckReport(options: GenerateCheckOptions): Promise<GuiReportLoadResult>;

type GuiReportSourceKind = "file" | "upload" | "generate";
type GuiReportSessionSource = {
    kind: GuiReportSourceKind;
    /** Absolute path when kind is file; display label otherwise. */
    path?: string;
    label: string;
    reloadable: boolean;
};
type GuiReportSession = {
    report: GuiReport | null;
    source: GuiReportSessionSource | null;
};
declare function getCurrentReport(): GuiReport | null;
declare function getReportSessionSource(): GuiReportSessionSource | null;
declare function getReportSession(): GuiReportSession;
declare function setCurrentReport(report: GuiReport | null, source?: GuiReportSessionSource | null): void;
declare function clearReportSession(): void;

export { DEFAULT_HOST, type DesktopLaunchResult, FALLBACK_PORT_MAX, GUI_REPORT_SCHEMA_VERSION, type GuiDiagnostic, type GuiHealthResponse, type GuiReport, type GuiReportLoadResult, type GuiReportSessionSource, type GuiServerListenResult, type GuiServerOptions, PREFERRED_PORT, type StartGuiServerOptions, clearReportSession, createGuiHttpServer, generateCheckReport, getCurrentReport, getReportSession, getReportSessionSource, launchDesktopApp, listenGuiServer, loadReportFromFile, openBrowser, resolveDesktopApp, setCurrentReport, startGuiServer };
