import { createRequire } from "node:module";
import { resolve } from "node:path";

import { InvalidArgumentError, type Command } from "commander";
import type { JsHealthReport } from "@zealakit/css-doctor-binding";

import { formatJsonReport } from "../formatters/json";
import { formatHealthTerminalReport } from "../formatters/health-terminal";
import {
  describeError,
  isDirectory,
  readCssFile,
  resolveCssFiles,
  toDisplayPath,
} from "../utils/file";

type BindingModule = typeof import("@zealakit/css-doctor-binding");

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

export type HealthRunOptions = {
  cwd?: string;
  threshold?: number;
  failUnder?: number;
};

export type HealthCliReport = {
  schemaVersion: 1;
  command: "health";
  success: boolean;
  errors: string[];
  patterns: string[];
  threshold: number | null;
  failUnder: number | null;
  health: JsHealthReport | null;
};

type HealthCliOptions = {
  json?: boolean;
  threshold?: number;
  failUnder?: number;
};

/** Registers `css-doctor health`. */
export function registerHealthCommand(program: Command): void {
  program
    .command("health")
    .description("Evaluate CSS Health Score with dimension breakdown")
    .argument(
      "[patterns...]",
      "CSS files or glob patterns (quote globs to let css-doctor expand them)",
    )
    .option("-j, --json", "Output raw JSON for piping and CI/CD")
    .option(
      "--threshold <number>",
      "Warn in size/complexity checks when a file has more than <number> selectors",
      parseNonNegativeInteger,
    )
    .option(
      "--fail-under <number>",
      "Exit with code 1 when overall health score is below <number> (0-100)",
      parseScore,
    )
    .action(async (patterns: string[], options: HealthCliOptions) => {
      const report = await runHealth(patterns ?? [], {
        threshold: options.threshold,
        failUnder: options.failUnder,
      });

      if (options.json === true) {
        process.stdout.write(`${formatJsonReport(report)}\n`);
      } else if (report.health) {
        process.stdout.write(`${formatHealthTerminalReport(report.health)}\n`);
        if (report.errors.length > 0) {
          process.stderr.write(
            `css-doctor: ${report.errors.join("\ncss-doctor: ")}\n`,
          );
        }
      } else {
        process.stdout.write(
          `css-doctor health failed:\n${report.errors.map((error) => `  - ${error}`).join("\n")}\n`,
        );
      }

      process.exitCode = healthExitCode(report);
    });
}

/**
 * Runs multi-file CSS Health Score evaluation.
 *
 * Setup failures are collected in `errors`. `--fail-under` is applied after a
 * successful evaluation and affects `success` / exit code only.
 */
export async function runHealth(
  patterns: string[],
  options: HealthRunOptions = {},
): Promise<HealthCliReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const threshold = options.threshold ?? null;
  const failUnder = options.failUnder ?? null;
  const errors: string[] = [];

  if (failUnder !== null && (failUnder < 0 || failUnder > 100)) {
    errors.push("--fail-under must be an integer between 0 and 100.");
  }

  if (threshold !== null && (!Number.isInteger(threshold) || threshold < 0)) {
    errors.push("Threshold must be a non-negative integer.");
  }

  let files: string[] = [];

  if (patterns.length === 0) {
    errors.push(
      'No CSS files or glob patterns were provided. Example: css-doctor health "src/**/*.css"',
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

  if (errors.length > 0) {
    return {
      schemaVersion: 1,
      command: "health",
      success: false,
      errors,
      patterns,
      threshold,
      failUnder,
      health: null,
    };
  }

  try {
    const binding = loadBinding();
    const batchFiles = [];

    for (const file of files) {
      const read = await readCssFile(file);
      if (!read.ok) {
        errors.push(`${toDisplayPath(file, cwd)}: ${read.error}`);
        continue;
      }

      batchFiles.push({
        cssContent: read.content,
        filePath: toDisplayPath(file, cwd),
        sizeBytes: read.sizeBytes,
      });
    }

    if (batchFiles.length === 0) {
      return {
        schemaVersion: 1,
        command: "health",
        success: false,
        errors:
          errors.length > 0
            ? errors
            : ["No CSS files could be read for health scoring."],
        patterns,
        threshold,
        failUnder,
        health: null,
      };
    }

    const health = binding.evaluateCssHealthBatch({
      files: batchFiles,
      thresholds:
        threshold === null
          ? undefined
          : {
              manySelectors: threshold,
            },
    });

    // Surface selector-threshold pressure as already handled inside native size
    // checks when manySelectors is set. Additional empty-read errors stay listed.
    const belowFloor =
      failUnder !== null && health.overall < failUnder
        ? [
            `Overall health score ${health.overall} is below --fail-under ${failUnder}.`,
          ]
        : [];

    return {
      schemaVersion: 1,
      command: "health",
      success: errors.length === 0 && belowFloor.length === 0,
      errors: [...errors, ...belowFloor],
      patterns,
      threshold,
      failUnder,
      health,
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      command: "health",
      success: false,
      errors: [describeError(error)],
      patterns,
      threshold,
      failUnder,
      health: null,
    };
  }
}

export function healthExitCode(report: HealthCliReport): 0 | 1 {
  return report.success ? 0 : 1;
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
