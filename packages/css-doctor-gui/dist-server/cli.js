#!/usr/bin/env node

// server/desktop.ts
import { existsSync } from "fs";
import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { platform } from "os";
var packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
function resolveDesktopApp() {
  const override = process.env.CSS_DOCTOR_GUI_DESKTOP?.trim();
  if (override) {
    if (!existsSync(override)) {
      return {
        ok: false,
        code: "not_found",
        message: `CSS_DOCTOR_GUI_DESKTOP points to a missing path: ${override}`
      };
    }
    return launchSpecForPath(override);
  }
  const candidates = desktopCandidates();
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return launchSpecForPath(candidate);
    }
  }
  return {
    ok: false,
    code: "not_installed",
    message: "Desktop app is not installed or built for this machine.\nBuild it with: pnpm --filter css-doctor-gui desktop:build\nOr set CSS_DOCTOR_GUI_DESKTOP to the app/binary path.\nWeb mode: css-doctor gui   (omit --desktop)"
  };
}
async function launchDesktopApp() {
  const resolved = resolveDesktopApp();
  if (!resolved.ok) {
    return resolved;
  }
  const child = spawn(resolved.command, resolved.args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  return resolved;
}
function desktopCandidates() {
  const release = join(packageRoot, "src-tauri/target/release");
  const bundle = join(release, "bundle");
  const os = platform();
  if (os === "darwin") {
    return [
      join(bundle, "macos/CSS Doctor.app"),
      join(release, "css-doctor-gui")
    ];
  }
  if (os === "win32") {
    return [
      join(bundle, "msi/CSS Doctor.msi"),
      join(bundle, "nsis/CSS Doctor.exe"),
      join(release, "css-doctor-gui.exe")
    ];
  }
  return [
    join(bundle, "appimage/css-doctor-gui.AppImage"),
    join(release, "css-doctor-gui")
  ];
}
function launchSpecForPath(path) {
  if (platform() === "darwin" && path.endsWith(".app")) {
    return {
      ok: true,
      path,
      command: "open",
      args: ["-n", path]
    };
  }
  if (platform() === "win32" && path.toLowerCase().endsWith(".msi")) {
    return {
      ok: false,
      code: "not_installed",
      message: "Found an MSI artifact, but it is an installer \u2014 install it first, then set CSS_DOCTOR_GUI_DESKTOP to the installed app."
    };
  }
  return {
    ok: true,
    path,
    command: path,
    args: []
  };
}

// server/start.ts
import { existsSync as existsSync4 } from "fs";
import { dirname as dirname3, join as join5 } from "path";
import { fileURLToPath as fileURLToPath3 } from "url";
import { basename as basename2 } from "path";

// server/create-server.ts
import { createServer as createHttpServer } from "http";
import { join as join4 } from "path";

// server/middleware/security.ts
function applySecurityHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("cache-control", "no-store");
  res.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
}
function isLoopbackHost(hostHeader) {
  if (!hostHeader) {
    return false;
  }
  const host = hostHeader.split(":")[0]?.toLowerCase() ?? "";
  return isLoopbackHostname(host);
}
function isLoopbackHostname(hostname) {
  const host = hostname.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]" || host === "::1";
}
function rejectNonLoopback(req, res) {
  if (isLoopbackHost(req.headers.host)) {
    return false;
  }
  res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error: "Forbidden host" }));
  return true;
}
function rejectDisallowedMutation(req, res) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return false;
  }
  const origin = headerString(req.headers.origin);
  if (origin) {
    if (!isLoopbackWebOrigin(origin)) {
      forbid(res, "Forbidden origin");
      return true;
    }
    return false;
  }
  const referer = headerString(req.headers.referer);
  if (referer && !isLoopbackWebOrigin(referer)) {
    forbid(res, "Forbidden referer");
    return true;
  }
  const fetchSite = headerString(req.headers["sec-fetch-site"]);
  if (fetchSite === "cross-site") {
    forbid(res, "Forbidden cross-site request");
    return true;
  }
  return false;
}
function isLoopbackWebOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    return isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}
function headerString(value) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return void 0;
}
function forbid(res, message) {
  res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, code: "forbidden", message }));
}

// server/services/log.ts
import process2 from "process";
function guiLog(level, message, fields = {}) {
  const parts = [`css-doctor-gui:${level}`, message];
  for (const [key, value] of Object.entries(fields)) {
    if (value === void 0 || value === null) {
      continue;
    }
    parts.push(`${key}=${sanitizeField(key, value)}`);
  }
  process2.stderr.write(`${parts.join(" ")}
`);
}
function sanitizeField(key, value) {
  if (typeof value !== "string") {
    return String(value);
  }
  if (/path|file|cwd|dir/i.test(key)) {
    return redactPath(value);
  }
  if (value.length > 180) {
    return `${value.slice(0, 177)}...`;
  }
  return value;
}
function redactPath(path) {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  const base = parts[parts.length - 1] ?? trimmed;
  if (parts.length <= 1) {
    return base;
  }
  return `\u2026/${base}`;
}

// server/routes/health.ts
import { existsSync as existsSync2, readFileSync } from "fs";
import { dirname as dirname2, join as join2 } from "path";
import { fileURLToPath as fileURLToPath2 } from "url";
function readPackageVersion() {
  const here = dirname2(fileURLToPath2(import.meta.url));
  const candidates = [
    join2(here, "../package.json"),
    join2(here, "../../package.json"),
    join2(here, "package.json")
  ];
  for (const candidate of candidates) {
    if (!existsSync2(candidate)) {
      continue;
    }
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf8"));
      if (pkg.name === "css-doctor-gui" && typeof pkg.version === "string") {
        return pkg.version;
      }
    } catch {
    }
  }
  return "0.0.0";
}
function handleHealth(_req, res) {
  const body = {
    ok: true,
    service: "css-doctor-gui",
    mode: "web",
    version: readPackageVersion(),
    now: (/* @__PURE__ */ new Date()).toISOString()
  };
  const payload = JSON.stringify(body);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

// server/routes/report.ts
import { basename } from "path";

// server/report/generate-check.ts
import { createRequire } from "module";
import { performance } from "perf_hooks";
import { readFile, stat } from "fs/promises";
import { isAbsolute, relative, resolve, sep } from "path";
import fg from "fast-glob";

// shared/report-model.ts
var GUI_REPORT_SCHEMA_VERSION = 1;

// shared/normalize.ts
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function detectSourceCommand(value) {
  if (!isRecord(value)) {
    return null;
  }
  if (value.command === "check" && Array.isArray(value.files)) {
    return "check";
  }
  if ((value.command === "optimize" || value.command === "split") && Array.isArray(value.files)) {
    return value.command;
  }
  if (value.command === "diff") {
    return "diff";
  }
  if (value.command === "health" && "health" in value) {
    return "health";
  }
  if (typeof value.overall === "number" && typeof value.grade === "string" && Array.isArray(value.diagnostics) && Array.isArray(value.dimensions)) {
    return "health";
  }
  return null;
}
function normalizeUnknownReport(value, options) {
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
function normalizeCheckReport(value, options) {
  if (!isRecord(value)) {
    throw new Error("Check report must be an object");
  }
  assertCompatibleSchema(value.schemaVersion);
  const health = value.health == null ? null : normalizeHealth(value.health);
  const files = Array.isArray(value.files) ? value.files.map((file, index) => normalizeFileInsight(file, index)) : null;
  const checkDiagnostics = files ? flattenCheckIssues(value.files) : [];
  const healthDiagnostics = health ? isRecord(value.health) ? normalizeHealthDiagnostics(value.health.diagnostics) : [] : [];
  const diagnostics = [...healthDiagnostics, ...checkDiagnostics];
  const summary = normalizeCheckSummary(value.summary, files);
  const cssAnalysis = Array.isArray(value.files) ? buildCssAnalysisFromCheckFiles(value.files, diagnostics) : null;
  return {
    schemaVersion: GUI_REPORT_SCHEMA_VERSION,
    loadedAt: options.loadedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    source: {
      ...options.source,
      command: "check",
      toolVersion: typeof value.version === "string" ? value.version : options.source.toolVersion
    },
    metadata: {
      generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : void 0,
      cwd: typeof value.cwd === "string" ? value.cwd : void 0,
      patterns: asStringArray(value.patterns),
      success: typeof value.success === "boolean" ? value.success : void 0,
      errors: asStringArray(value.errors) ?? [],
      threshold: asNullableNumber(value.threshold),
      failUnder: asNullableNumber(value.failUnder)
    },
    summary,
    health,
    diagnostics,
    diagnosticCounts: countDiagnostics(diagnostics),
    files,
    cssAnalysis,
    optimization: null,
    splitting: null,
    regression: null
  };
}
function normalizeHealthReport(value, options) {
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
    isRecord(nestedHealth) ? nestedHealth.diagnostics : void 0
  );
  return {
    schemaVersion: GUI_REPORT_SCHEMA_VERSION,
    loadedAt: options.loadedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    source: {
      ...options.source,
      command: "health"
    },
    metadata: {
      generatedAt: void 0,
      cwd: void 0,
      patterns: asStringArray(value.patterns),
      success: typeof value.success === "boolean" ? value.success : void 0,
      errors: asStringArray(value.errors) ?? [],
      threshold: asNullableNumber(value.threshold),
      failUnder: asNullableNumber(value.failUnder)
    },
    summary: health ? {
      fileCount: health.summary.files,
      analyzedFileCount: health.summary.files,
      failedFileCount: 0,
      filesWithIssues: diagnostics.length > 0 ? health.summary.files : 0,
      totalSizeBytes: health.summary.sizeBytes,
      rules: health.summary.rules,
      selectors: health.summary.selectors,
      declarations: health.summary.declarations,
      analysisMs: health.summary.analysisMs
    } : null,
    health,
    diagnostics,
    diagnosticCounts: countDiagnostics(diagnostics),
    files: null,
    cssAnalysis: null,
    optimization: null,
    splitting: null,
    regression: null
  };
}
function normalizeOptimizeReport(value, options, command) {
  if (!isRecord(value)) {
    throw new Error("Optimize report must be an object");
  }
  assertCompatibleSchema(value.schemaVersion);
  const optimization = buildOptimization(value, command);
  const files = optimization.files.map((file) => ({
    path: file.path,
    sizeBytes: file.inputBytes,
    ok: true,
    issueCount: 0
  }));
  return {
    schemaVersion: GUI_REPORT_SCHEMA_VERSION,
    loadedAt: options.loadedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    source: {
      ...options.source,
      command,
      kind: options.source.kind === "optimize-json" || options.source.kind === "split-json" ? options.source.kind : command === "split" ? "split-json" : "optimize-json"
    },
    metadata: {
      generatedAt: void 0,
      cwd: void 0,
      patterns: asStringArray(value.patterns),
      success: typeof value.success === "boolean" ? value.success : void 0,
      errors: asStringArray(value.errors) ?? [],
      dryRun: value.dryRun === true
    },
    summary: {
      fileCount: optimization.summary.fileCount,
      analyzedFileCount: optimization.summary.fileCount,
      failedFileCount: 0,
      filesWithIssues: 0,
      totalSizeBytes: optimization.summary.inputBytes,
      rules: 0,
      selectors: 0,
      declarations: 0
    },
    health: null,
    diagnostics: [],
    diagnosticCounts: countDiagnostics([]),
    files,
    cssAnalysis: null,
    optimization,
    splitting: buildSplitting(optimization, value),
    regression: null
  };
}
function normalizeDiffReport(value, options) {
  if (!isRecord(value)) {
    throw new Error("Diff report must be an object");
  }
  assertCompatibleSchema(value.schemaVersion);
  const regression = buildRegression(value);
  const fileInsights = explorerFilesFromRegression(regression);
  return {
    schemaVersion: GUI_REPORT_SCHEMA_VERSION,
    loadedAt: options.loadedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
    source: {
      ...options.source,
      command: "diff",
      kind: "diff-json"
    },
    metadata: {
      generatedAt: void 0,
      cwd: void 0,
      patterns: void 0,
      success: typeof value.success === "boolean" ? value.success : void 0,
      errors: asStringArray(value.errors) ?? [],
      baselinePath: typeof value.baselinePath === "string" ? value.baselinePath : void 0
    },
    summary: regression.current ? {
      fileCount: regression.current.files,
      analyzedFileCount: regression.current.files,
      failedFileCount: 0,
      filesWithIssues: 0,
      totalSizeBytes: regression.current.sizeBytes,
      rules: regression.current.rules,
      selectors: regression.current.selectors,
      declarations: regression.current.declarations
    } : null,
    health: null,
    diagnostics: [],
    diagnosticCounts: countDiagnostics([]),
    files: fileInsights.length > 0 ? fileInsights : null,
    cssAnalysis: null,
    optimization: null,
    splitting: null,
    regression
  };
}
function buildSplitting(optimization, raw) {
  const chunks = [];
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
        classification: classifyChunk(chunk)
      });
    }
  }
  const warnings = [
    ...optimization.warnings,
    ...asStringArray(raw.warnings) ?? []
  ];
  const uniqueWarnings = Array.from(new Set(warnings));
  const success = raw.success !== false;
  const oversizedCount = chunks.filter((chunk) => chunk.oversized).length;
  const relatedDecisions = optimization.decisions.filter(
    (decision) => /split|coverage|budget|chunk|page-coverage|size-budget/i.test(
      `${decision.category} ${decision.type} ${decision.title}`
    )
  );
  return {
    status: resolveSplitStatus({
      success,
      warnings: uniqueWarnings,
      chunkCount: chunks.length,
      oversizedCount
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
      "oversized reflects Core size-budget flags on individual chunks."
    ]
  };
}
function classifyChunk(chunk) {
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
function resolveSplitStatus(input) {
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
function buildRegression(value) {
  const errors = asStringArray(value.errors) ?? [];
  const warnings = asStringArray(value.warnings) ?? [];
  const baselinePath = typeof value.baselinePath === "string" ? value.baselinePath : void 0;
  const raw = value.regression;
  if (raw == null) {
    const incompatible = errors.some((error) => /incompatible/i.test(error));
    const missingBaseline = !incompatible && errors.some((error) => /baseline/i.test(error));
    return {
      comparisonStatus: incompatible ? "baseline_incompatible" : missingBaseline ? "baseline_missing" : "failed",
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
        incompatible ? "Baseline is incompatible with this tool/schema version." : missingBaseline ? "Baseline appears missing or unreadable." : "Comparison failed before producing Core regression output."
      ]
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
      notes: ["regression field was present but not an object."]
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
    scoreChange: changes && typeof changes.score === "number" ? changes.score : null,
    changes: changes ? {
      cssSize: normalizeSizeDelta(changes.cssSize),
      rules: normalizeCountDelta(changes.rules),
      selectors: normalizeCountDelta(changes.selectors),
      declarations: normalizeCountDelta(changes.declarations),
      dimensions: Array.isArray(changes.dimensions) ? changes.dimensions.map(normalizeDimensionDelta).filter((item) => item !== null) : []
    } : null,
    diagnostics: diagnostics ? {
      new: normalizeDiagnosticDiffList(diagnostics.new),
      resolved: normalizeDiagnosticDiffList(diagnostics.resolved),
      persistent: normalizeDiagnosticDiffList(diagnostics.persistent),
      changed: normalizeDiagnosticDiffList(diagnostics.changed)
    } : null,
    files: files ? {
      added: normalizeFileDiffList(files.added),
      removed: normalizeFileDiffList(files.removed),
      modified: normalizeFileDiffList(files.modified),
      regressed: normalizeFileDiffList(files.regressed),
      unchanged: numberOr(files.unchanged, 0)
    } : null,
    warnings: [...warnings, ...asStringArray(raw.warnings) ?? []],
    errors,
    qualityGates: gates && typeof gates.passed === "boolean" ? {
      passed: gates.passed,
      results: Array.isArray(gates.results) ? gates.results.flatMap((item) => {
        if (!isRecord(item) || typeof item.id !== "string" || typeof item.label !== "string") {
          return [];
        }
        return [
          {
            id: item.id,
            label: item.label,
            passed: item.passed === true,
            detail: typeof item.detail === "string" ? item.detail : ""
          }
        ];
      }) : [],
      failureSummary: typeof gates.failureSummary === "string" ? gates.failureSummary : void 0
    } : null,
    notes: [
      "Regression status and deltas come from Core compare_baselines / CLI diff JSON.",
      "GUI does not redefine what counts as a regression."
    ]
  };
}
function normalizeSnapshot(value) {
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
    files: numberOr(value.files, 0)
  };
}
function normalizeRegressionStatus(value) {
  if (typeof value !== "string") {
    return null;
  }
  if (value === "healthy" || value === "improved" || value === "regressed" || value === "mixed" || value === "inconclusive") {
    return value;
  }
  return null;
}
function normalizeSizeDelta(value) {
  if (!isRecord(value)) {
    return { baseline: 0, current: 0, changeBytes: 0, changePercent: null };
  }
  return {
    baseline: numberOr(value.baseline, 0),
    current: numberOr(value.current, 0),
    changeBytes: numberOr(value.changeBytes, 0),
    changePercent: typeof value.changePercent === "number" ? value.changePercent : null
  };
}
function normalizeCountDelta(value) {
  if (!isRecord(value)) {
    return { baseline: 0, current: 0, change: 0, changePercent: null };
  }
  return {
    baseline: numberOr(value.baseline, 0),
    current: numberOr(value.current, 0),
    change: numberOr(value.change, 0),
    changePercent: typeof value.changePercent === "number" ? value.changePercent : null
  };
}
function normalizeDimensionDelta(value) {
  if (!isRecord(value) || typeof value.id !== "string") {
    return null;
  }
  return {
    id: value.id,
    baseline: typeof value.baseline === "number" ? value.baseline : null,
    current: typeof value.current === "number" ? value.current : null,
    change: typeof value.change === "number" ? value.change : null,
    evaluatedBaseline: value.evaluatedBaseline === true,
    evaluatedCurrent: value.evaluatedCurrent === true
  };
}
function normalizeDiagnosticDiffList(value) {
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
        filePath: typeof item.filePath === "string" ? item.filePath : void 0,
        selector: typeof item.selector === "string" ? item.selector : void 0,
        message: typeof item.message === "string" ? item.message : ""
      }
    ];
  });
}
function normalizeFileDiffList(value) {
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
        baselineSizeBytes: typeof item.baselineSizeBytes === "number" || item.baselineSizeBytes === null ? item.baselineSizeBytes : void 0,
        currentSizeBytes: typeof item.currentSizeBytes === "number" || item.currentSizeBytes === null ? item.currentSizeBytes : void 0,
        sizeChangePercent: typeof item.sizeChangePercent === "number" || item.sizeChangePercent === null ? item.sizeChangePercent : void 0,
        contentChanged: item.contentChanged === true,
        qualityRegressed: item.qualityRegressed === true
      }
    ];
  });
}
function explorerFilesFromRegression(regression) {
  if (!regression.files) {
    return [];
  }
  const paths = /* @__PURE__ */ new Map();
  const push = (entry) => {
    paths.set(entry.path, {
      path: entry.path,
      sizeBytes: entry.currentSizeBytes ?? entry.baselineSizeBytes ?? 0,
      ok: true,
      issueCount: entry.qualityRegressed ? 1 : 0
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
  return Array.from(paths.values()).sort(
    (left, right) => left.path.localeCompare(right.path)
  );
}
function buildOptimization(value, command) {
  const fileEntries = Array.isArray(value.files) ? value.files : [];
  const files = [];
  const decisions = [];
  let inputBytes = 0;
  let outputBytes = 0;
  let bytesEliminated = 0;
  let emittedBytesTotal = 0;
  let redistributedBytes = 0;
  let rulesRemovedEstimate = 0;
  let selectorsRemoved = 0;
  let chunksCreated = 0;
  const eliminationPercents = [];
  let operations = {
    minified: false,
    pageCoverageSplit: false,
    sizeBudgetSplit: false,
    variablesIsolated: false,
    deadCodeEliminated: false
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
        isRecord(report.output) ? report.output.bytes : void 0,
        fileInputBytes
      )
    );
    const fileEliminated = numberOr(impact.bytesEliminated, 0);
    const fileRedistributed = numberOr(impact.redistributedBytes, 0);
    const filePercent = typeof impact.eliminationPercent === "number" ? impact.eliminationPercent : null;
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
      pageCoverageSplit: operations.pageCoverageSplit || ops.pageCoverageSplit === true,
      sizeBudgetSplit: operations.sizeBudgetSplit || ops.sizeBudgetSplit === true,
      variablesIsolated: operations.variablesIsolated || ops.variablesIsolated === true,
      deadCodeEliminated: operations.deadCodeEliminated || ops.deadCodeEliminated === true
    };
    const chunks = Array.isArray(report.chunks) ? report.chunks.flatMap((chunk) => {
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
          page: typeof chunk.page === "string" ? chunk.page : null
        }
      ];
    }) : [];
    files.push({
      path,
      inputBytes: fileInputBytes,
      outputBytes: fileEmitted,
      bytesEliminated: fileEliminated,
      eliminationPercent: filePercent,
      emittedBytesTotal: fileEmitted,
      redistributedBytes: fileRedistributed,
      chunks
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
  const avgPercent = eliminationPercents.length > 0 ? eliminationPercents.reduce((sum, value2) => sum + value2, 0) / eliminationPercents.length : null;
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
      fileCount: files.length
    },
    operations,
    files,
    decisions,
    warnings: topWarnings,
    notes: [
      "bytesEliminated comes from Core impact metadata and may include redistribution across chunks \u2014 it is not always equal to inputBytes \u2212 emittedBytesTotal.",
      "eliminationPercent is reported by Core per file; multi-file views show the average of provided percents."
    ]
  };
}
function normalizeDecision(value, fallbackPath) {
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
    confidence: typeof value.confidence === "string" ? value.confidence : "unknown",
    changed: value.changed === true,
    filePath: typeof source.file === "string" ? source.file : fallbackPath || void 0,
    selector: typeof source.selector === "string" ? source.selector : void 0,
    bytesBefore: typeof impact.bytesBefore === "number" || impact.bytesBefore === null ? impact.bytesBefore : void 0,
    bytesAfter: typeof impact.bytesAfter === "number" || impact.bytesAfter === null ? impact.bytesAfter : void 0
  };
}
function buildCssAnalysisFromCheckFiles(files, diagnostics) {
  const insights = files.map(
    (file, index) => normalizeFileInsight(file, index)
  );
  const hasStats = insights.some(
    (file) => typeof file.selectorCount === "number"
  );
  if (!hasStats) {
    return null;
  }
  const selectors = [];
  const kindCounts = /* @__PURE__ */ new Map();
  const specificityCounts = /* @__PURE__ */ new Map();
  files.forEach((file, fileIndex) => {
    if (!isRecord(file) || !isRecord(file.result)) {
      return;
    }
    const filePath = typeof file.path === "string" ? file.path : `unknown-${fileIndex}`;
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
      const specificity = isRecord(selector.specificity) ? selector.specificity : {};
      const ids = numberOr(specificity.ids, 0);
      const classes = numberOr(specificity.classes, 0);
      const types = numberOr(specificity.types, 0);
      const bucket = specificityBucketLabel(ids, classes, types);
      specificityCounts.set(bucket, (specificityCounts.get(bucket) ?? 0) + 1);
      const rule = typeof selector.ruleIndex === "number" ? rules[selector.ruleIndex] : void 0;
      const location = isRecord(rule) && isRecord(rule.location) ? rule.location : void 0;
      selectors.push({
        id: `${filePath}:${selectorIndex}:${selector.raw}`,
        filePath,
        raw: selector.raw,
        kinds,
        specificityIds: ids,
        specificityClasses: classes,
        specificityTypes: types,
        nestingDepth: numberOr(selector.nestingDepth, 0),
        line: typeof location?.line === "number" ? location.line : void 0,
        column: typeof location?.column === "number" ? location.column : void 0
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
        0
      ),
      declarations: insights.reduce(
        (sum, file) => sum + (file.declarationCount ?? 0),
        0
      ),
      importantDeclarations: insights.reduce(
        (sum, file) => sum + (file.importantDeclarationCount ?? 0),
        0
      ),
      uniqueClasses: insights.reduce(
        (sum, file) => sum + (file.uniqueClassCount ?? 0),
        0
      ),
      uniqueIds: insights.reduce(
        (sum, file) => sum + (file.uniqueIdCount ?? 0),
        0
      ),
      uniqueTags: insights.reduce(
        (sum, file) => sum + (file.uniqueTagCount ?? 0),
        0
      ),
      maxNestingDepth: insights.reduce(
        (max, file) => Math.max(max, file.maxNestingDepth ?? 0),
        0
      ),
      warningCount: insights.reduce(
        (sum, file) => sum + (file.warningCount ?? 0),
        0
      )
    },
    files: insights,
    selectors,
    kindDistribution: mapToBuckets(kindCounts),
    specificityBuckets: mapToBuckets(specificityCounts),
    deadCssCandidates,
    usage: null,
    atRules: null,
    notes: [
      "Selector kinds and specificity come from Core analyzeCss output.",
      "At-rule inventories are not exported by analyzeCss yet.",
      "Page usage / coverage requires optimize/split with pageUsage \u2014 marked missing here.",
      "Dead CSS entries are candidates from diagnostics (empty-rule / health dead_*), not confirmed unused-via-usage."
    ]
  };
}
function diagnosticsToDeadCandidates(diagnostics) {
  return diagnostics.filter((item) => {
    const code = item.code.toLowerCase();
    return code === "empty-rule" || code.startsWith("dead.") || item.category === "dead_code";
  }).map((item) => ({
    id: item.id,
    status: "candidate",
    code: item.code,
    message: item.message,
    filePath: item.filePath,
    selector: item.selector,
    line: item.line,
    column: item.column,
    remediation: item.remediation
  }));
}
function specificityBucketLabel(ids, classes, types) {
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
function mapToBuckets(map) {
  return Array.from(map.entries()).map(([key, count]) => ({ key, count })).sort(
    (left, right) => right.count - left.count || left.key.localeCompare(right.key)
  );
}
function assertCompatibleSchema(schemaVersion) {
  if (schemaVersion === void 0 || schemaVersion === null) {
    return;
  }
  if (typeof schemaVersion !== "number" || schemaVersion !== 1) {
    throw new IncompatibleSchemaError(
      `Unsupported source schemaVersion: ${String(schemaVersion)}`
    );
  }
}
var IncompatibleSchemaError = class extends Error {
  code = "incompatible_schema";
};
function normalizeHealth(value) {
  if (!isRecord(value)) {
    return null;
  }
  if (typeof value.overall !== "number" || typeof value.grade !== "string") {
    throw new Error("Invalid health report: missing overall/grade");
  }
  const summary = isRecord(value.summary) ? value.summary : {};
  const dimensions = Array.isArray(value.dimensions) ? value.dimensions.map(normalizeDimension).filter(Boolean) : [];
  return {
    overall: value.overall,
    grade: value.grade,
    status: typeof value.status === "string" ? value.status : "unknown",
    schemaVersion: typeof value.schemaVersion === "number" ? value.schemaVersion : 1,
    dimensions,
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
      analysisMs: numberOr(summary.analysisMs, 0)
    }
  };
}
function normalizeDimension(value) {
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
    note: typeof value.note === "string" ? value.note : void 0
  };
}
function normalizeHealthDiagnostics(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item, index) => {
    if (!isRecord(item) || typeof item.message !== "string") {
      return [];
    }
    const location = isRecord(item.location) ? item.location : void 0;
    return [
      {
        id: `health:${typeof item.code === "string" ? item.code : "unknown"}:${index}`,
        severity: normalizeSeverity(item.severity),
        code: typeof item.code === "string" ? item.code : "unknown",
        message: item.message,
        category: typeof item.category === "string" ? item.category : void 0,
        filePath: typeof item.filePath === "string" ? item.filePath : void 0,
        line: typeof location?.line === "number" ? location.line : void 0,
        column: typeof location?.column === "number" ? location.column : void 0,
        selector: typeof item.selector === "string" ? item.selector : void 0,
        remediation: typeof item.remediation === "string" ? item.remediation : void 0,
        source: "health"
      }
    ];
  });
}
function flattenCheckIssues(files) {
  const diagnostics = [];
  files.forEach((file, fileIndex) => {
    if (!isRecord(file) || !Array.isArray(file.issues)) {
      return;
    }
    const filePath = typeof file.path === "string" ? file.path : void 0;
    file.issues.forEach((issue, issueIndex) => {
      if (!isRecord(issue) || typeof issue.message !== "string") {
        return;
      }
      const location = isRecord(issue.location) ? issue.location : void 0;
      const kind = typeof issue.kind === "string" ? issue.kind : "issue";
      diagnostics.push({
        id: `check:${fileIndex}:${issueIndex}:${kind}`,
        severity: normalizeSeverity(issue.severity),
        code: kind,
        message: issue.message,
        category: "check",
        filePath,
        line: typeof location?.line === "number" ? location.line : void 0,
        column: typeof location?.column === "number" ? location.column : void 0,
        selector: typeof issue.selector === "string" ? issue.selector : void 0,
        source: "check"
      });
    });
  });
  return diagnostics;
}
function normalizeFileInsight(value, index) {
  if (!isRecord(value)) {
    return {
      path: `unknown-${index}`,
      sizeBytes: 0,
      ok: false,
      issueCount: 0,
      error: "Invalid file entry"
    };
  }
  const result = isRecord(value.result) ? value.result : void 0;
  const stats = result && isRecord(result.stats) ? result.stats : void 0;
  return {
    path: typeof value.path === "string" ? value.path : `unknown-${index}`,
    absolutePath: typeof value.absolutePath === "string" ? value.absolutePath : void 0,
    sizeBytes: numberOr(value.sizeBytes, 0),
    ok: value.ok === true,
    issueCount: Array.isArray(value.issues) ? value.issues.length : 0,
    error: typeof value.error === "string" ? value.error : void 0,
    selectorCount: typeof stats?.selectorCount === "number" ? stats.selectorCount : void 0,
    ruleCount: typeof stats?.ruleCount === "number" ? stats.ruleCount : void 0,
    declarationCount: typeof stats?.declarationCount === "number" ? stats.declarationCount : void 0,
    importantDeclarationCount: typeof stats?.importantDeclarationCount === "number" ? stats.importantDeclarationCount : void 0,
    uniqueClassCount: typeof stats?.uniqueClassCount === "number" ? stats.uniqueClassCount : void 0,
    uniqueIdCount: typeof stats?.uniqueIdCount === "number" ? stats.uniqueIdCount : void 0,
    uniqueTagCount: typeof stats?.uniqueTagCount === "number" ? stats.uniqueTagCount : void 0,
    maxNestingDepth: typeof stats?.maxNestingDepth === "number" ? stats.maxNestingDepth : void 0,
    warningCount: typeof stats?.warningCount === "number" ? stats.warningCount : void 0
  };
}
function normalizeCheckSummary(value, files) {
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
      analysisMs: typeof value.analysisMs === "number" ? value.analysisMs : void 0,
      totalMs: typeof value.totalMs === "number" ? value.totalMs : void 0
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
      0
    )
  };
}
function normalizeSeverity(value) {
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
  if (normalized === "info" || normalized === "suggestion" || normalized === "hint") {
    return "info";
  }
  return "unknown";
}
function countDiagnostics(diagnostics) {
  const counts = {
    error: 0,
    warning: 0,
    info: 0,
    unknown: 0,
    total: diagnostics.length
  };
  for (const diagnostic of diagnostics) {
    counts[diagnostic.severity] += 1;
  }
  return counts;
}
function asStringArray(value) {
  if (!Array.isArray(value)) {
    return void 0;
  }
  return value.filter((item) => typeof item === "string");
}
function asNullableNumber(value) {
  if (value === void 0) {
    return void 0;
  }
  if (value === null) {
    return null;
  }
  return typeof value === "number" ? value : void 0;
}
function numberOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// server/report/generate-check.ts
var require2 = createRequire(import.meta.url);
var cachedBinding;
function loadBinding() {
  if (cachedBinding) {
    return cachedBinding;
  }
  try {
    cachedBinding = require2("@zealakit/css-doctor-binding");
    return cachedBinding;
  } catch (error) {
    throw new Error(
      "Unable to load @zealakit/css-doctor-binding. Build it with `pnpm --filter @zealakit/css-doctor-binding build`.\n" + (error instanceof Error ? error.message : String(error))
    );
  }
}
async function generateCheckReport(options) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const patterns = options.patterns.map((pattern) => pattern.trim()).filter(Boolean);
  const threshold = options.threshold ?? null;
  if (patterns.length === 0) {
    return {
      ok: false,
      code: "validation_error",
      message: 'Provide at least one CSS glob/pattern (example: "src/**/*.css").'
    };
  }
  try {
    const cwdStat = await stat(cwd);
    if (!cwdStat.isDirectory()) {
      return {
        ok: false,
        code: "validation_error",
        message: `Working directory is not a directory: ${cwd}`
      };
    }
  } catch {
    return {
      ok: false,
      code: "not_found",
      message: `Working directory does not exist: ${cwd}`
    };
  }
  const startedAt = performance.now();
  let files;
  try {
    files = await resolveCssFiles(patterns, cwd);
  } catch (error) {
    return {
      ok: false,
      code: "analysis_failure",
      message: error instanceof Error ? error.message : String(error)
    };
  }
  if (files.length === 0) {
    return {
      ok: false,
      code: "not_found",
      message: `No CSS files matched: ${patterns.join(", ")}`
    };
  }
  try {
    const binding = loadBinding();
    const fileResults = [];
    const healthFiles = [];
    for (const absolutePath of files) {
      const displayPath = toDisplayPath(absolutePath, cwd);
      const readStarted = performance.now();
      let content;
      let sizeBytes = 0;
      try {
        const [text, fileStat] = await Promise.all([
          readFile(absolutePath, "utf8"),
          stat(absolutePath)
        ]);
        content = text;
        sizeBytes = fileStat.size;
      } catch (error) {
        fileResults.push({
          path: displayPath,
          absolutePath,
          sizeBytes: 0,
          ok: false,
          totalMs: roundMs(performance.now() - readStarted),
          readMs: roundMs(performance.now() - readStarted),
          analysisMs: 0,
          issues: [],
          error: error instanceof Error ? error.message : String(error)
        });
        continue;
      }
      const readMs = roundMs(performance.now() - readStarted);
      const analysisStarted = performance.now();
      try {
        const result = binding.analyzeCss(content);
        const analysisMs = roundMs(performance.now() - analysisStarted);
        const issues2 = collectCheckIssues(result, threshold);
        fileResults.push({
          path: displayPath,
          absolutePath,
          sizeBytes,
          ok: true,
          totalMs: roundMs(readMs + analysisMs),
          readMs,
          analysisMs,
          issues: issues2,
          result
        });
        healthFiles.push({
          cssContent: content,
          filePath: displayPath,
          sizeBytes
        });
      } catch (error) {
        fileResults.push({
          path: displayPath,
          absolutePath,
          sizeBytes,
          ok: false,
          totalMs: roundMs(performance.now() - readStarted),
          readMs,
          analysisMs: roundMs(performance.now() - analysisStarted),
          issues: [],
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    const health = healthFiles.length > 0 ? binding.evaluateCssHealthBatch({
      files: healthFiles,
      thresholds: threshold === null ? void 0 : { manySelectors: threshold }
    }) : null;
    const analyzed = fileResults.filter((file) => file.ok).length;
    const failed = fileResults.length - analyzed;
    const issues = fileResults.flatMap((file) => file.issues);
    const warnings = issues.filter((issue) => issue.kind === "syntax").length;
    const checkReport = {
      schemaVersion: 1,
      command: "check",
      version: "1.1.1",
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      cwd,
      patterns,
      threshold,
      failUnder: null,
      success: failed === 0,
      errors: [],
      files: fileResults,
      summary: {
        files: fileResults.length,
        analyzed,
        failed,
        filesWithIssues: fileResults.filter((file) => file.issues.length > 0).length,
        totalSizeBytes: fileResults.reduce(
          (total, file) => total + file.sizeBytes,
          0
        ),
        rules: fileResults.reduce(
          (total, file) => total + (file.result?.stats.ruleCount ?? 0),
          0
        ),
        selectors: fileResults.reduce(
          (total, file) => total + (file.result?.stats.selectorCount ?? 0),
          0
        ),
        declarations: fileResults.reduce(
          (total, file) => total + (file.result?.stats.declarationCount ?? 0) + (file.result?.stats.importantDeclarationCount ?? 0),
          0
        ),
        warnings,
        hints: issues.length - warnings,
        issues: issues.length,
        analysisMs: roundMs(
          fileResults.reduce((total, file) => total + file.analysisMs, 0)
        ),
        totalMs: roundMs(performance.now() - startedAt)
      },
      health
    };
    const report = normalizeCheckReport(checkReport, {
      source: {
        kind: "generated-check",
        command: "check",
        toolVersion: checkReport.version
      }
    });
    return { ok: true, report };
  } catch (error) {
    return {
      ok: false,
      code: "analysis_failure",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
async function resolveCssFiles(patterns, cwd) {
  const matches = await fg(patterns, {
    cwd,
    absolute: true,
    onlyFiles: true,
    unique: true,
    caseSensitiveMatch: false,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.next/**"]
  });
  return matches.filter((file) => file.toLowerCase().endsWith(".css")).sort((left, right) => left.localeCompare(right));
}
function toDisplayPath(absolutePath, cwd) {
  const relativePath = relative(cwd, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return absolutePath.split(sep).join("/");
  }
  return relativePath.split(sep).join("/");
}
function collectCheckIssues(result, threshold) {
  const issues = [];
  for (const warning of result.warnings) {
    issues.push({
      kind: "syntax",
      severity: "warning",
      message: warning.message,
      ...warning.location ? { location: warning.location } : {}
    });
  }
  const parentRuleIndices = new Set(
    result.rules.map((rule) => rule.parentRuleIndex).filter((index) => index !== void 0)
  );
  for (const rule of result.rules) {
    const hasNoDeclarations = rule.declarationCount === 0 && rule.importantDeclarationCount === 0;
    const hasNoNestedRules = !parentRuleIndices.has(rule.index);
    if (!(hasNoDeclarations && hasNoNestedRules)) {
      continue;
    }
    const selectorText = rule.selectorIndices.map((index) => result.selectors[index]?.raw).filter((value) => value !== void 0).join(", ");
    issues.push({
      kind: "empty-rule",
      severity: "warning",
      message: selectorText.length > 0 ? `Rule "${selectorText}" has no declarations and no nested rules (dead code candidate).` : "Rule has no declarations and no nested rules (dead code candidate).",
      location: rule.location,
      ...selectorText.length > 0 ? { selector: selectorText } : {}
    });
  }
  const seenSelectors = /* @__PURE__ */ new Map();
  for (const selector of result.selectors) {
    const first = seenSelectors.get(selector.raw);
    if (!first) {
      seenSelectors.set(selector.raw, selector);
      continue;
    }
    const firstRule = result.rules[first.ruleIndex];
    const currentRule = result.rules[selector.ruleIndex];
    issues.push({
      kind: "duplicate-selector",
      severity: "warning",
      message: `Selector "${selector.raw}" is defined in multiple rules` + (firstRule ? ` (first at line ${firstRule.location.line})` : "") + "; verify whether this is intentional.",
      ...currentRule ? { location: currentRule.location } : {},
      selector: selector.raw
    });
  }
  if (threshold !== null && result.selectors.length > threshold) {
    issues.push({
      kind: "threshold",
      severity: "warning",
      message: `Selector threshold exceeded: ${result.selectors.length} selectors found (threshold: ${threshold}).`
    });
  }
  return issues;
}
function roundMs(value) {
  return Math.round(value * 1e3) / 1e3;
}

// server/report/load-file.ts
import { access, readFile as readFile2 } from "fs/promises";
import { constants } from "fs";
import { isAbsolute as isAbsolute2, resolve as resolve2 } from "path";

// shared/parse-report-json.ts
function parseReportJson(parsed, options = {}) {
  const command = detectSourceCommand(parsed);
  if (!command) {
    return {
      ok: false,
      code: "unsupported_format",
      message: "Unsupported report JSON. Expected css-doctor check/health/optimize/split/diff --json output."
    };
  }
  try {
    const kind = command === "check" ? "check-json" : command === "health" ? "health-json" : command === "split" ? "split-json" : command === "diff" ? "diff-json" : "optimize-json";
    const report = normalizeUnknownReport(parsed, {
      source: {
        kind,
        command,
        path: options.path ?? options.label
      }
    });
    return { ok: true, report };
  } catch (error) {
    if (error instanceof IncompatibleSchemaError) {
      return {
        ok: false,
        code: "incompatible_schema",
        message: error.message
      };
    }
    return {
      ok: false,
      code: "validation_error",
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
function parseReportJsonText(text, options = {}) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      message: "Report content is not valid JSON."
    };
  }
  return parseReportJson(parsed, options);
}

// server/report/load-file.ts
async function loadReportFromFile(options) {
  const cwd = options.cwd ?? process.cwd();
  const rawPath = options.path.trim();
  if (!rawPath) {
    return {
      ok: false,
      code: "validation_error",
      message: "Report path is required."
    };
  }
  const absolutePath = isAbsolute2(rawPath) ? resolve2(rawPath) : resolve2(cwd, rawPath);
  if (!absolutePath.toLowerCase().endsWith(".json")) {
    return {
      ok: false,
      code: "unsupported_format",
      message: "Only .json report files are supported."
    };
  }
  try {
    await access(absolutePath, constants.R_OK);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      return {
        ok: false,
        code: "not_found",
        message: `Report file not found: ${absolutePath}`
      };
    }
    if (code === "EACCES") {
      return {
        ok: false,
        code: "permission_denied",
        message: `Permission denied reading: ${absolutePath}`
      };
    }
    return {
      ok: false,
      code: "read_failure",
      message: `Unable to access report file: ${absolutePath}`
    };
  }
  let text;
  try {
    text = await readFile2(absolutePath, "utf8");
  } catch {
    return {
      ok: false,
      code: "read_failure",
      message: `Failed to read report file: ${absolutePath}`
    };
  }
  return parseReportJsonText(text, { path: absolutePath });
}

// server/report/session.ts
var session = {
  report: null,
  source: null
};
function getCurrentReport() {
  return session.report;
}
function getReportSessionSource() {
  return session.source;
}
function setCurrentReport(report, source) {
  if (report === null) {
    session = { report: null, source: null };
    return;
  }
  session = {
    report,
    source: source === void 0 ? session.source : source === null ? null : source
  };
}
function clearReportSession() {
  session = { report: null, source: null };
}

// server/services/http-json.ts
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}
async function readJsonBody(req, limitBytes = 64e3) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > limitBytes) {
      throw new PayloadTooLargeError();
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new InvalidJsonBodyError();
  }
}
var PayloadTooLargeError = class extends Error {
  code = "payload_too_large";
};
var InvalidJsonBodyError = class extends Error {
  code = "invalid_json_body";
};

// server/routes/report.ts
function handleGetReport(_req, res) {
  const report = getCurrentReport();
  if (!report) {
    sendJson(res, 404, {
      ok: false,
      code: "no_report",
      message: "No report loaded. Load a JSON report or run a check analysis."
    });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    report,
    source: getReportSessionSource()
  });
}
async function handleLoadReport(req, res) {
  try {
    const body = await readJsonBody(req);
    const path = body && typeof body === "object" && "path" in body ? String(body.path ?? "") : "";
    const cwd = body && typeof body === "object" && "cwd" in body ? body.cwd : void 0;
    const result = await loadReportFromFile({
      path,
      cwd: typeof cwd === "string" ? cwd : void 0
    });
    respondLoadResult(res, result, (report) => ({
      kind: "file",
      path: report.source.path,
      label: report.source.path ? basename(report.source.path) : path.trim() || "report.json",
      reloadable: true
    }));
  } catch (error) {
    respondBodyError(res, error);
  }
}
async function handleUploadReport(req, res) {
  try {
    const body = await readJsonBody(req, 8 * 1024 * 1024);
    const record = body && typeof body === "object" ? body : {};
    const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : "uploaded-report.json";
    if (!("report" in record)) {
      sendJson(res, 400, {
        ok: false,
        code: "validation_error",
        message: 'Upload body must include a "report" JSON document.'
      });
      return;
    }
    const result = parseReportJson(record.report, {
      path: label,
      label
    });
    respondLoadResult(res, result, () => ({
      kind: "upload",
      label,
      reloadable: false
    }));
  } catch (error) {
    respondBodyError(res, error);
  }
}
async function handleGenerateReport(req, res) {
  try {
    const body = await readJsonBody(req);
    const record = body && typeof body === "object" ? body : {};
    const patterns = Array.isArray(record.patterns) ? record.patterns.filter(
      (item) => typeof item === "string"
    ) : typeof record.pattern === "string" ? [record.pattern] : [];
    const cwd = typeof record.cwd === "string" ? record.cwd : void 0;
    const threshold = typeof record.threshold === "number" ? record.threshold : void 0;
    const result = await generateCheckReport({ patterns, cwd, threshold });
    respondLoadResult(res, result, () => ({
      kind: "generate",
      label: patterns.join(", ") || "generated-check",
      path: cwd,
      reloadable: false
    }));
  } catch (error) {
    respondBodyError(res, error);
  }
}
async function handleReloadReport(_req, res) {
  const source = getReportSessionSource();
  if (!source) {
    sendJson(res, 404, {
      ok: false,
      code: "no_report",
      message: "No report source to reload."
    });
    return;
  }
  if (!source.reloadable || source.kind !== "file" || !source.path) {
    sendJson(res, 400, {
      ok: false,
      code: "validation_error",
      message: "Current report cannot be reloaded from disk. Re-upload or load a file path instead. Reload does not re-run CSS analysis."
    });
    return;
  }
  const result = await loadReportFromFile({ path: source.path });
  respondLoadResult(res, result, () => ({
    ...source,
    reloadable: true
  }));
}
function handleClearReport(_req, res) {
  clearReportSession();
  sendJson(res, 200, { ok: true });
}
function respondLoadResult(res, result, sourceFor) {
  if (!result.ok) {
    guiLog("warn", "report load failed", {
      code: result.code,
      message: result.message
    });
    sendJson(res, statusForCode(result.code), {
      ok: false,
      code: result.code,
      message: result.message
    });
    return;
  }
  const source = sourceFor(result.report);
  setCurrentReport(result.report, source);
  guiLog("info", "report loaded", {
    command: result.report.source.command,
    label: source.label,
    path: source.path ? redactPath(source.path) : void 0
  });
  sendJson(res, 200, { ok: true, report: result.report, source });
}
function respondBodyError(res, error) {
  if (error instanceof PayloadTooLargeError) {
    sendJson(res, 413, {
      ok: false,
      code: "payload_too_large",
      message: "Request body is too large."
    });
    return;
  }
  if (error instanceof InvalidJsonBodyError) {
    sendJson(res, 400, {
      ok: false,
      code: "invalid_json",
      message: "Request body must be valid JSON."
    });
    return;
  }
  sendJson(res, 500, {
    ok: false,
    code: "read_failure",
    message: error instanceof Error ? error.message : String(error)
  });
}
function statusForCode(code) {
  switch (code) {
    case "not_found":
    case "no_report":
      return 404;
    case "permission_denied":
      return 403;
    case "invalid_json":
    case "unsupported_format":
    case "incompatible_schema":
    case "validation_error":
      return 400;
    case "analysis_failure":
    case "read_failure":
      return 500;
    default:
      return 400;
  }
}

// server/routes/runtime.ts
function handleRuntimeInfo(_req, res) {
  const source = getReportSessionSource();
  const body = {
    ok: true,
    runtime: "web",
    capabilities: {
      loadReport: true,
      uploadReport: true,
      reloadReport: source?.reloadable === true,
      generateCheck: true,
      selectProject: false,
      openExternal: false,
      settings: true,
      recentReports: true,
      desktopSidecar: true
    },
    phase: 6,
    hasReport: getCurrentReport() !== null,
    source,
    note: "Phase 6: release readiness \u2014 Web production + optional Tauri Node sidecar."
  };
  const payload = JSON.stringify(body);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

// server/services/static-files.ts
import { createReadStream, existsSync as existsSync3, statSync } from "fs";
import { extname, join as join3, normalize, resolve as resolve3, sep as sep2 } from "path";
var CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8"
};
function resolveSafePath(rootDir, requestPath) {
  const decoded = decodeURIComponent(requestPath.split("?")[0] ?? "/");
  const relative2 = decoded.replace(/^\/+/, "");
  const candidate = normalize(join3(rootDir, relative2));
  const root = resolve3(rootDir);
  if (candidate !== root && !candidate.startsWith(root + sep2)) {
    return null;
  }
  return candidate;
}
function sendStaticFile(res, absolutePath) {
  if (!existsSync3(absolutePath)) {
    return false;
  }
  const stats = statSync(absolutePath);
  if (!stats.isFile()) {
    return false;
  }
  const type = CONTENT_TYPES[extname(absolutePath).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "content-length": stats.size,
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff"
  });
  createReadStream(absolutePath).pipe(res);
  return true;
}
function sendSpaFallback(res, staticDir) {
  return sendStaticFile(res, join3(staticDir, "index.html"));
}

// server/create-server.ts
function createGuiHttpServer(options = {}) {
  const staticDir = options.staticDir;
  const apiOnly = options.apiOnly === true;
  return createHttpServer((req, res) => {
    void handleRequest(req, res, { staticDir, apiOnly });
  });
}
async function handleRequest(req, res, options) {
  try {
    applySecurityHeaders(res);
    if (rejectNonLoopback(req, res)) {
      guiLog("warn", "rejected non-loopback host", {
        host: req.headers.host ?? ""
      });
      return;
    }
    if (rejectDisallowedMutation(req, res)) {
      guiLog("warn", "rejected disallowed mutation", {
        method: req.method ?? "",
        path: rawPathname(req.url)
      });
      return;
    }
    const method = req.method ?? "GET";
    const pathname = rawPathname(req.url);
    if (method === "GET" && pathname === "/api/health") {
      handleHealth(req, res);
      return;
    }
    if (method === "GET" && pathname === "/api/runtime") {
      handleRuntimeInfo(req, res);
      return;
    }
    if (method === "GET" && pathname === "/api/report") {
      handleGetReport(req, res);
      return;
    }
    if (method === "POST" && pathname === "/api/report/load") {
      await handleLoadReport(req, res);
      return;
    }
    if (method === "POST" && pathname === "/api/report/upload") {
      await handleUploadReport(req, res);
      return;
    }
    if (method === "POST" && pathname === "/api/report/generate") {
      await handleGenerateReport(req, res);
      return;
    }
    if (method === "POST" && pathname === "/api/report/reload") {
      await handleReloadReport(req, res);
      return;
    }
    if (method === "POST" && pathname === "/api/report/clear") {
      handleClearReport(req, res);
      return;
    }
    if (pathname.startsWith("/api/")) {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "Not found" }));
      return;
    }
    if (options.apiOnly || !options.staticDir) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      res.end("Method Not Allowed");
      return;
    }
    const safePath = resolveSafePath(options.staticDir, pathname);
    if (!safePath) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Bad request");
      return;
    }
    const filePath = pathname === "/" ? join4(options.staticDir, "index.html") : safePath;
    if (sendStaticFile(res, filePath)) {
      return;
    }
    const accept = req.headers.accept ?? "";
    const wantsHtml = accept.includes("text/html") || accept === "" || accept === "*/*";
    if (wantsHtml && !pathname.includes(".") && sendSpaFallback(res, options.staticDir)) {
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    guiLog("error", "request handler failure", { message });
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    }
    res.end(JSON.stringify({ ok: false, error: "Internal server error" }));
  }
}
function rawPathname(requestUrl) {
  const raw = requestUrl ?? "/";
  const pathOnly = raw.split("?")[0] ?? "/";
  return pathOnly.length > 0 ? pathOnly : "/";
}

// server/constants.ts
var DEFAULT_HOST = "127.0.0.1";
var PREFERRED_PORT = 4193;
var FALLBACK_PORT_MAX = 4293;

// server/listen.ts
async function listenGuiServer(server, options = {}) {
  const host = options.host ?? DEFAULT_HOST;
  const preferred = options.port ?? PREFERRED_PORT;
  const allowFallback = options.port === void 0 && options.strictPort !== true;
  validatePort(preferred);
  if (!allowFallback) {
    try {
      await bind(server, host, preferred);
      return toResult(server, host, preferred);
    } catch (error) {
      if (isAddressInUse(error)) {
        throw new Error(
          `Port ${preferred} on ${host} is already in use. ` + (options.strictPort ? "Strict port mode does not fall back." : "Choose another --port or omit --port to enable fallback.")
        );
      }
      throw error;
    }
  }
  for (let port = preferred; port <= FALLBACK_PORT_MAX; port += 1) {
    try {
      await bind(server, host, port);
      return toResult(server, host, port);
    } catch (error) {
      if (!isAddressInUse(error)) {
        throw error;
      }
    }
  }
  throw new Error(
    `Unable to bind ${host} in port range ${preferred}-${FALLBACK_PORT_MAX}`
  );
}
function validatePort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }
}
function bind(server, host, port) {
  return new Promise((resolve4, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve4();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}
function toResult(server, host, port) {
  return {
    host,
    port,
    url: `http://${host}:${port}/`,
    close: () => new Promise((resolve4, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve4();
        }
      });
    })
  };
}
function isAddressInUse(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EADDRINUSE";
}

// server/services/open-browser.ts
import { execFile } from "child_process";
import { promisify } from "util";
var execFileAsync = promisify(execFile);
async function openBrowser(url) {
  try {
    const platform2 = process.platform;
    if (platform2 === "darwin") {
      await execFileAsync("open", [url]);
    } else if (platform2 === "win32") {
      await execFileAsync("cmd", ["/c", "start", "", url], {
        windowsHide: true
      });
    } else {
      await execFileAsync("xdg-open", [url]);
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

// server/start.ts
var packageRoot2 = join5(dirname3(fileURLToPath3(import.meta.url)), "..");
async function startGuiServer(options = {}) {
  const apiOnly = options.apiOnly === true;
  const staticDir = options.staticDir ?? (apiOnly ? void 0 : resolveDefaultStaticDir());
  if (!apiOnly && (!staticDir || !existsSync4(join5(staticDir, "index.html")))) {
    throw new Error(
      "Frontend build not found. Run `pnpm --filter css-doctor-gui build` first, or start with apiOnly for Vite-proxied development."
    );
  }
  if (options.reportPath) {
    const loaded = await loadReportFromFile({ path: options.reportPath });
    if (!loaded.ok) {
      guiLog("error", "preload report failed", {
        path: redactPath(options.reportPath),
        message: loaded.message
      });
      throw new Error(`Failed to preload report: ${loaded.message}`);
    }
    setCurrentReport(loaded.report, {
      kind: "file",
      path: loaded.report.source.path,
      label: loaded.report.source.path ? basename2(loaded.report.source.path) : basename2(options.reportPath),
      reloadable: true
    });
    guiLog("info", "preloaded report", {
      path: redactPath(options.reportPath),
      command: loaded.report.source.command
    });
  }
  const server = createGuiHttpServer({
    staticDir,
    apiOnly
  });
  const listened = await listenGuiServer(server, options);
  guiLog("info", "server started", {
    url: listened.url,
    apiOnly: apiOnly ? "true" : "false"
  });
  if (options.printUrl !== false) {
    process.stdout.write(`css-doctor-gui listening on ${listened.url}
`);
  }
  if (options.open !== false && !apiOnly) {
    const opened = await openBrowser(listened.url);
    if (!opened.ok) {
      guiLog("warn", "browser open failed", { message: opened.error });
      process.stderr.write(
        `css-doctor-gui: could not open browser (${opened.error}). Open ${listened.url} manually.
`
      );
    }
  }
  const originalClose = listened.close;
  listened.close = async () => {
    guiLog("info", "server shutting down", { url: listened.url });
    await originalClose();
  };
  return listened;
}
function resolveDefaultStaticDir() {
  return join5(packageRoot2, "dist");
}

// server/cli.ts
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.desktop) {
    const result = await launchDesktopApp();
    if (!result.ok) {
      process.stderr.write(`css-doctor-gui --desktop: ${result.message}
`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `css-doctor-gui: launched desktop app (${result.path})
`
    );
    return;
  }
  const listened = await startGuiServer({
    port: args.port,
    host: args.host,
    open: args.open,
    strictPort: args.strictPort,
    reportPath: args.reportPath
  });
  const shutdown = async () => {
    try {
      await listened.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}
function parseArgs(argv) {
  const result = {
    open: true,
    strictPort: false,
    help: false,
    desktop: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--no-open") {
      result.open = false;
    } else if (arg === "--strict-port") {
      result.strictPort = true;
    } else if (arg === "--desktop") {
      result.desktop = true;
    } else if (arg === "--report" || arg === "-r") {
      const value = argv[index + 1];
      index += 1;
      if (!value) {
        throw new Error("Missing value for --report");
      }
      result.reportPath = value;
    } else if (arg === "--port" || arg === "-p") {
      const value = argv[index + 1];
      index += 1;
      result.port = Number(value);
      if (!Number.isInteger(result.port)) {
        throw new Error(`Invalid --port value: ${value}`);
      }
    } else if (arg === "--host") {
      const value = argv[index + 1];
      index += 1;
      result.host = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}
function printHelp() {
  process.stdout.write(`Usage: css-doctor-gui [options]

Options:
  -p, --port <number>   Listen port (default 4193 with fallback 4194-4293)
  --host <host>         Bind host (default 127.0.0.1)
  --strict-port         Fail if the preferred/custom port is busy
  --no-open             Do not open a browser
  -r, --report <path>   Preload a check/health/optimize/split/diff JSON report
  --desktop             Launch built Desktop app (no Web fallback)
  -h, --help            Show help
`);
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`css-doctor-gui: ${message}
`);
  process.exitCode = 1;
});
//# sourceMappingURL=cli.js.map