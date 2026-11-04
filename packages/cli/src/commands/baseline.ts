import { resolve } from "node:path";

import { InvalidArgumentError, type Command } from "commander";

import { formatJsonReport } from "../formatters/json";
import {
  createBaselineSnapshot,
  readBaselineFile,
  removeBaselineFile,
  validateBaselineJson,
  writeBaselineFile,
  type BaselineDocumentJson,
} from "../utils/baseline-io";
import {
  DEFAULT_BASELINE_PATH,
  loadProjectConfig,
  resolveBaselinePath,
} from "../utils/config";
import { toDisplayPath } from "../utils/file";

export type BaselineCliReport = {
  schemaVersion: 1;
  command: "baseline";
  action: "create" | "show" | "validate" | "remove";
  success: boolean;
  errors: string[];
  warnings: string[];
  baselinePath: string;
  baseline: BaselineDocumentJson | null;
};

type SharedOptions = {
  cwd?: string;
  output?: string;
  baseline?: string;
  config?: string;
  threshold?: number;
  json?: boolean;
};

/** Registers `css-doctor baseline` subcommands. */
export function registerBaselineCommand(program: Command): void {
  const baseline = program
    .command("baseline")
    .description("Create, inspect, validate, or remove a CSS quality baseline");

  baseline
    .command("create")
    .description("Create a baseline from the current CSS Health Score")
    .argument(
      "[patterns...]",
      "CSS files or glob patterns (falls back to config.patterns)",
    )
    .option(
      "-o, --output <path>",
      `Baseline output path (default: ${DEFAULT_BASELINE_PATH})`,
    )
    .option("--config <path>", "Project config path")
    .option(
      "--threshold <number>",
      "Selector-count threshold stored with the baseline",
      parseNonNegativeInteger,
    )
    .option("-j, --json", "Emit JSON instead of a human summary")
    .action(async (patterns: string[], options: SharedOptions) => {
      const report = await runBaselineCreate(patterns ?? [], options);
      writeBaselineReport(report, options.json === true);
      process.exitCode = report.success ? 0 : 1;
    });

  baseline
    .command("show")
    .description("Display baseline metadata and scores")
    .option(
      "-b, --baseline <path>",
      `Baseline path (default: ${DEFAULT_BASELINE_PATH})`,
    )
    .option("--config <path>", "Project config path")
    .option("-j, --json", "Emit JSON instead of a human summary")
    .action(async (options: SharedOptions) => {
      const report = await runBaselineShow(options);
      writeBaselineReport(report, options.json === true);
      process.exitCode = report.success ? 0 : 1;
    });

  baseline
    .command("validate")
    .description("Validate baseline schema and compatibility")
    .option(
      "-b, --baseline <path>",
      `Baseline path (default: ${DEFAULT_BASELINE_PATH})`,
    )
    .option("--config <path>", "Project config path")
    .option("-j, --json", "Emit JSON instead of a human summary")
    .action(async (options: SharedOptions) => {
      const report = await runBaselineValidate(options);
      writeBaselineReport(report, options.json === true);
      process.exitCode = report.success ? 0 : 1;
    });

  baseline
    .command("remove")
    .description("Delete the baseline file")
    .option(
      "-b, --baseline <path>",
      `Baseline path (default: ${DEFAULT_BASELINE_PATH})`,
    )
    .option("--config <path>", "Project config path")
    .option("-j, --json", "Emit JSON instead of a human summary")
    .action(async (options: SharedOptions) => {
      const report = await runBaselineRemove(options);
      writeBaselineReport(report, options.json === true);
      process.exitCode = report.success ? 0 : 1;
    });
}

export async function runBaselineCreate(
  patterns: string[],
  options: SharedOptions = {},
): Promise<BaselineCliReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const loaded = await loadProjectConfig(cwd, options.config);
  const errors = [...loaded.errors];
  const effectivePatterns =
    patterns.length > 0 ? patterns : loaded.config.patterns;
  const baselinePath = resolveBaselinePath(
    cwd,
    options.output ?? loaded.config.baseline,
  );

  const snapshot = await createBaselineSnapshot({
    cwd,
    patterns: effectivePatterns,
    threshold: options.threshold ?? loaded.config.threshold,
  });

  if (!snapshot.ok) {
    return {
      schemaVersion: 1,
      command: "baseline",
      action: "create",
      success: false,
      errors: [...errors, ...snapshot.errors],
      warnings: [],
      baselinePath: toDisplayPath(baselinePath, cwd),
      baseline: null,
    };
  }

  const written = await writeBaselineFile(baselinePath, snapshot.json);
  if (!written.ok) {
    return {
      schemaVersion: 1,
      command: "baseline",
      action: "create",
      success: false,
      errors: [...errors, written.error],
      warnings: [],
      baselinePath: toDisplayPath(baselinePath, cwd),
      baseline: null,
    };
  }

  return {
    schemaVersion: 1,
    command: "baseline",
    action: "create",
    success: errors.length === 0,
    errors,
    warnings: [],
    baselinePath: toDisplayPath(baselinePath, cwd),
    baseline: snapshot.document,
  };
}

export async function runBaselineShow(
  options: SharedOptions = {},
): Promise<BaselineCliReport> {
  return readAndReport("show", options);
}

export async function runBaselineValidate(
  options: SharedOptions = {},
): Promise<BaselineCliReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const loaded = await loadProjectConfig(cwd, options.config);
  const errors = [...loaded.errors];
  const warnings: string[] = [];
  const baselinePath = resolveBaselinePath(
    cwd,
    options.baseline ?? loaded.config.baseline,
  );
  const displayPath = toDisplayPath(baselinePath, cwd);
  const read = await readBaselineFile(baselinePath);

  if (!read.ok) {
    return {
      schemaVersion: 1,
      command: "baseline",
      action: "validate",
      success: false,
      errors: [...errors, read.error],
      warnings,
      baselinePath: displayPath,
      baseline: null,
    };
  }

  try {
    const validation = validateBaselineJson(read.json);
    if (validation.status === "incompatible") {
      errors.push(validation.message ?? "Baseline is incompatible.");
    } else if (validation.status === "softWarning" && validation.message) {
      warnings.push(validation.message);
    }

    return {
      schemaVersion: 1,
      command: "baseline",
      action: "validate",
      success: errors.length === 0,
      errors,
      warnings,
      baselinePath: displayPath,
      baseline: JSON.parse(read.json) as BaselineDocumentJson,
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      command: "baseline",
      action: "validate",
      success: false,
      errors: [
        ...errors,
        error instanceof Error ? error.message : String(error),
      ],
      warnings,
      baselinePath: displayPath,
      baseline: null,
    };
  }
}

export async function runBaselineRemove(
  options: SharedOptions = {},
): Promise<BaselineCliReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const loaded = await loadProjectConfig(cwd, options.config);
  const errors = [...loaded.errors];
  const baselinePath = resolveBaselinePath(
    cwd,
    options.baseline ?? loaded.config.baseline,
  );
  const displayPath = toDisplayPath(baselinePath, cwd);
  const removed = await removeBaselineFile(baselinePath);

  if (!removed.ok) {
    errors.push(removed.error);
  }

  return {
    schemaVersion: 1,
    command: "baseline",
    action: "remove",
    success: errors.length === 0,
    errors,
    warnings: [],
    baselinePath: displayPath,
    baseline: null,
  };
}

async function readAndReport(
  action: "show" | "validate",
  options: SharedOptions,
): Promise<BaselineCliReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const loaded = await loadProjectConfig(cwd, options.config);
  const errors = [...loaded.errors];
  const baselinePath = resolveBaselinePath(
    cwd,
    options.baseline ?? loaded.config.baseline,
  );
  const displayPath = toDisplayPath(baselinePath, cwd);
  const read = await readBaselineFile(baselinePath);

  if (!read.ok) {
    return {
      schemaVersion: 1,
      command: "baseline",
      action,
      success: false,
      errors: [...errors, read.error],
      warnings: [],
      baselinePath: displayPath,
      baseline: null,
    };
  }

  try {
    return {
      schemaVersion: 1,
      command: "baseline",
      action,
      success: errors.length === 0,
      errors,
      warnings: [],
      baselinePath: displayPath,
      baseline: JSON.parse(read.json) as BaselineDocumentJson,
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      command: "baseline",
      action,
      success: false,
      errors: [
        ...errors,
        `Corrupted baseline JSON at ${displayPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
      warnings: [],
      baselinePath: displayPath,
      baseline: null,
    };
  }
}

function writeBaselineReport(report: BaselineCliReport, json: boolean): void {
  if (json) {
    process.stdout.write(`${formatJsonReport(report)}\n`);
    return;
  }

  if (!report.success) {
    process.stdout.write(
      `css-doctor baseline ${report.action} failed:\n${report.errors
        .map((error) => `  - ${error}`)
        .join("\n")}\n`,
    );
    return;
  }

  if (report.action === "remove") {
    process.stdout.write(`Removed baseline ${report.baselinePath}\n`);
    return;
  }

  if (report.action === "create") {
    process.stdout.write(
      `Created baseline ${report.baselinePath}` +
        (report.baseline
          ? ` · score ${report.baseline.health.overall}/100 · ${report.baseline.files.length} files\n`
          : "\n"),
    );
  } else if (report.baseline) {
    const health = report.baseline.health;
    process.stdout.write(
      [
        `Baseline ${report.baselinePath}`,
        `  schema ${report.baseline.schemaVersion} · tool ${report.baseline.toolVersion}`,
        `  created ${report.baseline.createdAt}`,
        `  score ${health.overall}/100 ${health.grade} (${health.status})`,
        `  ${health.files} files · ${health.rules} rules · ${health.sizeBytes} bytes`,
        ...report.warnings.map((warning) => `  warning: ${warning}`),
        "",
      ].join("\n"),
    );
  }

  for (const warning of report.warnings) {
    if (report.action === "create") {
      process.stderr.write(`css-doctor: ${warning}\n`);
    }
  }
}

function parseNonNegativeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError("must be a non-negative integer");
  }
  return parsed;
}
