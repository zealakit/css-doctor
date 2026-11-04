import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { InvalidArgumentError, type Command } from "commander";

import { formatJsonReport } from "../formatters/json";
import {
  formatOptimizationTerminalReport,
  formatUnifiedDiff,
} from "../formatters/optimization-terminal";
import type { OptimizationReport } from "../types/optimization";
import { loadBinding } from "../utils/binding";
import {
  describeError,
  isDirectory,
  readCssFile,
  resolveCssFiles,
  toDisplayPath,
} from "../utils/file";

export type OptimizeCliReport = {
  schemaVersion: 1;
  command: "optimize" | "split";
  success: boolean;
  dryRun: boolean;
  errors: string[];
  warnings: string[];
  patterns: string[];
  files: Array<{
    path: string;
    report: OptimizationReport;
    chunks: Array<{ name: string; css: string; sizeBytes: number }>;
    diff?: string;
  }>;
  outDir: string | null;
};

export type OptimizeRunOptions = {
  cwd?: string;
  dryRun?: boolean;
  explain?: boolean;
  json?: boolean;
  verbose?: boolean;
  diff?: boolean;
  report?: string;
  outDir?: string;
  minify?: boolean;
  pageUsage?: string;
  minPageRatio?: number;
  maxChunkSize?: number;
  noPageCoverage?: boolean;
  noSizeBudget?: boolean;
  noIsolateVariables?: boolean;
  commandName?: "optimize" | "split";
};

/** Registers `css-doctor optimize`. */
export function registerOptimizeCommand(program: Command): void {
  registerOptimizeLikeCommand(
    program,
    "optimize",
    "Preview or emit CSS optimization results with explanations",
  );
}

/** Registers `css-doctor split`. */
export function registerSplitCommand(program: Command): void {
  registerOptimizeLikeCommand(
    program,
    "split",
    "Preview page-coverage / size-budget CSS splitting",
  );
}

function registerOptimizeLikeCommand(
  program: Command,
  name: "optimize" | "split",
  description: string,
): void {
  program
    .command(name)
    .description(description)
    .argument(
      "[patterns...]",
      "CSS files or glob patterns (quote globs to let css-doctor expand them)",
    )
    .option("--dry-run", "Analyze and report without writing files")
    .option("--write", "Write emitted chunks to --out-dir")
    .option("--explain", "Include optimization decision explanations")
    .option("--diff", "Include concise unified diffs for emitted CSS")
    .option("-v, --verbose", "Show more decisions and chunks")
    .option("-j, --json", "Emit JSON")
    .option("--report <path>", "Write the JSON report to a file")
    .option("--out-dir <path>", "Directory for emitted chunks when writing")
    .option("--minify", "Minify emitted CSS")
    .option("--no-minify", "Disable minification")
    .option(
      "--page-usage <json>",
      "JSON map of page name → class name arrays for coverage splitting",
    )
    .option(
      "--min-page-ratio <number>",
      "Minimum coverage ratio for common CSS (0-1)",
      parseRatio,
    )
    .option(
      "--max-chunk-size <bytes>",
      "Size budget per body chunk in bytes",
      parsePositiveInteger,
    )
    .option("--no-page-coverage", "Disable page-coverage splitting")
    .option("--no-size-budget", "Disable size-budget splitting")
    .option("--no-isolate-variables", "Disable CSS variable isolation")
    .action(
      async (
        patterns: string[],
        options: OptimizeRunOptions & { write?: boolean; dryRun?: boolean },
      ) => {
        if (options.write === true && options.dryRun === true) {
          process.stderr.write(
            "css-doctor: --write and --dry-run are mutually exclusive.\n",
          );
          process.exitCode = 1;
          return;
        }

        const dryRun = options.write !== true;
        const report = await runOptimize(patterns ?? [], {
          ...options,
          dryRun,
          commandName: name,
          minify: options.minify !== false,
        });

        if (options.report) {
          const reportPath = resolve(
            options.cwd ?? process.cwd(),
            options.report,
          );
          try {
            await mkdir(dirname(reportPath), { recursive: true });
            await writeFile(
              reportPath,
              `${formatJsonReport(report)}\n`,
              "utf8",
            );
          } catch (error) {
            process.stderr.write(
              `css-doctor: failed to write --report ${reportPath}: ${describeError(error)}\n`,
            );
            process.exitCode = 1;
            return;
          }
        }

        if (options.json === true) {
          process.stdout.write(`${formatJsonReport(report)}\n`);
        } else if (report.files.length > 0) {
          for (const file of report.files) {
            process.stdout.write(
              `${formatOptimizationTerminalReport(file.report, {
                dryRun: report.dryRun,
                verbose: options.verbose === true || options.explain === true,
              })}\n`,
            );
            if (options.diff === true && file.diff) {
              process.stdout.write(`${file.diff}\n`);
            }
          }
          if (report.errors.length > 0) {
            process.stderr.write(
              `css-doctor: ${report.errors.join("\ncss-doctor: ")}\n`,
            );
          }
        } else {
          process.stdout.write(
            `css-doctor ${name} failed:\n${report.errors
              .map((error) => `  - ${error}`)
              .join("\n")}\n`,
          );
        }

        process.exitCode = report.success ? 0 : 1;
      },
    );
}

/** Runs optimize/split for matched CSS files. */
export async function runOptimize(
  patterns: string[],
  options: OptimizeRunOptions = {},
): Promise<OptimizeCliReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const command = options.commandName ?? "optimize";
  const dryRun = options.dryRun !== false;
  const errors: string[] = [];
  const warnings: string[] = [];
  const files: OptimizeCliReport["files"] = [];

  if (patterns.length === 0) {
    errors.push(
      `No CSS files or glob patterns were provided. Example: css-doctor ${command} "src/**/*.css" --dry-run`,
    );
  } else if (!(await isDirectory(cwd))) {
    errors.push(
      `Working directory does not exist or is not a directory: ${cwd}`,
    );
  }

  let pageUsage: Record<string, string[]> = {};
  if (options.pageUsage) {
    const parsedUsage = parsePageUsage(options.pageUsage);
    if (!parsedUsage.ok) {
      errors.push(parsedUsage.error);
    } else {
      pageUsage = parsedUsage.value;
    }
  }

  let cssFiles: string[] = [];
  if (errors.length === 0) {
    try {
      cssFiles = await resolveCssFiles(patterns, cwd);
      if (cssFiles.length === 0) {
        errors.push(`No CSS files matched: ${patterns.join(", ")}`);
      }
    } catch (error) {
      errors.push(`Failed to resolve CSS files: ${describeError(error)}`);
    }
  }

  const outDir = options.outDir ? resolve(cwd, options.outDir) : null;

  if (!dryRun && !outDir) {
    errors.push(
      "Writing chunks requires --out-dir (or omit --write for dry-run).",
    );
  }

  if (errors.length > 0) {
    return {
      schemaVersion: 1,
      command,
      success: false,
      dryRun,
      errors,
      warnings,
      patterns,
      files: [],
      outDir,
    };
  }

  try {
    const binding = loadBinding();
    const pipelineOptions = {
      pageUsage,
      pageCoverage: {
        enabled: options.noPageCoverage !== true,
        minPageRatio: options.minPageRatio,
      },
      sizeBudget: {
        enabled: options.noSizeBudget !== true,
        maxChunkSize: options.maxChunkSize,
        isolateVariables: options.noIsolateVariables !== true,
      },
      minify: options.minify !== false,
    };

    for (const absolute of cssFiles) {
      const read = await readCssFile(absolute);
      const displayPath = toDisplayPath(absolute, cwd);
      if (!read.ok) {
        errors.push(`${displayPath}: ${read.error}`);
        continue;
      }

      const explained = binding.optimizeCssExplained(
        {
          cssContent: read.content,
          ...pipelineOptions,
        },
        options.verbose === true ? 200 : 40,
      );
      const report = JSON.parse(explained.reportJson) as OptimizationReport;
      warnings.push(...report.warnings);

      const chunks = explained.pipeline.chunks.map((chunk) => ({
        name: chunk.name,
        css: chunk.css,
        sizeBytes: chunk.sizeBytes,
      }));

      let diff: string | undefined;
      if (options.diff === true) {
        const combined = chunks
          .map((chunk) => `/* ${chunk.name} */\n${chunk.css}`)
          .join("\n\n");
        diff = formatUnifiedDiff(displayPath, read.content, combined, {
          maxLines: options.verbose === true ? 200 : 80,
        });
      }

      if (!dryRun && outDir) {
        await mkdir(outDir, { recursive: true });
        const stem = displayPath.replace(/[\\/]/g, "__").replace(/\.css$/i, "");
        for (const chunk of chunks) {
          await writeFile(
            join(outDir, `${stem}.${chunk.name}.css`),
            chunk.css,
            "utf8",
          );
        }
      }

      files.push({ path: displayPath, report, chunks, diff });
    }
  } catch (error) {
    errors.push(describeError(error));
  }

  return {
    schemaVersion: 1,
    command,
    success: errors.length === 0,
    dryRun,
    errors,
    warnings,
    patterns,
    files,
    outDir,
  };
}

function parsePageUsage(
  raw: string,
):
  | { ok: true; value: Record<string, string[]> }
  | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      Array.isArray(parsed)
    ) {
      return {
        ok: false,
        error: "--page-usage must be a JSON object of page → string[].",
      };
    }

    const value: Record<string, string[]> = {};
    for (const [page, classes] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (
        !Array.isArray(classes) ||
        classes.some((item) => typeof item !== "string")
      ) {
        return {
          ok: false,
          error: `--page-usage page "${page}" must map to an array of class name strings.`,
        };
      }
      value[page] = classes as string[];
    }

    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: `Invalid --page-usage JSON: ${describeError(error)}`,
    };
  }
}

function parseRatio(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new InvalidArgumentError("must be a number between 0 and 1");
  }
  return parsed;
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("must be a positive integer");
  }
  return parsed;
}
