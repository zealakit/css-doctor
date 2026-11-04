import { resolve } from "node:path";

import { InvalidArgumentError, type Command } from "commander";

import { formatJsonReport } from "../formatters/json";
import { formatRegressionTerminalReport } from "../formatters/regression-terminal";
import type { RegressionReport } from "../types/regression";
import {
  createBaselineSnapshot,
  readBaselineFile,
  validateBaselineJson,
} from "../utils/baseline-io";
import { loadBinding } from "../utils/binding";
import {
  DEFAULT_BASELINE_PATH,
  loadProjectConfig,
  resolveBaselinePath,
  type CssDoctorConfig,
} from "../utils/config";
import { toDisplayPath } from "../utils/file";

export type DiffCliReport = {
  schemaVersion: 1;
  command: "diff";
  success: boolean;
  errors: string[];
  warnings: string[];
  baselinePath: string;
  regression: RegressionReport | null;
};

export type DiffRunOptions = {
  cwd?: string;
  baseline?: string;
  config?: string;
  patterns?: string[];
  threshold?: number;
  failOnRegression?: boolean;
  failOnNewErrors?: boolean;
  failOnNewDiagnostics?: boolean;
  maxSizeIncrease?: string | number;
  maxNewErrors?: number;
  maxNewWarnings?: number;
  minScore?: number;
  scoreTolerance?: number;
  verbose?: boolean;
  json?: boolean;
};

type DiffCliOptions = DiffRunOptions & {
  json?: boolean;
  verbose?: boolean;
};

/** Registers `css-doctor diff`. */
export function registerDiffCommand(program: Command): void {
  program
    .command("diff")
    .description("Compare current CSS quality against a committed baseline")
    .argument(
      "[patterns...]",
      "CSS files or glob patterns (falls back to config.patterns or baseline patterns)",
    )
    .option(
      "-b, --baseline <path>",
      `Baseline path (default: ${DEFAULT_BASELINE_PATH})`,
    )
    .option("--config <path>", "Project config path")
    .option(
      "--threshold <number>",
      "Selector-count threshold for current analysis",
      parseNonNegativeInteger,
    )
    .option("--fail-on-regression", "Exit 1 when status is regressed or mixed")
    .option("--fail-on-new-errors", "Exit 1 when new error diagnostics appear")
    .option(
      "--fail-on-new-diagnostics",
      "Exit 1 when any new diagnostics appear",
    )
    .option(
      "--max-size-increase <value>",
      "Fail when CSS size grows by more than this percent (e.g. 10 or 10%)",
      parsePercent,
    )
    .option(
      "--max-new-errors <number>",
      "Fail when new error count exceeds this value",
      parseNonNegativeInteger,
    )
    .option(
      "--max-new-warnings <number>",
      "Fail when new warning count exceeds this value",
      parseNonNegativeInteger,
    )
    .option(
      "--min-score <number>",
      "Fail when current overall score is below this value",
      parseScore,
    )
    .option(
      "--score-tolerance <number>",
      "Ignore overall/dimension score deltas within this absolute tolerance",
      parseNonNegativeInteger,
    )
    .option("-v, --verbose", "Show detailed file and diagnostic lists")
    .option("-j, --json", "Output raw JSON for piping and CI/CD")
    .action(async (patterns: string[], options: DiffCliOptions) => {
      const report = await runDiff(patterns ?? [], options);

      if (options.json === true) {
        process.stdout.write(`${formatJsonReport(report)}\n`);
      } else if (report.regression) {
        process.stdout.write(
          `${formatRegressionTerminalReport(report.regression, {
            verbose: options.verbose === true,
          })}\n`,
        );
        if (report.errors.length > 0) {
          process.stderr.write(
            `css-doctor: ${report.errors.join("\ncss-doctor: ")}\n`,
          );
        }
      } else {
        process.stdout.write(
          `css-doctor diff failed:\n${report.errors
            .map((error) => `  - ${error}`)
            .join("\n")}\n`,
        );
      }

      process.exitCode = report.success ? 0 : 1;
    });
}

/**
 * Compares the current project CSS against a stored baseline.
 *
 * CLI flags override `.css-doctor/config.json`, which overrides defaults.
 */
export async function runDiff(
  patterns: string[],
  options: DiffRunOptions = {},
): Promise<DiffCliReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const loaded = await loadProjectConfig(cwd, options.config);
  const errors = [...loaded.errors];
  const warnings: string[] = [];
  const baselinePath = resolveBaselinePath(
    cwd,
    options.baseline ?? loaded.config.baseline,
  );
  const displayPath = toDisplayPath(baselinePath, cwd);

  const stored = await readBaselineFile(baselinePath);
  if (!stored.ok) {
    return {
      schemaVersion: 1,
      command: "diff",
      success: false,
      errors: [...errors, stored.error],
      warnings,
      baselinePath: displayPath,
      regression: null,
    };
  }

  try {
    const validation = validateBaselineJson(stored.json);
    if (validation.status === "incompatible") {
      return {
        schemaVersion: 1,
        command: "diff",
        success: false,
        errors: [
          ...errors,
          validation.message ??
            "Baseline is incompatible with this tool version.",
        ],
        warnings,
        baselinePath: displayPath,
        regression: null,
      };
    }
    if (validation.status === "softWarning" && validation.message) {
      warnings.push(validation.message);
    }
  } catch (error) {
    return {
      schemaVersion: 1,
      command: "diff",
      success: false,
      errors: [
        ...errors,
        error instanceof Error ? error.message : String(error),
      ],
      warnings,
      baselinePath: displayPath,
      regression: null,
    };
  }

  let baselinePatterns: string[] = [];
  try {
    const parsed = JSON.parse(stored.json) as {
      config?: { patterns?: string[] };
    };
    baselinePatterns = parsed.config?.patterns ?? [];
  } catch {
    baselinePatterns = [];
  }

  const effectivePatterns =
    patterns.length > 0
      ? patterns
      : options.patterns && options.patterns.length > 0
        ? options.patterns
        : loaded.config.patterns.length > 0
          ? loaded.config.patterns
          : baselinePatterns;

  const current = await createBaselineSnapshot({
    cwd,
    patterns: effectivePatterns,
    threshold: options.threshold ?? loaded.config.threshold,
  });

  if (!current.ok) {
    return {
      schemaVersion: 1,
      command: "diff",
      success: false,
      errors: [...errors, ...current.errors],
      warnings,
      baselinePath: displayPath,
      regression: null,
    };
  }

  try {
    const binding = loadBinding();
    const compareOptions = {
      scoreTolerance:
        options.scoreTolerance ?? loaded.config.regression.scoreTolerance,
      sizeAbsoluteToleranceBytes:
        loaded.config.regression.sizeAbsoluteToleranceBytes,
      sizeIncreasePercent: loaded.config.regression.sizeIncreasePercent,
    };
    const gates = buildGateConfig(options, loaded.config);

    const regressionJson = binding.compareBaselines(
      stored.json,
      current.json,
      compareOptions,
      gates,
    );
    const regression = JSON.parse(regressionJson) as RegressionReport;
    warnings.push(...(regression.warnings ?? []));

    const gateFailed = regression.qualityGates
      ? regression.qualityGates.passed === false
      : false;
    const setupOk = errors.length === 0;

    return {
      schemaVersion: 1,
      command: "diff",
      success: setupOk && !gateFailed,
      errors: [
        ...errors,
        ...(gateFailed && regression.qualityGates?.failureSummary
          ? [`Quality gates failed: ${regression.qualityGates.failureSummary}`]
          : []),
      ],
      warnings,
      baselinePath: displayPath,
      regression,
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      command: "diff",
      success: false,
      errors: [
        ...errors,
        error instanceof Error ? error.message : String(error),
      ],
      warnings,
      baselinePath: displayPath,
      regression: null,
    };
  }
}

function buildGateConfig(
  options: DiffRunOptions,
  config: CssDoctorConfig,
): {
  minScore?: number;
  maxSizeIncreasePercent?: number;
  maxNewErrors?: number;
  maxNewWarnings?: number;
  failOnRegression?: boolean;
  failOnNewErrors?: boolean;
  failOnNewDiagnostics?: boolean;
} {
  const maxSizeIncrease =
    options.maxSizeIncrease !== undefined
      ? typeof options.maxSizeIncrease === "number"
        ? options.maxSizeIncrease
        : parsePercent(String(options.maxSizeIncrease))
      : (config.qualityGates.maxSizeIncreasePercent ??
        config.regression.sizeIncreasePercent);

  const minScore =
    options.minScore ?? config.qualityGates.minScore ?? undefined;
  const maxNewErrors =
    options.maxNewErrors ??
    config.qualityGates.maxNewErrors ??
    config.regression.maxNewErrors ??
    undefined;
  const maxNewWarnings =
    options.maxNewWarnings ??
    config.qualityGates.maxNewWarnings ??
    config.regression.maxNewWarnings ??
    undefined;

  const failOnRegression =
    options.failOnRegression === true ||
    config.qualityGates.failOnRegression === true;
  const failOnNewErrors =
    options.failOnNewErrors === true ||
    config.qualityGates.failOnNewErrors === true;
  const failOnNewDiagnostics =
    options.failOnNewDiagnostics === true ||
    config.qualityGates.failOnNewDiagnostics === true;

  const gates: {
    minScore?: number;
    maxSizeIncreasePercent?: number;
    maxNewErrors?: number;
    maxNewWarnings?: number;
    failOnRegression?: boolean;
    failOnNewErrors?: boolean;
    failOnNewDiagnostics?: boolean;
  } = {};

  if (minScore !== null && minScore !== undefined) {
    gates.minScore = minScore;
  }
  if (
    options.maxSizeIncrease !== undefined ||
    config.qualityGates.maxSizeIncreasePercent !== null ||
    failOnRegression
  ) {
    // Only enforce size growth when explicitly requested via CLI/config gate,
    // not merely because regression defaults include a tolerance percent.
    if (
      options.maxSizeIncrease !== undefined ||
      config.qualityGates.maxSizeIncreasePercent !== null
    ) {
      gates.maxSizeIncreasePercent = maxSizeIncrease ?? undefined;
    }
  }
  if (maxNewErrors !== null && maxNewErrors !== undefined) {
    gates.maxNewErrors = maxNewErrors;
  }
  if (maxNewWarnings !== null && maxNewWarnings !== undefined) {
    gates.maxNewWarnings = maxNewWarnings;
  }
  if (failOnRegression) {
    gates.failOnRegression = true;
  }
  if (failOnNewErrors) {
    gates.failOnNewErrors = true;
  }
  if (failOnNewDiagnostics) {
    gates.failOnNewDiagnostics = true;
  }

  return gates;
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("must be a non-negative integer");
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

function parsePercent(value: string): number {
  const trimmed = value.trim().endsWith("%")
    ? value.trim().slice(0, -1)
    : value.trim();
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new InvalidArgumentError("must be a non-negative percent (e.g. 10%)");
  }
  return parsed;
}
