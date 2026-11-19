import {
  legacyClassOnlyAnalysis,
  parseSelectorAnalysis,
  type SelectorAnalysisReport,
} from "@zealakit/css-doctor-shared";

import {
  GUI_REPORT_SCHEMA_VERSION,
  type GuiChunk,
  type GuiChunkClassification,
  type GuiSplitStatus,
  type GuiCountBucket,
  type GuiCssAnalysis,
  type GuiCssUsage,
  type GuiDeadCssCandidate,
  type GuiDiagnostic,
  type GuiDiagnosticCounts,
  type GuiDiagnosticDiffEntry,
  type GuiDimension,
  type GuiDimensionDelta,
  type GuiFileDiffEntry,
  type GuiFileInsight,
  type GuiHealth,
  type GuiOptimization,
  type GuiOptimizationDecision,
  type GuiOptimizationFile,
  type GuiRegression,
  type GuiRegressionStatus,
  type GuiReport,
  type GuiReportSource,
  type GuiSelectorAnalysis,
  type GuiSelectorRow,
  type GuiSeverity,
  type GuiSnapshotRef,
  type GuiSplitting,
} from "./report-model";

type UnknownRecord = Record<string, unknown>;

export type NormalizeOptions = {
  source: GuiReportSource;
  loadedAt?: string;
};

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function detectSourceCommand(
  value: unknown,
): "check" | "health" | "optimize" | "split" | "diff" | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.command === "check" && Array.isArray(value.files)) {
    return "check";
  }
  if (
    (value.command === "optimize" || value.command === "split") &&
    Array.isArray(value.files)
  ) {
    return value.command;
  }
  if (value.command === "diff") {
    return "diff";
  }
  if (value.command === "health" && "health" in value) {
    return "health";
  }
  if (
    typeof value.overall === "number" &&
    typeof value.grade === "string" &&
    Array.isArray(value.diagnostics) &&
    Array.isArray(value.dimensions)
  ) {
    return "health";
  }
  return null;
}

export function normalizeUnknownReport(
  value: unknown,
  options: NormalizeOptions,
): GuiReport {
  const command = detectSourceCommand(value);
  if (command === "check") {
    return normalizeCheckReport(value, options);
  }
  if (command === "health") {
    return normalizeHealthReport(value, options);
  }
  if (command === "optimize" || command === "split") {
    return normalizeOptimizeReport(value, options, command);
  }
  if (command === "diff") {
    return normalizeDiffReport(value, options);
  }
  throw new Error("Unsupported report format");
}

export function normalizeCheckReport(
  value: unknown,
  options: NormalizeOptions,
): GuiReport {
  if (!isRecord(value)) {
    throw new Error("Check report must be an object");
  }
  assertCompatibleSchema(value.schemaVersion);

  const health = value.health == null ? null : normalizeHealth(value.health);
  const files = Array.isArray(value.files)
    ? value.files.map((file, index) => normalizeFileInsight(file, index))
    : null;

  const checkDiagnostics = files
    ? flattenCheckIssues(value.files as unknown[])
    : [];
  const healthDiagnostics = health
    ? isRecord(value.health)
      ? normalizeHealthDiagnostics(value.health.diagnostics)
      : []
    : [];

  const diagnostics = [...healthDiagnostics, ...checkDiagnostics];
  const summary = normalizeCheckSummary(value.summary, files);
  const classUsage = normalizeCheckClassUsage(value.classUsage);
  const selectorAnalysis = resolveCheckSelectorAnalysis(
    value.selectorAnalysis,
    classUsage,
  );
  const cssAnalysis = Array.isArray(value.files)
    ? buildCssAnalysisFromCheckFiles(
        value.files,
        diagnostics,
        classUsage,
        selectorAnalysis,
      )
    : null;

  return {
    schemaVersion: GUI_REPORT_SCHEMA_VERSION,
    loadedAt: options.loadedAt ?? new Date().toISOString(),
    source: {
      ...options.source,
      command: "check",
      toolVersion:
        typeof value.version === "string"
          ? value.version
          : options.source.toolVersion,
    },
    metadata: {
      generatedAt:
        typeof value.generatedAt === "string" ? value.generatedAt : undefined,
      cwd: typeof value.cwd === "string" ? value.cwd : undefined,
      patterns: asStringArray(value.patterns),
      success: typeof value.success === "boolean" ? value.success : undefined,
      errors: asStringArray(value.errors) ?? [],
      threshold: asNullableNumber(value.threshold),
      failUnder: asNullableNumber(value.failUnder),
    },
    summary,
    health,
    diagnostics,
    diagnosticCounts: countDiagnostics(diagnostics),
    files,
    cssAnalysis,
    optimization: null,
    splitting: null,
    regression: null,
  };
}

export function normalizeHealthReport(
  value: unknown,
  options: NormalizeOptions,
): GuiReport {
  if (!isRecord(value)) {
    throw new Error("Health report must be an object");
  }

  const nestedHealth = isRecord(value.health) ? value.health : value;
  if (isRecord(value.health)) {
    assertCompatibleSchema(value.schemaVersion);
  } else {
    assertCompatibleSchema(nestedHealth.schemaVersion);
  }

  const health = normalizeHealth(nestedHealth);
  const diagnostics = normalizeHealthDiagnostics(
    isRecord(nestedHealth) ? nestedHealth.diagnostics : undefined,
  );

  return {
    schemaVersion: GUI_REPORT_SCHEMA_VERSION,
    loadedAt: options.loadedAt ?? new Date().toISOString(),
    source: {
      ...options.source,
      command: "health",
    },
    metadata: {
      generatedAt: undefined,
      cwd: undefined,
      patterns: asStringArray(value.patterns),
      success: typeof value.success === "boolean" ? value.success : undefined,
      errors: asStringArray(value.errors) ?? [],
      threshold: asNullableNumber(value.threshold),
      failUnder: asNullableNumber(value.failUnder),
    },
    summary: health
      ? {
          fileCount: health.summary.files,
          analyzedFileCount: health.summary.files,
          failedFileCount: 0,
          filesWithIssues: diagnostics.length > 0 ? health.summary.files : 0,
          totalSizeBytes: health.summary.sizeBytes,
          rules: health.summary.rules,
          selectors: health.summary.selectors,
          declarations: health.summary.declarations,
          analysisMs: health.summary.analysisMs,
        }
      : null,
    health,
    diagnostics,
    diagnosticCounts: countDiagnostics(diagnostics),
    files: null,
    cssAnalysis: null,
    optimization: null,
    splitting: null,
    regression: null,
  };
}

export function normalizeOptimizeReport(
  value: unknown,
  options: NormalizeOptions,
  command: "optimize" | "split",
): GuiReport {
  if (!isRecord(value)) {
    throw new Error("Optimize report must be an object");
  }
  assertCompatibleSchema(value.schemaVersion);

  const optimization = buildOptimization(value, command);
  const files = optimization.files.map((file) => ({
    path: file.path,
    sizeBytes: file.inputBytes,
    ok: true,
    issueCount: 0,
  }));

  return {
    schemaVersion: GUI_REPORT_SCHEMA_VERSION,
    loadedAt: options.loadedAt ?? new Date().toISOString(),
    source: {
      ...options.source,
      command,
      kind:
        options.source.kind === "optimize-json" ||
        options.source.kind === "split-json"
          ? options.source.kind
          : command === "split"
            ? "split-json"
            : "optimize-json",
    },
    metadata: {
      generatedAt: undefined,
      cwd: undefined,
      patterns: asStringArray(value.patterns),
      success: typeof value.success === "boolean" ? value.success : undefined,
      errors: asStringArray(value.errors) ?? [],
      dryRun: value.dryRun === true,
    },
    summary: {
      fileCount: optimization.summary.fileCount,
      analyzedFileCount: optimization.summary.fileCount,
      failedFileCount: 0,
      filesWithIssues: 0,
      totalSizeBytes: optimization.summary.inputBytes,
      rules: 0,
      selectors: 0,
      declarations: 0,
    },
    health: null,
    diagnostics: [],
    diagnosticCounts: countDiagnostics([]),
    files,
    cssAnalysis: null,
    optimization,
    splitting: buildSplitting(optimization, value),
    regression: null,
  };
}

export function normalizeDiffReport(
  value: unknown,
  options: NormalizeOptions,
): GuiReport {
  if (!isRecord(value)) {
    throw new Error("Diff report must be an object");
  }
  assertCompatibleSchema(value.schemaVersion);

  const regression = buildRegression(value);
  const fileInsights = explorerFilesFromRegression(regression);

  return {
    schemaVersion: GUI_REPORT_SCHEMA_VERSION,
    loadedAt: options.loadedAt ?? new Date().toISOString(),
    source: {
      ...options.source,
      command: "diff",
      kind: "diff-json",
    },
    metadata: {
      generatedAt: undefined,
      cwd: undefined,
      patterns: undefined,
      success: typeof value.success === "boolean" ? value.success : undefined,
      errors: asStringArray(value.errors) ?? [],
      baselinePath:
        typeof value.baselinePath === "string" ? value.baselinePath : undefined,
    },
    summary: regression.current
      ? {
          fileCount: regression.current.files,
          analyzedFileCount: regression.current.files,
          failedFileCount: 0,
          filesWithIssues: 0,
          totalSizeBytes: regression.current.sizeBytes,
          rules: regression.current.rules,
          selectors: regression.current.selectors,
          declarations: regression.current.declarations,
        }
      : null,
    health: null,
    diagnostics: [],
    diagnosticCounts: countDiagnostics([]),
    files: fileInsights.length > 0 ? fileInsights : null,
    cssAnalysis: null,
    optimization: null,
    splitting: null,
    regression,
  };
}

function buildSplitting(
  optimization: GuiOptimization,
  raw: UnknownRecord,
): GuiSplitting {
  const chunks: GuiChunk[] = [];
  for (const file of optimization.files) {
    for (const chunk of file.chunks) {
      chunks.push({
        id: `${file.path}:${chunk.name}:${chunk.kind}`,
        name: chunk.name,
        kind: chunk.kind,
        sizeBytes: chunk.sizeBytes,
        oversized: chunk.oversized,
        variables: chunk.variables,
        page: chunk.page,
        sourceFile: file.path,
        classification: classifyChunk(chunk),
      });
    }
  }

  const warnings = [
    ...optimization.warnings,
    ...(asStringArray(raw.warnings) ?? []),
  ];
  const uniqueWarnings = Array.from(new Set(warnings));
  const success = raw.success !== false;
  const oversizedCount = chunks.filter((chunk) => chunk.oversized).length;
  const relatedDecisions = optimization.decisions.filter((decision) =>
    /split|coverage|budget|chunk|page-coverage|size-budget/i.test(
      `${decision.category} ${decision.type} ${decision.title}`,
    ),
  );

  return {
    status: resolveSplitStatus({
      success,
      warnings: uniqueWarnings,
      chunkCount: chunks.length,
      oversizedCount,
    }),
    inputFileCount: optimization.summary.fileCount,
    chunkCount: chunks.length,
    totalChunkBytes: chunks.reduce((sum, chunk) => sum + chunk.sizeBytes, 0),
    oversizedCount,
    pageCoverageSplit: optimization.operations.pageCoverageSplit,
    sizeBudgetSplit: optimization.operations.sizeBudgetSplit,
    warnings: uniqueWarnings,
    chunks,
    relatedDecisions,
    notes: [
      "Chunk metadata comes from Core optimize/split impact.chunks.",
      "Relationships between chunks are not exposed as a dependency graph by Core.",
      "oversized reflects Core size-budget flags on individual chunks.",
    ],
  };
}

function classifyChunk(chunk: {
  kind: string;
  variables: boolean;
  page?: string | null;
}): GuiChunkClassification {
  if (chunk.variables || chunk.kind === "variables") {
    return "variables";
  }
  if (chunk.kind === "common") {
    return "common";
  }
  if (chunk.kind === "page" || chunk.page) {
    return "page-specific";
  }
  return "other";
}

function resolveSplitStatus(input: {
  success: boolean;
  warnings: string[];
  chunkCount: number;
  oversizedCount: number;
}): GuiSplitStatus {
  if (!input.success) {
    return "failed";
  }
  if (input.chunkCount === 0) {
    return "unavailable";
  }
  if (input.warnings.length > 0 || input.oversizedCount > 0) {
    return "completed_with_warnings";
  }
  return "completed";
}

function buildRegression(value: UnknownRecord): GuiRegression {
  const errors = asStringArray(value.errors) ?? [];
  const warnings = asStringArray(value.warnings) ?? [];
  const baselinePath =
    typeof value.baselinePath === "string" ? value.baselinePath : undefined;
  const raw = value.regression;

  if (raw == null) {
    const incompatible = errors.some((error) => /incompatible/i.test(error));
    const missingBaseline =
      !incompatible && errors.some((error) => /baseline/i.test(error));
    return {
      comparisonStatus: incompatible
        ? "baseline_incompatible"
        : missingBaseline
          ? "baseline_missing"
          : "failed",
      status: null,
      baselinePath,
      baseline: null,
      current: null,
      scoreChange: null,
      changes: null,
      diagnostics: null,
      files: null,
      warnings,
      errors,
      qualityGates: null,
      notes: [
        "Diff JSON did not include a regression payload.",
        incompatible
          ? "Baseline is incompatible with this tool/schema version."
          : missingBaseline
            ? "Baseline appears missing or unreadable."
            : "Comparison failed before producing Core regression output.",
      ],
    };
  }

  if (!isRecord(raw)) {
    return {
      comparisonStatus: "failed",
      status: null,
      baselinePath,
      baseline: null,
      current: null,
      scoreChange: null,
      changes: null,
      diagnostics: null,
      files: null,
      warnings,
      errors,
      qualityGates: null,
      notes: ["regression field was present but not an object."],
    };
  }

  const baseline = normalizeSnapshot(raw.baseline);
  const current = normalizeSnapshot(raw.current);
  const changes = isRecord(raw.changes) ? raw.changes : null;
  const diagnostics = isRecord(raw.diagnostics) ? raw.diagnostics : null;
  const files = isRecord(raw.files) ? raw.files : null;
  const gates = isRecord(raw.qualityGates) ? raw.qualityGates : null;

  return {
    comparisonStatus: value.success === false ? "failed" : "completed",
    status: normalizeRegressionStatus(raw.status),
    baselinePath,
    baseline,
    current,
    scoreChange:
      changes && typeof changes.score === "number" ? changes.score : null,
    changes: changes
      ? {
          cssSize: normalizeSizeDelta(changes.cssSize),
          rules: normalizeCountDelta(changes.rules),
          selectors: normalizeCountDelta(changes.selectors),
          declarations: normalizeCountDelta(changes.declarations),
          dimensions: Array.isArray(changes.dimensions)
            ? changes.dimensions
                .map(normalizeDimensionDelta)
                .filter((item): item is GuiDimensionDelta => item !== null)
            : [],
        }
      : null,
    diagnostics: diagnostics
      ? {
          new: normalizeDiagnosticDiffList(diagnostics.new),
          resolved: normalizeDiagnosticDiffList(diagnostics.resolved),
          persistent: normalizeDiagnosticDiffList(diagnostics.persistent),
          changed: normalizeDiagnosticDiffList(diagnostics.changed),
        }
      : null,
    files: files
      ? {
          added: normalizeFileDiffList(files.added),
          removed: normalizeFileDiffList(files.removed),
          modified: normalizeFileDiffList(files.modified),
          regressed: normalizeFileDiffList(files.regressed),
          unchanged: numberOr(files.unchanged, 0),
        }
      : null,
    warnings: [...warnings, ...(asStringArray(raw.warnings) ?? [])],
    errors,
    qualityGates:
      gates && typeof gates.passed === "boolean"
        ? {
            passed: gates.passed,
            results: Array.isArray(gates.results)
              ? gates.results.flatMap((item) => {
                  if (
                    !isRecord(item) ||
                    typeof item.id !== "string" ||
                    typeof item.label !== "string"
                  ) {
                    return [];
                  }
                  return [
                    {
                      id: item.id,
                      label: item.label,
                      passed: item.passed === true,
                      detail:
                        typeof item.detail === "string" ? item.detail : "",
                    },
                  ];
                })
              : [],
            failureSummary:
              typeof gates.failureSummary === "string"
                ? gates.failureSummary
                : undefined,
          }
        : null,
    notes: [
      "Regression status and deltas come from Core compare_baselines / CLI diff JSON.",
      "GUI does not redefine what counts as a regression.",
    ],
  };
}

function normalizeSnapshot(value: unknown): GuiSnapshotRef | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.score !== "number" || typeof value.grade !== "string") {
    return null;
  }
  return {
    score: value.score,
    grade: value.grade,
    status: typeof value.status === "string" ? value.status : "unknown",
    timestamp: typeof value.timestamp === "string" ? value.timestamp : "",
    toolVersion: typeof value.toolVersion === "string" ? value.toolVersion : "",
    sizeBytes: numberOr(value.sizeBytes, 0),
    rules: numberOr(value.rules, 0),
    selectors: numberOr(value.selectors, 0),
    declarations: numberOr(value.declarations, 0),
    files: numberOr(value.files, 0),
  };
}

function normalizeRegressionStatus(value: unknown): GuiRegressionStatus | null {
  if (typeof value !== "string") {
    return null;
  }
  if (
    value === "healthy" ||
    value === "improved" ||
    value === "regressed" ||
    value === "mixed" ||
    value === "inconclusive"
  ) {
    return value;
  }
  return null;
}

function normalizeSizeDelta(value: unknown): {
  baseline: number;
  current: number;
  changeBytes: number;
  changePercent: number | null;
} {
  if (!isRecord(value)) {
    return { baseline: 0, current: 0, changeBytes: 0, changePercent: null };
  }
  return {
    baseline: numberOr(value.baseline, 0),
    current: numberOr(value.current, 0),
    changeBytes: numberOr(value.changeBytes, 0),
    changePercent:
      typeof value.changePercent === "number" ? value.changePercent : null,
  };
}

function normalizeCountDelta(value: unknown): {
  baseline: number;
  current: number;
  change: number;
  changePercent: number | null;
} {
  if (!isRecord(value)) {
    return { baseline: 0, current: 0, change: 0, changePercent: null };
  }
  return {
    baseline: numberOr(value.baseline, 0),
    current: numberOr(value.current, 0),
    change: numberOr(value.change, 0),
    changePercent:
      typeof value.changePercent === "number" ? value.changePercent : null,
  };
}

function normalizeDimensionDelta(value: unknown): GuiDimensionDelta | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }
  return {
    id: value.id,
    baseline: typeof value.baseline === "number" ? value.baseline : null,
    current: typeof value.current === "number" ? value.current : null,
    change: typeof value.change === "number" ? value.change : null,
    evaluatedBaseline: value.evaluatedBaseline === true,
    evaluatedCurrent: value.evaluatedCurrent === true,
  };
}

function normalizeDiagnosticDiffList(value: unknown): GuiDiagnosticDiffEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.fingerprint !== "string") {
      return [];
    }
    return [
      {
        fingerprint: item.fingerprint,
        code: typeof item.code === "string" ? item.code : "unknown",
        severity: typeof item.severity === "string" ? item.severity : "unknown",
        category: typeof item.category === "string" ? item.category : "unknown",
        filePath: typeof item.filePath === "string" ? item.filePath : undefined,
        selector: typeof item.selector === "string" ? item.selector : undefined,
        message: typeof item.message === "string" ? item.message : "",
      },
    ];
  });
}

function normalizeFileDiffList(value: unknown): GuiFileDiffEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.path !== "string") {
      return [];
    }
    return [
      {
        path: item.path,
        baselineSizeBytes:
          typeof item.baselineSizeBytes === "number" ||
          item.baselineSizeBytes === null
            ? (item.baselineSizeBytes as number | null)
            : undefined,
        currentSizeBytes:
          typeof item.currentSizeBytes === "number" ||
          item.currentSizeBytes === null
            ? (item.currentSizeBytes as number | null)
            : undefined,
        sizeChangePercent:
          typeof item.sizeChangePercent === "number" ||
          item.sizeChangePercent === null
            ? (item.sizeChangePercent as number | null)
            : undefined,
        contentChanged: item.contentChanged === true,
        qualityRegressed: item.qualityRegressed === true,
      },
    ];
  });
}

function explorerFilesFromRegression(
  regression: GuiRegression,
): GuiFileInsight[] {
  if (!regression.files) {
    return [];
  }
  const paths = new Map<string, GuiFileInsight>();
  const push = (entry: GuiFileDiffEntry) => {
    paths.set(entry.path, {
      path: entry.path,
      sizeBytes: entry.currentSizeBytes ?? entry.baselineSizeBytes ?? 0,
      ok: true,
      issueCount: entry.qualityRegressed ? 1 : 0,
    });
  };
  for (const entry of regression.files.added) {
    push(entry);
  }
  for (const entry of regression.files.removed) {
    push(entry);
  }
  for (const entry of regression.files.modified) {
    push(entry);
  }
  for (const entry of regression.files.regressed) {
    push(entry);
  }
  return Array.from(paths.values()).sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

function buildOptimization(
  value: UnknownRecord,
  command: "optimize" | "split",
): GuiOptimization {
  const fileEntries = Array.isArray(value.files) ? value.files : [];
  const files: GuiOptimizationFile[] = [];
  const decisions: GuiOptimizationDecision[] = [];
  let inputBytes = 0;
  let outputBytes = 0;
  let bytesEliminated = 0;
  let emittedBytesTotal = 0;
  let redistributedBytes = 0;
  let rulesRemovedEstimate = 0;
  let selectorsRemoved = 0;
  let chunksCreated = 0;
  const eliminationPercents: number[] = [];
  let operations = {
    minified: false,
    pageCoverageSplit: false,
    sizeBudgetSplit: false,
    variablesIsolated: false,
    deadCodeEliminated: false,
  };

  for (const entry of fileEntries) {
    if (!isRecord(entry) || !isRecord(entry.report)) {
      continue;
    }
    const report = entry.report;
    const path = typeof entry.path === "string" ? entry.path : "unknown";
    const input = isRecord(report.input) ? report.input : {};
    const impact = isRecord(report.impact) ? report.impact : {};
    const ops = isRecord(report.operations) ? report.operations : {};
    const fileInputBytes = numberOr(input.bytes, 0);
    const fileEmitted = numberOr(
      impact.emittedBytesTotal,
      numberOr(
        isRecord(report.output) ? report.output.bytes : undefined,
        fileInputBytes,
      ),
    );
    const fileEliminated = numberOr(impact.bytesEliminated, 0);
    const fileRedistributed = numberOr(impact.redistributedBytes, 0);
    const filePercent =
      typeof impact.eliminationPercent === "number"
        ? impact.eliminationPercent
        : null;

    inputBytes += fileInputBytes;
    outputBytes += fileEmitted;
    bytesEliminated += fileEliminated;
    emittedBytesTotal += fileEmitted;
    redistributedBytes += fileRedistributed;
    rulesRemovedEstimate += numberOr(impact.rulesRemovedEstimate, 0);
    selectorsRemoved += numberOr(impact.selectorsRemoved, 0);
    chunksCreated += numberOr(impact.chunksCreated, 0);
    if (filePercent !== null) {
      eliminationPercents.push(filePercent);
    }

    operations = {
      minified: operations.minified || ops.minified === true,
      pageCoverageSplit:
        operations.pageCoverageSplit || ops.pageCoverageSplit === true,
      sizeBudgetSplit:
        operations.sizeBudgetSplit || ops.sizeBudgetSplit === true,
      variablesIsolated:
        operations.variablesIsolated || ops.variablesIsolated === true,
      deadCodeEliminated:
        operations.deadCodeEliminated || ops.deadCodeEliminated === true,
    };

    const chunks = Array.isArray(report.chunks)
      ? report.chunks.flatMap((chunk) => {
          if (!isRecord(chunk) || typeof chunk.name !== "string") {
            return [];
          }
          return [
            {
              name: chunk.name,
              kind: typeof chunk.kind === "string" ? chunk.kind : "unknown",
              sizeBytes: numberOr(chunk.sizeBytes, 0),
              oversized: chunk.oversized === true,
              variables: chunk.variables === true,
              page: typeof chunk.page === "string" ? chunk.page : null,
            },
          ];
        })
      : [];

    files.push({
      path,
      inputBytes: fileInputBytes,
      outputBytes: fileEmitted,
      bytesEliminated: fileEliminated,
      eliminationPercent: filePercent,
      emittedBytesTotal: fileEmitted,
      redistributedBytes: fileRedistributed,
      chunks,
    });

    if (Array.isArray(report.decisions)) {
      for (const decision of report.decisions) {
        const normalized = normalizeDecision(decision, path);
        if (normalized) {
          decisions.push(normalized);
        }
      }
    }
  }

  const topWarnings = asStringArray(value.warnings) ?? [];
  const avgPercent =
    eliminationPercents.length > 0
      ? eliminationPercents.reduce((sum, value) => sum + value, 0) /
        eliminationPercents.length
      : null;

  return {
    command,
    dryRun: value.dryRun === true,
    summary: {
      inputBytes,
      outputBytes,
      bytesEliminated,
      eliminationPercent: avgPercent,
      emittedBytesTotal,
      redistributedBytes,
      rulesRemovedEstimate,
      selectorsRemoved,
      chunksCreated,
      fileCount: files.length,
    },
    operations,
    files,
    decisions,
    warnings: topWarnings,
    notes: [
      "bytesEliminated comes from Core impact metadata and may include redistribution across chunks — it is not always equal to inputBytes − emittedBytesTotal.",
      "eliminationPercent is reported by Core per file; multi-file views show the average of provided percents.",
    ],
  };
}

function normalizeDecision(
  value: unknown,
  fallbackPath: string,
): GuiOptimizationDecision | null {
  if (!isRecord(value) || typeof value.title !== "string") {
    return null;
  }
  const source = isRecord(value.source) ? value.source : {};
  const impact = isRecord(value.impact) ? value.impact : {};
  return {
    id: typeof value.id === "string" ? value.id : value.title,
    category: typeof value.category === "string" ? value.category : "unknown",
    type: typeof value.type === "string" ? value.type : "unknown",
    title: value.title,
    explanation: typeof value.explanation === "string" ? value.explanation : "",
    reason: typeof value.reason === "string" ? value.reason : "",
    confidence:
      typeof value.confidence === "string" ? value.confidence : "unknown",
    changed: value.changed === true,
    filePath:
      typeof source.file === "string" ? source.file : fallbackPath || undefined,
    selector: typeof source.selector === "string" ? source.selector : undefined,
    bytesBefore:
      typeof impact.bytesBefore === "number" || impact.bytesBefore === null
        ? (impact.bytesBefore as number | null)
        : undefined,
    bytesAfter:
      typeof impact.bytesAfter === "number" || impact.bytesAfter === null
        ? (impact.bytesAfter as number | null)
        : undefined,
  };
}

function normalizeCheckClassUsage(value: unknown): GuiCssUsage | null {
  if (!isRecord(value) || !isRecord(value.byClass)) {
    return null;
  }
  // Empty byClass still marks usage as present (scan ran; no hits).
  // Newer fields are optional for backward-compatible reports.
  return {
    byClass: normalizeUsageHitRecord(value.byClass, "class"),
    byId: isRecord(value.byId) ? normalizeUsageHitRecord(value.byId, "id") : {},
    byTag: isRecord(value.byTag)
      ? normalizeUsageHitRecord(value.byTag, "tag")
      : {},
    byAttribute: isRecord(value.byAttribute)
      ? normalizeUsageHitRecord(value.byAttribute, "attribute")
      : {},
  };
}

/**
 * Prefer canonical `selectorAnalysis`. Legacy `classUsage`-only envelopes become
 * a `legacy-class-only` projection — never treated as full selector analysis.
 * Unsupported future schema versions fail closed with a note (report still loads).
 */
function resolveCheckSelectorAnalysis(
  value: unknown,
  classUsage: GuiCssUsage | null,
): GuiSelectorAnalysis | null {
  const parsed = parseSelectorAnalysis(value);
  if (parsed.ok) {
    return toGuiSelectorAnalysis(parsed.report);
  }

  if (parsed.code === "unsupported_schema") {
    return {
      schemaVersion:
        typeof value === "object" &&
        value !== null &&
        "schemaVersion" in value &&
        typeof (value as { schemaVersion?: unknown }).schemaVersion === "number"
          ? (value as { schemaVersion: number }).schemaVersion
          : -1,
      completeness: "absent",
      metrics: {
        totalSelectors: 0,
        totalDefinitions: 0,
        confirmedUsages: 0,
        distinctUsageFiles: null,
        confirmedMatchedElements: 0,
        partialMatches: 0,
        unresolvedSelectors: 0,
        unusedSelectors: 0,
      },
      selectors: [],
      notes: [parsed.message],
    };
  }

  if (parsed.code === "invalid") {
    return {
      schemaVersion: 0,
      completeness: "absent",
      metrics: {
        totalSelectors: 0,
        totalDefinitions: 0,
        confirmedUsages: 0,
        distinctUsageFiles: null,
        confirmedMatchedElements: 0,
        partialMatches: 0,
        unresolvedSelectors: 0,
        unusedSelectors: 0,
      },
      selectors: [],
      notes: [parsed.message],
    };
  }

  // Absent: optional legacy classUsage → never invent selector match rows.
  if (classUsage) {
    const hasNonClass =
      Object.keys(classUsage.byId).length > 0 ||
      Object.keys(classUsage.byTag).length > 0 ||
      Object.keys(classUsage.byAttribute).length > 0;
    if (!hasNonClass) {
      return toGuiSelectorAnalysis(
        legacyClassOnlyAnalysis({
          byClass: classUsage.byClass,
          scannedFiles: 0,
        }),
      );
    }
    // Symbol bags without selectorAnalysis → symbols-only completeness.
    return toGuiSelectorAnalysis({
      ...legacyClassOnlyAnalysis({
        byClass: classUsage.byClass,
        scannedFiles: 0,
        notes: [
          "Report has symbol bags without selectorAnalysis; not full Core match output.",
        ],
      }),
      completeness: "symbols-only",
    });
  }

  return null;
}

function toGuiSelectorAnalysis(
  report: SelectorAnalysisReport,
): GuiSelectorAnalysis {
  return {
    schemaVersion: report.schemaVersion,
    completeness: report.completeness,
    metrics: {
      totalSelectors: report.metrics.totalSelectors,
      totalDefinitions: report.metrics.totalDefinitions,
      confirmedUsages: report.metrics.confirmedUsages,
      distinctUsageFiles: report.metrics.distinctUsageFiles,
      confirmedMatchedElements: report.metrics.confirmedMatchedElements,
      partialMatches: report.metrics.partialMatches,
      unresolvedSelectors: report.metrics.unresolvedSelectors,
      unusedSelectors: report.metrics.unusedSelectors,
    },
    selectors: report.selectors.map((row) => ({
      selector: row.selector,
      category: row.category,
      status: row.status,
      confidence: row.confidence,
      matchedElements: row.matchedElements,
      usageOccurrences: row.usageOccurrences,
      usageFiles: row.usageFiles,
      partialElements: row.partialElements,
      unresolvedElements: row.unresolvedElements,
      hasUnprovenRuntimeState: row.hasUnprovenRuntimeState,
      hasUnprovenPositional: row.hasUnprovenPositional,
      ...(row.level ? { level: row.level } : {}),
      ...(row.sources ? { sources: row.sources } : {}),
      definitions: row.definitions.map((definition) => ({
        file: definition.file,
        line: definition.line,
        column: definition.column,
        count: definition.count,
      })),
      usageByFile: row.usageByFile.map((hit) => ({
        file: hit.file,
        count: hit.count,
      })),
      notes: [...row.notes],
    })),
    notes: [...report.notes],
  };
}

function normalizeUsageHitRecord(
  record: Record<string, unknown>,
  kind: "class" | "id" | "tag" | "attribute",
): Record<string, Array<{ file: string; count: number }>> {
  const out: Record<string, Array<{ file: string; count: number }>> = {};
  for (const [rawToken, hits] of Object.entries(record)) {
    const token = normalizeUsageToken(rawToken, kind);
    if (!token || !Array.isArray(hits)) {
      continue;
    }
    const normalizedHits = [];
    for (const hit of hits) {
      if (!isRecord(hit) || typeof hit.file !== "string" || !hit.file.trim()) {
        continue;
      }
      const count =
        typeof hit.count === "number" && Number.isFinite(hit.count)
          ? Math.max(0, Math.trunc(hit.count))
          : 0;
      if (count <= 0) {
        continue;
      }
      normalizedHits.push({ file: hit.file.trim(), count });
    }
    if (normalizedHits.length > 0) {
      out[token] = normalizedHits;
    }
  }
  return out;
}

function normalizeUsageToken(
  raw: string,
  kind: "class" | "id" | "tag" | "attribute",
): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  if (kind === "class") {
    return trimmed.replace(/^\./, "");
  }
  if (kind === "id") {
    return trimmed.replace(/^#/, "");
  }
  return trimmed;
}

function buildCssAnalysisFromCheckFiles(
  files: unknown[],
  diagnostics: GuiDiagnostic[],
  usage: GuiCssUsage | null = null,
  selectorAnalysis: GuiSelectorAnalysis | null = null,
): GuiCssAnalysis | null {
  const insights = files.map((file, index) =>
    normalizeFileInsight(file, index),
  );
  const hasStats = insights.some(
    (file) => typeof file.selectorCount === "number",
  );
  if (!hasStats) {
    return null;
  }

  const selectors: GuiSelectorRow[] = [];
  const kindCounts = new Map<string, number>();
  const specificityCounts = new Map<string, number>();

  files.forEach((file, fileIndex) => {
    if (!isRecord(file) || !isRecord(file.result)) {
      return;
    }
    const filePath =
      typeof file.path === "string" ? file.path : `unknown-${fileIndex}`;
    const result = file.result;
    const rules = Array.isArray(result.rules) ? result.rules : [];
    if (!Array.isArray(result.selectors)) {
      return;
    }
    result.selectors.forEach((selector, selectorIndex) => {
      if (!isRecord(selector) || typeof selector.raw !== "string") {
        return;
      }
      const kinds = asStringArray(selector.kinds) ?? [];
      for (const kind of kinds) {
        kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
      }
      const specificity = isRecord(selector.specificity)
        ? selector.specificity
        : {};
      const ids = numberOr(specificity.ids, 0);
      const classes = numberOr(specificity.classes, 0);
      const types = numberOr(specificity.types, 0);
      const bucket = specificityBucketLabel(ids, classes, types);
      specificityCounts.set(bucket, (specificityCounts.get(bucket) ?? 0) + 1);

      const rule =
        typeof selector.ruleIndex === "number"
          ? rules[selector.ruleIndex]
          : undefined;
      const location =
        isRecord(rule) && isRecord(rule.location) ? rule.location : undefined;

      selectors.push({
        id: `${filePath}:${selectorIndex}:${selector.raw}`,
        filePath,
        raw: selector.raw,
        kinds,
        classes: asStringArray(selector.classes) ?? [],
        ids: asStringArray(selector.ids) ?? [],
        tags: asStringArray(selector.tags) ?? [],
        attributes: asStringArray(selector.attributes) ?? [],
        specificityIds: ids,
        specificityClasses: classes,
        specificityTypes: types,
        nestingDepth: numberOr(selector.nestingDepth, 0),
        line: typeof location?.line === "number" ? location.line : undefined,
        column:
          typeof location?.column === "number" ? location.column : undefined,
      });
    });
  });

  const deadCssCandidates = diagnosticsToDeadCandidates(diagnostics);

  return {
    totals: {
      files: insights.length,
      sizeBytes: insights.reduce((sum, file) => sum + file.sizeBytes, 0),
      rules: insights.reduce((sum, file) => sum + (file.ruleCount ?? 0), 0),
      selectors: insights.reduce(
        (sum, file) => sum + (file.selectorCount ?? 0),
        0,
      ),
      declarations: insights.reduce(
        (sum, file) => sum + (file.declarationCount ?? 0),
        0,
      ),
      importantDeclarations: insights.reduce(
        (sum, file) => sum + (file.importantDeclarationCount ?? 0),
        0,
      ),
      uniqueClasses: insights.reduce(
        (sum, file) => sum + (file.uniqueClassCount ?? 0),
        0,
      ),
      uniqueIds: insights.reduce(
        (sum, file) => sum + (file.uniqueIdCount ?? 0),
        0,
      ),
      uniqueTags: insights.reduce(
        (sum, file) => sum + (file.uniqueTagCount ?? 0),
        0,
      ),
      maxNestingDepth: insights.reduce(
        (max, file) => Math.max(max, file.maxNestingDepth ?? 0),
        0,
      ),
      warningCount: insights.reduce(
        (sum, file) => sum + (file.warningCount ?? 0),
        0,
      ),
    },
    files: insights,
    selectors,
    kindDistribution: mapToBuckets(kindCounts),
    specificityBuckets: mapToBuckets(specificityCounts),
    deadCssCandidates,
    usage,
    selectorAnalysis,
    atRules: null,
    notes: [
      "Selector kinds and specificity come from Core analyzeCss output.",
      "At-rule inventories are not exported by analyzeCss yet.",
      ...selectorAnalysisNotes(selectorAnalysis, usage),
      "Dead CSS entries are candidates from diagnostics (empty-rule / health dead_*), not confirmed unused-via-usage.",
    ],
  };
}

function selectorAnalysisNotes(
  selectorAnalysis: GuiSelectorAnalysis | null,
  usage: GuiCssUsage | null,
): string[] {
  if (selectorAnalysis) {
    const notes = [...selectorAnalysis.notes];
    switch (selectorAnalysis.completeness) {
      case "full":
        notes.push(
          "Selector analysis metrics come from Core matchSelectorsAgainstMarkup (confirmed usages only).",
        );
        break;
      case "symbols-only":
        notes.push(
          "Symbol bags present without full Core selector match rows.",
        );
        break;
      case "legacy-class-only":
        notes.push(
          "Legacy class-only usage — not interpreted as complete selector analysis.",
        );
        break;
      case "absent":
        notes.push(
          "Selector analysis section is present but incomplete or unsupported.",
        );
        break;
      default:
        break;
    }
    return notes;
  }
  if (usage) {
    return [
      "Selector usage comes from literal class/id/tag/attribute scans in project source (cn/clsx and :hover/:focus are not claimed).",
    ];
  }
  return [
    "Class usage was not present on this report (run `css-doctor gui` to attach source usage).",
  ];
}

function diagnosticsToDeadCandidates(
  diagnostics: GuiDiagnostic[],
): GuiDeadCssCandidate[] {
  return diagnostics
    .filter((item) => {
      const code = item.code.toLowerCase();
      return (
        code === "empty-rule" ||
        code.startsWith("dead.") ||
        item.category === "dead_code"
      );
    })
    .map((item) => ({
      id: item.id,
      status: "candidate" as const,
      code: item.code,
      message: item.message,
      filePath: item.filePath,
      selector: item.selector,
      line: item.line,
      column: item.column,
      remediation: item.remediation,
    }));
}

function specificityBucketLabel(
  ids: number,
  classes: number,
  types: number,
): string {
  if (ids > 0) {
    return `id:${ids}`;
  }
  if (classes > 0) {
    return `class/pseudo:${classes}`;
  }
  if (types > 0) {
    return `type:${types}`;
  }
  return "universal/other";
}

function mapToBuckets(map: Map<string, number>): GuiCountBucket[] {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.key.localeCompare(right.key),
    );
}

function assertCompatibleSchema(schemaVersion: unknown): void {
  if (schemaVersion === undefined || schemaVersion === null) {
    return;
  }
  if (typeof schemaVersion !== "number" || schemaVersion !== 1) {
    throw new IncompatibleSchemaError(
      `Unsupported source schemaVersion: ${String(schemaVersion)}`,
    );
  }
}

export class IncompatibleSchemaError extends Error {
  readonly code = "incompatible_schema" as const;
}

function normalizeHealth(value: unknown): GuiHealth | null {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.overall !== "number" || typeof value.grade !== "string") {
    throw new Error("Invalid health report: missing overall/grade");
  }

  const summary = isRecord(value.summary) ? value.summary : {};
  const dimensions = Array.isArray(value.dimensions)
    ? value.dimensions.map(normalizeDimension).filter(Boolean)
    : [];

  return {
    overall: value.overall,
    grade: value.grade,
    status: typeof value.status === "string" ? value.status : "unknown",
    schemaVersion:
      typeof value.schemaVersion === "number" ? value.schemaVersion : 1,
    dimensions: dimensions as GuiDimension[],
    recommendations: asStringArray(value.recommendations) ?? [],
    summary: {
      files: numberOr(summary.files, 0),
      rules: numberOr(summary.rules, 0),
      selectors: numberOr(summary.selectors, 0),
      declarations: numberOr(summary.declarations, 0),
      sizeBytes: numberOr(summary.sizeBytes, 0),
      errors: numberOr(summary.errors, 0),
      warnings: numberOr(summary.warnings, 0),
      suggestions: numberOr(summary.suggestions, 0),
      analysisMs: numberOr(summary.analysisMs, 0),
    },
  };
}

function normalizeDimension(value: unknown): GuiDimension | null {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }
  return {
    id: value.id,
    score: typeof value.score === "number" ? value.score : null,
    weight: numberOr(value.weight, 0),
    effectiveWeight: numberOr(value.effectiveWeight, 0),
    evaluated: value.evaluated === true,
    issueCount: numberOr(value.issueCount, 0),
    errorCount: numberOr(value.errorCount, 0),
    warningCount: numberOr(value.warningCount, 0),
    infoCount: numberOr(value.infoCount, 0),
    diagnosticCodes: asStringArray(value.diagnosticCodes) ?? [],
    recommendations: asStringArray(value.recommendations) ?? [],
    note: typeof value.note === "string" ? value.note : undefined,
  };
}

function normalizeHealthDiagnostics(value: unknown): GuiDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item, index) => {
    if (!isRecord(item) || typeof item.message !== "string") {
      return [];
    }
    const location = isRecord(item.location) ? item.location : undefined;
    return [
      {
        id: `health:${typeof item.code === "string" ? item.code : "unknown"}:${index}`,
        severity: normalizeSeverity(item.severity),
        code: typeof item.code === "string" ? item.code : "unknown",
        message: item.message,
        category: typeof item.category === "string" ? item.category : undefined,
        filePath: typeof item.filePath === "string" ? item.filePath : undefined,
        line: typeof location?.line === "number" ? location.line : undefined,
        column:
          typeof location?.column === "number" ? location.column : undefined,
        selector: typeof item.selector === "string" ? item.selector : undefined,
        remediation:
          typeof item.remediation === "string" ? item.remediation : undefined,
        source: "health" as const,
      },
    ];
  });
}

function flattenCheckIssues(files: unknown[]): GuiDiagnostic[] {
  const diagnostics: GuiDiagnostic[] = [];
  files.forEach((file, fileIndex) => {
    if (!isRecord(file) || !Array.isArray(file.issues)) {
      return;
    }
    const filePath = typeof file.path === "string" ? file.path : undefined;
    file.issues.forEach((issue, issueIndex) => {
      if (!isRecord(issue) || typeof issue.message !== "string") {
        return;
      }
      const location = isRecord(issue.location) ? issue.location : undefined;
      const kind = typeof issue.kind === "string" ? issue.kind : "issue";
      diagnostics.push({
        id: `check:${fileIndex}:${issueIndex}:${kind}`,
        severity: normalizeSeverity(issue.severity),
        code: kind,
        message: issue.message,
        category: "check",
        filePath,
        line: typeof location?.line === "number" ? location.line : undefined,
        column:
          typeof location?.column === "number" ? location.column : undefined,
        selector:
          typeof issue.selector === "string" ? issue.selector : undefined,
        source: "check",
      });
    });
  });
  return diagnostics;
}

function normalizeFileInsight(value: unknown, index: number): GuiFileInsight {
  if (!isRecord(value)) {
    return {
      path: `unknown-${index}`,
      sizeBytes: 0,
      ok: false,
      issueCount: 0,
      error: "Invalid file entry",
    };
  }
  const result = isRecord(value.result) ? value.result : undefined;
  const stats = result && isRecord(result.stats) ? result.stats : undefined;
  return {
    path: typeof value.path === "string" ? value.path : `unknown-${index}`,
    absolutePath:
      typeof value.absolutePath === "string" ? value.absolutePath : undefined,
    sizeBytes: numberOr(value.sizeBytes, 0),
    ok: value.ok === true,
    issueCount: Array.isArray(value.issues) ? value.issues.length : 0,
    error: typeof value.error === "string" ? value.error : undefined,
    selectorCount:
      typeof stats?.selectorCount === "number"
        ? stats.selectorCount
        : undefined,
    ruleCount:
      typeof stats?.ruleCount === "number" ? stats.ruleCount : undefined,
    declarationCount:
      typeof stats?.declarationCount === "number"
        ? stats.declarationCount
        : undefined,
    importantDeclarationCount:
      typeof stats?.importantDeclarationCount === "number"
        ? stats.importantDeclarationCount
        : undefined,
    uniqueClassCount:
      typeof stats?.uniqueClassCount === "number"
        ? stats.uniqueClassCount
        : undefined,
    uniqueIdCount:
      typeof stats?.uniqueIdCount === "number"
        ? stats.uniqueIdCount
        : undefined,
    uniqueTagCount:
      typeof stats?.uniqueTagCount === "number"
        ? stats.uniqueTagCount
        : undefined,
    maxNestingDepth:
      typeof stats?.maxNestingDepth === "number"
        ? stats.maxNestingDepth
        : undefined,
    warningCount:
      typeof stats?.warningCount === "number" ? stats.warningCount : undefined,
  };
}

function normalizeCheckSummary(
  value: unknown,
  files: GuiFileInsight[] | null,
): GuiReport["summary"] {
  if (isRecord(value)) {
    return {
      fileCount: numberOr(value.files, files?.length ?? 0),
      analyzedFileCount: numberOr(value.analyzed, 0),
      failedFileCount: numberOr(value.failed, 0),
      filesWithIssues: numberOr(value.filesWithIssues, 0),
      totalSizeBytes: numberOr(value.totalSizeBytes, 0),
      rules: numberOr(value.rules, 0),
      selectors: numberOr(value.selectors, 0),
      declarations: numberOr(value.declarations, 0),
      analysisMs:
        typeof value.analysisMs === "number" ? value.analysisMs : undefined,
      totalMs: typeof value.totalMs === "number" ? value.totalMs : undefined,
    };
  }
  if (!files) {
    return null;
  }
  return {
    fileCount: files.length,
    analyzedFileCount: files.filter((file) => file.ok).length,
    failedFileCount: files.filter((file) => !file.ok).length,
    filesWithIssues: files.filter((file) => file.issueCount > 0).length,
    totalSizeBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
    rules: files.reduce((sum, file) => sum + (file.ruleCount ?? 0), 0),
    selectors: files.reduce((sum, file) => sum + (file.selectorCount ?? 0), 0),
    declarations: files.reduce(
      (sum, file) => sum + (file.declarationCount ?? 0),
      0,
    ),
  };
}

export function normalizeSeverity(value: unknown): GuiSeverity {
  if (typeof value !== "string") {
    return "unknown";
  }
  const normalized = value.toLowerCase();
  if (normalized === "error" || normalized === "critical") {
    return "error";
  }
  if (normalized === "warning" || normalized === "warn") {
    return "warning";
  }
  if (
    normalized === "info" ||
    normalized === "suggestion" ||
    normalized === "hint"
  ) {
    return "info";
  }
  return "unknown";
}

export function countDiagnostics(
  diagnostics: GuiDiagnostic[],
): GuiDiagnosticCounts {
  const counts: GuiDiagnosticCounts = {
    error: 0,
    warning: 0,
    info: 0,
    unknown: 0,
    total: diagnostics.length,
  };
  for (const diagnostic of diagnostics) {
    counts[diagnostic.severity] += 1;
  }
  return counts;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function asNullableNumber(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return typeof value === "number" ? value : undefined;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
