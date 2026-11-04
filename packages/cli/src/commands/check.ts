import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

import { InvalidArgumentError, type Command } from "commander";

import type {
  JsCssAnalysisResult,
  JsHealthReport,
  JsSelectorInfo,
} from "@zealakit/css-doctor-binding";

import packageJson from "../../package.json";
import { formatJsonReport } from "../formatters/json";
import { formatCompactHealthSummary } from "../formatters/health-terminal";
import { formatTerminalReport, terminalExitCode } from "../formatters/terminal";
import {
  describeError,
  isDirectory,
  readCssFile,
  resolveCssFiles,
  toDisplayPath,
} from "../utils/file";

type BindingModule = typeof import("@zealakit/css-doctor-binding");
type AnalyzeCssFn = (cssContent: string) => JsCssAnalysisResult;

const require = createRequire(import.meta.url);
let cachedBinding: BindingModule | undefined;

function loadBinding(): BindingModule {
  if (cachedBinding) {
    return cachedBinding;
  }

  try {
    cachedBinding = require("@zealakit/css-doctor-binding") as BindingModule;
    return cachedBinding;
  } catch (error) {
    throw new Error(
      "Unable to load @zealakit/css-doctor-binding. Build it first with " +
        "`pnpm --filter @zealakit/css-doctor-binding build`.\n" +
        describeError(error),
    );
  }
}

/** Category of a diagnostic reported by the `check` command. */
export type CheckIssueKind =
  | "syntax"
  | "empty-rule"
  | "duplicate-selector"
  | "threshold";

/** A single diagnostic for a CSS file. */
export type CheckIssue = {
  kind: CheckIssueKind;
  severity: "warning";
  message: string;
  location?: {
    line: number;
    column: number;
  };
  selector?: string;
};

/** Result of reading and analyzing one CSS file. */
export type FileCheckResult = {
  /** Path relative to the command working directory, using forward slashes. */
  path: string;
  /** Absolute path on disk. */
  absolutePath: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** Whether the file was read and analyzed successfully. */
  ok: boolean;
  /** Total time spent reading and analyzing the file. */
  totalMs: number;
  /** Time spent reading the file. */
  readMs: number;
  /** Time spent inside the native analyzer. */
  analysisMs: number;
  /** Syntax warnings and dead-code/threshold hints. */
  issues: CheckIssue[];
  /** Native analysis result, present when `ok` is `true`. */
  result?: JsCssAnalysisResult;
  /** Read or analysis error, present when `ok` is `false`. */
  error?: string;
};

/** Aggregated counters for a `check` run. */
export type CheckSummary = {
  files: number;
  analyzed: number;
  failed: number;
  filesWithIssues: number;
  totalSizeBytes: number;
  rules: number;
  selectors: number;
  declarations: number;
  warnings: number;
  hints: number;
  issues: number;
  analysisMs: number;
  totalMs: number;
};

/** Structured report emitted by `css-doctor check --json`. */
export type CheckReport = {
  schemaVersion: 1;
  command: "check";
  version: string;
  generatedAt: string;
  cwd: string;
  patterns: string[];
  threshold: number | null;
  failUnder: number | null;
  success: boolean;
  errors: string[];
  files: FileCheckResult[];
  summary: CheckSummary;
  /** Aggregated CSS Health Score for successfully read files. */
  health: JsHealthReport | null;
};

/** Options accepted by the programmatic `runCheck` API. */
export type CheckRunOptions = {
  /** Base directory for pattern resolution. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Warn when a file contains more selectors than this value. */
  threshold?: number;
  /** Fail when overall Health Score is below this floor (0-100). */
  failUnder?: number;
};

type CheckCliOptions = {
  json?: boolean;
  threshold?: number;
  failUnder?: number;
};

/** Registers `css-doctor check` on a Commander program. */
export function registerCheckCommand(program: Command): void {
  program
    .command("check")
    .description("Analyze CSS files and report diagnostics")
    .argument(
      "[patterns...]",
      "CSS files or glob patterns (quote globs to let css-doctor expand them)",
    )
    .option("-j, --json", "Output raw JSON for piping and CI/CD")
    .option(
      "--threshold <number>",
      "Warn when a file contains more than <number> selectors",
      parseThreshold,
    )
    .option(
      "--fail-under <number>",
      "Exit with code 1 when overall health score is below <number> (0-100)",
      parseScore,
    )
    .action(async (patterns: string[], options: CheckCliOptions) => {
      const report = await runCheck(patterns ?? [], {
        threshold: options.threshold,
        failUnder: options.failUnder,
      });

      if (options.json === true) {
        process.stdout.write(`${formatJsonReport(report)}\n`);
      } else {
        let output = formatTerminalReport(report);
        if (report.health) {
          output += `\n${formatCompactHealthSummary(report.health)}\n`;
        }
        process.stdout.write(`${output}\n`);
      }

      process.exitCode = terminalExitCode(report);
    });
}

function parseThreshold(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("threshold must be a non-negative integer");
  }

  return parsed;
}

function parseScore(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new InvalidArgumentError("must be an integer between 0 and 100");
  }

  return parsed;
}

/**
 * Runs the full check pipeline and returns a structured report.
 *
 * Per-file read/analysis errors are captured so one broken stylesheet cannot
 * abort the whole run. Setup errors (invalid threshold, no patterns, no matched
 * files, unloadable native binding) are collected in `report.errors`.
 */
export async function runCheck(
  patterns: string[],
  options: CheckRunOptions = {},
): Promise<CheckReport> {
  const startedAt = performance.now();
  const cwd = resolve(options.cwd ?? process.cwd());
  const threshold = options.threshold ?? null;
  const failUnder = options.failUnder ?? null;
  const errors: string[] = [];
  const results: FileCheckResult[] = [];

  let files: string[] = [];

  if (threshold !== null && (!Number.isInteger(threshold) || threshold < 0)) {
    errors.push("Threshold must be a non-negative integer.");
  }

  if (failUnder !== null && (failUnder < 0 || failUnder > 100)) {
    errors.push("--fail-under must be an integer between 0 and 100.");
  }

  if (patterns.length === 0) {
    errors.push(
      'No CSS files or glob patterns were provided. Example: css-doctor check "src/**/*.css"',
    );
  } else if (!(await isDirectory(cwd))) {
    errors.push(
      `Working directory does not exist or is not a directory: ${cwd}`,
    );
  } else {
    try {
      files = await resolveCssFiles(patterns, cwd);
      if (files.length === 0) {
        errors.push(`No CSS files matched: ${patterns.join(", ")}`);
      }
    } catch (error) {
      errors.push(`Failed to resolve CSS files: ${describeError(error)}`);
    }
  }

  let health: JsHealthReport | null = null;

  if (errors.length === 0) {
    try {
      const binding = loadBinding();
      const analyze = binding.analyzeCss;

      for (const file of files) {
        results.push(await checkFile(file, cwd, threshold, analyze));
      }

      const healthFiles = [];

      for (const file of files) {
        const read = await readCssFile(file);
        if (!read.ok) {
          continue;
        }

        healthFiles.push({
          cssContent: read.content,
          filePath: toDisplayPath(file, cwd),
          sizeBytes: read.sizeBytes,
        });
      }

      if (healthFiles.length > 0) {
        health = binding.evaluateCssHealthBatch({
          files: healthFiles,
          thresholds:
            threshold === null
              ? undefined
              : {
                  manySelectors: threshold,
                },
        });
      }
    } catch (error) {
      errors.push(describeError(error));
    }
  }

  const issues = results.flatMap((file) => file.issues);
  const warnings = issues.filter((issue) => issue.kind === "syntax").length;
  const analyzed = results.filter((file) => file.ok).length;
  const failed = results.length - analyzed;

  const summary: CheckSummary = {
    files: results.length,
    analyzed,
    failed,
    filesWithIssues: results.filter((file) => file.issues.length > 0).length,
    totalSizeBytes: results.reduce((total, file) => total + file.sizeBytes, 0),
    rules: sum(results, (file) => file.result?.stats.ruleCount ?? 0),
    selectors: sum(results, (file) => file.result?.stats.selectorCount ?? 0),
    declarations: sum(
      results,
      (file) =>
        (file.result?.stats.declarationCount ?? 0) +
        (file.result?.stats.importantDeclarationCount ?? 0),
    ),
    warnings,
    hints: issues.length - warnings,
    issues: issues.length,
    analysisMs: roundMs(
      results.reduce((total, file) => total + file.analysisMs, 0),
    ),
    totalMs: elapsedMs(startedAt),
  };

  const belowFloor =
    failUnder !== null && health !== null && health.overall < failUnder
      ? [
          `Overall health score ${health.overall} is below --fail-under ${failUnder}.`,
        ]
      : [];

  return {
    schemaVersion: 1,
    command: "check",
    version: packageJson.version,
    generatedAt: new Date().toISOString(),
    cwd,
    patterns,
    threshold,
    failUnder,
    success: errors.length === 0 && failed === 0 && belowFloor.length === 0,
    errors: [...errors, ...belowFloor],
    files: results,
    summary,
    health,
  };
}

async function checkFile(
  filePath: string,
  cwd: string,
  threshold: number | null,
  analyze: AnalyzeCssFn,
): Promise<FileCheckResult> {
  const path = toDisplayPath(filePath, cwd);
  const readStartedAt = performance.now();
  const read = await readCssFile(filePath);
  const readMs = elapsedMs(readStartedAt);

  if (!read.ok) {
    return {
      path,
      absolutePath: filePath,
      sizeBytes: 0,
      ok: false,
      totalMs: readMs,
      readMs,
      analysisMs: 0,
      issues: [],
      error: read.error,
    };
  }

  const analysisStartedAt = performance.now();

  try {
    const result = analyze(read.content);
    const analysisMs = elapsedMs(analysisStartedAt);

    return {
      path,
      absolutePath: filePath,
      sizeBytes: read.sizeBytes,
      ok: true,
      totalMs: roundMs(readMs + analysisMs),
      readMs,
      analysisMs,
      issues: collectIssues(result, threshold),
      result,
    };
  } catch (error) {
    const analysisMs = elapsedMs(analysisStartedAt);

    return {
      path,
      absolutePath: filePath,
      sizeBytes: read.sizeBytes,
      ok: false,
      totalMs: roundMs(readMs + analysisMs),
      readMs,
      analysisMs,
      issues: [],
      error: `Failed to analyze file: ${describeError(error)}`,
    };
  }
}

function collectIssues(
  result: JsCssAnalysisResult,
  threshold: number | null,
): CheckIssue[] {
  const issues: CheckIssue[] = [];

  for (const warning of result.warnings) {
    issues.push({
      kind: "syntax",
      severity: "warning",
      message: warning.message,
      ...(warning.location ? { location: warning.location } : {}),
    });
  }

  const parentRuleIndices = new Set(
    result.rules
      .map((rule) => rule.parentRuleIndex)
      .filter((index): index is number => index !== undefined),
  );

  for (const rule of result.rules) {
    const hasNoDeclarations =
      rule.declarationCount === 0 && rule.importantDeclarationCount === 0;
    const hasNoNestedRules = !parentRuleIndices.has(rule.index);

    if (hasNoDeclarations && hasNoNestedRules) {
      const selectorText = rule.selectorIndices
        .map((index) => result.selectors[index]?.raw)
        .filter((value): value is string => value !== undefined)
        .join(", ");

      issues.push({
        kind: "empty-rule",
        severity: "warning",
        message:
          selectorText.length > 0
            ? `Rule "${selectorText}" has no declarations and no nested rules (dead code candidate).`
            : "Rule has no declarations and no nested rules (dead code candidate).",
        location: rule.location,
        ...(selectorText.length > 0 ? { selector: selectorText } : {}),
      });
    }
  }

  const seenSelectors = new Map<string, JsSelectorInfo>();

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
      message:
        `Selector "${selector.raw}" is defined in multiple rules` +
        (firstRule ? ` (first at line ${firstRule.location.line})` : "") +
        "; verify whether this is intentional.",
      ...(currentRule ? { location: currentRule.location } : {}),
      selector: selector.raw,
    });
  }

  if (threshold !== null && result.selectors.length > threshold) {
    issues.push({
      kind: "threshold",
      severity: "warning",
      message:
        `Selector threshold exceeded: ${result.selectors.length} selectors found ` +
        `(threshold: ${threshold}).`,
    });
  }

  return issues.sort(compareIssues);
}

function compareIssues(left: CheckIssue, right: CheckIssue): number {
  const leftLine = left.location?.line ?? Number.MAX_SAFE_INTEGER;
  const rightLine = right.location?.line ?? Number.MAX_SAFE_INTEGER;
  const lineDifference = leftLine - rightLine;

  if (lineDifference !== 0) {
    return lineDifference;
  }

  const columnDifference =
    (left.location?.column ?? 0) - (right.location?.column ?? 0);

  if (columnDifference !== 0) {
    return columnDifference;
  }

  return left.kind.localeCompare(right.kind);
}

function sum(
  files: FileCheckResult[],
  select: (file: FileCheckResult) => number,
): number {
  return files.reduce((total, file) => total + select(file), 0);
}

function elapsedMs(startedAt: number): number {
  return roundMs(performance.now() - startedAt);
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}
