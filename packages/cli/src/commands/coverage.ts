import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Command } from "commander";

import {
  DEFAULT_COVERAGE_PATH,
  mergeCoverage,
  readCoverageFile,
  runtimeEvidenceFrom,
  writeCoverageFile,
} from "../runtime-coverage/coverage-store";
import type { RouteMap } from "../runtime-coverage/coverage-store";
import { parseCoverageJson } from "../runtime-coverage/parse-coverage";
import type { NormalizedCoverageEntry } from "../runtime-coverage/parse-coverage";
import { toDisplayPath } from "../utils/file";

export type CoverageImportReport = {
  schemaVersion: 1;
  command: "coverage";
  action: "import";
  success: boolean;
  errors: string[];
  warnings: string[];
  outPath: string;
  importedEntries: number;
  routes: string[];
  usedSelectors: number;
  unusedSelectors: number;
};

type ImportCliOptions = {
  cwd?: string;
  routeMap?: string;
  pageUrl?: string;
  buildId?: string;
  out?: string;
  json?: boolean;
};

/** Registers `css-doctor coverage` subcommands. */
export function registerCoverageCommand(program: Command): void {
  const coverage = program
    .command("coverage")
    .description("Import browser CSS coverage as runtime usage evidence");

  coverage
    .command("import")
    .description(
      "Import Chrome/Puppeteer/Playwright CSS coverage into .css-doctor/coverage.json",
    )
    .argument("<files...>", "Coverage JSON files")
    .option("--cwd <path>", "Working directory")
    .option(
      "--route-map <path>",
      'JSON file mapping URL patterns to routes ({ "/blog/*": "/blog/[id]" })',
    )
    .option("--page-url <url>", "Page URL for inputs that do not record one")
    .option("--build-id <id>", "Build id stored with the entries")
    .option(
      "-o, --out <path>",
      `Output path (default: ${DEFAULT_COVERAGE_PATH})`,
    )
    .option("--json", "Print a machine-readable report")
    .action(async (files: string[], options: ImportCliOptions) => {
      const report = await importCoverage(files, options);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        printReport(report);
      }
      if (!report.success) {
        process.exitCode = 1;
      }
    });
}

export async function importCoverage(
  files: string[],
  options: ImportCliOptions = {},
): Promise<CoverageImportReport> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const outPath = resolve(cwd, options.out ?? DEFAULT_COVERAGE_PATH);
  const report: CoverageImportReport = {
    schemaVersion: 1,
    command: "coverage",
    action: "import",
    success: false,
    errors: [],
    warnings: [],
    outPath: toDisplayPath(outPath, cwd),
    importedEntries: 0,
    routes: [],
    usedSelectors: 0,
    unusedSelectors: 0,
  };

  let routeMap: RouteMap = {};
  if (options.routeMap) {
    try {
      const parsed = JSON.parse(
        await readFile(resolve(cwd, options.routeMap), "utf8"),
      ) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("route map must be a JSON object");
      }
      routeMap = parsed as RouteMap;
    } catch (error) {
      report.errors.push(
        `Cannot read route map ${options.routeMap}: ${(error as Error).message}`,
      );
      return report;
    }
  }

  const entries: NormalizedCoverageEntry[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(
        await readFile(resolve(cwd, file), "utf8"),
      ) as unknown;
      const parsed = parseCoverageJson(
        raw,
        options.pageUrl ? { pageUrl: options.pageUrl } : {},
      );
      entries.push(...parsed.entries);
    } catch (error) {
      report.errors.push(`${file}: ${(error as Error).message}`);
    }
  }
  if (entries.length === 0) {
    if (report.errors.length === 0) {
      report.errors.push("No coverage entries found in the input files.");
    }
    return report;
  }

  try {
    const existing = await readCoverageFile(outPath);
    const merged = mergeCoverage(existing, entries, {
      routeMap,
      ...(options.buildId !== undefined ? { buildId: options.buildId } : {}),
    });
    await writeCoverageFile(outPath, merged);

    const evidence = runtimeEvidenceFrom(merged);
    report.warnings.push(...evidence.warnings);
    report.routes = evidence.routes;
    report.importedEntries = entries.length;
    for (const verdict of evidence.verdicts.values()) {
      if (verdict === "hit") {
        report.usedSelectors += 1;
      } else {
        report.unusedSelectors += 1;
      }
    }
    // Input read errors do not fail the import when other files succeeded.
    report.warnings.push(...report.errors.splice(0));
    report.success = true;
  } catch (error) {
    report.errors.push(`Cannot write coverage: ${(error as Error).message}`);
  }
  return report;
}

function printReport(report: CoverageImportReport): void {
  for (const error of report.errors) {
    process.stderr.write(`error: ${error}\n`);
  }
  for (const warning of report.warnings) {
    process.stderr.write(`warning: ${warning}\n`);
  }
  if (report.success) {
    process.stdout.write(
      `Imported ${report.importedEntries} stylesheet(s) across ${report.routes.length} route(s) into ${report.outPath}\n` +
        `  used selectors ${report.usedSelectors} · never used ${report.unusedSelectors}\n`,
    );
  }
}
