import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import type { Command } from "commander";

import { formatJsonReport } from "../formatters/json";
import {
  formatFixTerminalReport,
  formatUnifiedDiff,
} from "../formatters/optimization-terminal";
import type {
  FixApplicationResult,
  FixCatalogEntry,
} from "../types/optimization";
import { atomicWriteFile } from "../utils/atomic-write";
import { loadBinding } from "../utils/binding";
import {
  describeError,
  isDirectory,
  readCssFile,
  resolveCssFiles,
  toDisplayPath,
} from "../utils/file";

export type FixCliReport = {
  schemaVersion: 1;
  command: "fix";
  success: boolean;
  dryRun: boolean;
  errors: string[];
  catalog?: FixCatalogEntry[];
  files: Array<{
    path: string;
    result: FixApplicationResult;
    diff?: string;
  }>;
};

export type FixRunOptions = {
  cwd?: string;
  dryRun?: boolean;
  json?: boolean;
  verbose?: boolean;
  diff?: boolean;
  backup?: boolean;
  rules?: string[];
  list?: boolean;
};

/** Registers `css-doctor fix`. */
export function registerFixCommand(program: Command): void {
  program
    .command("fix")
    .description("Plan or apply Safe CSS autofixes")
    .argument(
      "[patterns...]",
      "CSS files or glob patterns (required unless --list)",
    )
    .option("--list", "List available autofix rules and exit")
    .option("--dry-run", "Preview fixes without writing files")
    .option("--write", "Apply Safe fixes to source files")
    .option(
      "--rule <id>",
      "Only consider this fix rule id (repeatable)",
      collectRule,
      [] as string[],
    )
    .option("--backup", "Write `.bak` copies before modifying files")
    .option("--diff", "Show unified diffs for changed files")
    .option("-v, --verbose", "List per-file fix items")
    .option("-j, --json", "Emit JSON")
    .action(
      async (
        patterns: string[],
        options: FixRunOptions & { write?: boolean; rule?: string[] },
      ) => {
        if (options.list === true) {
          const report = await runFixList();
          if (options.json === true) {
            process.stdout.write(`${formatJsonReport(report)}\n`);
          } else {
            process.stdout.write(`${formatFixCatalog(report.catalog ?? [])}\n`);
          }
          process.exitCode = report.success ? 0 : 1;
          return;
        }

        if (options.write === true && options.dryRun === true) {
          process.stderr.write(
            "css-doctor: --write and --dry-run are mutually exclusive.\n",
          );
          process.exitCode = 1;
          return;
        }

        const dryRun = options.write !== true;
        const report = await runFix(patterns ?? [], {
          ...options,
          dryRun,
          rules: options.rule ?? options.rules,
        });

        if (options.json === true) {
          process.stdout.write(`${formatJsonReport(report)}\n`);
        } else if (report.files.length > 0) {
          process.stdout.write(
            `${formatFixTerminalReport(
              report.files.map((file) => file.result),
              {
                dryRun: report.dryRun,
                verbose: options.verbose === true,
              },
            )}\n`,
          );
          if (options.diff === true) {
            for (const file of report.files) {
              if (file.diff) {
                process.stdout.write(`${file.diff}\n`);
              }
            }
          }
          if (report.errors.length > 0) {
            process.stderr.write(
              `css-doctor: ${report.errors.join("\ncss-doctor: ")}\n`,
            );
          }
        } else {
          process.stdout.write(
            `css-doctor fix failed:\n${report.errors
              .map((error) => `  - ${error}`)
              .join("\n")}\n`,
          );
        }

        process.exitCode = report.success ? 0 : 1;
      },
    );
}

export async function runFixList(): Promise<FixCliReport> {
  try {
    const binding = loadBinding();
    const catalog = JSON.parse(binding.listCssFixes()) as FixCatalogEntry[];
    return {
      schemaVersion: 1,
      command: "fix",
      success: true,
      dryRun: true,
      errors: [],
      catalog,
      files: [],
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      command: "fix",
      success: false,
      dryRun: true,
      errors: [describeError(error)],
      files: [],
    };
  }
}

/** Plans or applies autofixes for matched CSS files. */
export async function runFix(
  patterns: string[],
  options: FixRunOptions = {},
): Promise<FixCliReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const dryRun = options.dryRun !== false;
  const errors: string[] = [];
  const files: FixCliReport["files"] = [];

  if (patterns.length === 0) {
    return {
      schemaVersion: 1,
      command: "fix",
      success: false,
      dryRun,
      errors: [
        'No CSS files or glob patterns were provided. Example: css-doctor fix "src/**/*.css" --dry-run',
      ],
      files: [],
    };
  }

  if (!(await isDirectory(cwd))) {
    return {
      schemaVersion: 1,
      command: "fix",
      success: false,
      dryRun,
      errors: [
        `Working directory does not exist or is not a directory: ${cwd}`,
      ],
      files: [],
    };
  }

  let cssFiles: string[] = [];
  try {
    cssFiles = await resolveCssFiles(patterns, cwd);
    if (cssFiles.length === 0) {
      errors.push(`No CSS files matched: ${patterns.join(", ")}`);
    }
  } catch (error) {
    errors.push(`Failed to resolve CSS files: ${describeError(error)}`);
  }

  if (errors.length > 0) {
    return {
      schemaVersion: 1,
      command: "fix",
      success: false,
      dryRun,
      errors,
      files: [],
    };
  }

  try {
    const binding = loadBinding();

    for (const absolute of cssFiles) {
      const displayPath = toDisplayPath(absolute, cwd);
      const read = await readCssFile(absolute);
      if (!read.ok) {
        errors.push(`${displayPath}: ${read.error}`);
        continue;
      }

      let mode: number | undefined;
      try {
        mode = (await stat(absolute)).mode;
      } catch {
        mode = undefined;
      }

      const result = JSON.parse(
        binding.applyCssFixes({
          cssContent: read.content,
          filePath: displayPath,
          dryRun,
          rules:
            options.rules && options.rules.length > 0
              ? options.rules
              : undefined,
          includeReview: false,
        }),
      ) as FixApplicationResult;

      let diff: string | undefined;
      if (options.diff === true && result.changed) {
        diff = formatUnifiedDiff(
          displayPath,
          result.originalCss,
          result.fixedCss,
        );
      }

      if (!dryRun && result.changed) {
        const written = await atomicWriteFile(absolute, result.fixedCss, {
          mode,
          backup: options.backup === true,
        });
        if (!written.ok) {
          errors.push(written.error);
          continue;
        }
      }

      files.push({ path: displayPath, result, diff });
    }
  } catch (error) {
    errors.push(describeError(error));
  }

  return {
    schemaVersion: 1,
    command: "fix",
    success: errors.length === 0,
    dryRun,
    errors,
    files,
  };
}

function collectRule(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function formatFixCatalog(catalog: FixCatalogEntry[]): string {
  const lines = ["", "  Available autofix rules", ""];
  for (const entry of catalog) {
    lines.push(`  [${entry.safety}] ${entry.id}`);
    lines.push(`    ${entry.description}`);
    lines.push(`    ${entry.reason}`);
    lines.push("");
  }
  lines.push("  Only [safe] rules are applied by default.");
  lines.push("");
  return lines.join("\n");
}
