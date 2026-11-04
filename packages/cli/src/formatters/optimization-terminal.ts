import picocolors from "picocolors";

import type {
  FixApplicationResult,
  OptimizationDecision,
  OptimizationReport,
} from "../types/optimization";

type Palette = ReturnType<typeof picocolors.createColors>;

export type OptimizationTerminalOptions = {
  color?: boolean;
  columns?: number;
  verbose?: boolean;
  dryRun?: boolean;
};

/** Formats an optimization intelligence report for the terminal. */
export function formatOptimizationTerminalReport(
  report: OptimizationReport,
  options: OptimizationTerminalOptions = {},
): string {
  const colors = picocolors.createColors(
    options.color ?? picocolors.isColorSupported,
  );
  const columns = Math.max(
    48,
    Math.min(options.columns ?? detectColumns(), 88),
  );
  const verbose = options.verbose === true;
  const lines: string[] = [];
  const rule = colors.dim("─".repeat(Math.min(columns, 64)));

  lines.push("");
  lines.push(
    `  ${colors.bold(colors.cyan("CSS DOCTOR"))}${pad(
      columns - 30,
      "",
    )}${colors.dim(
      options.dryRun === true ? "OPTIMIZATION PREVIEW" : "OPTIMIZATION REPORT",
    )}`,
  );
  lines.push("");
  lines.push(
    `  ${colors.bold(
      options.dryRun === true
        ? "Optimization preview"
        : "Optimization completed",
    )}`,
  );
  lines.push("");
  lines.push(
    `  ${label("Original size").padEnd(20)}${formatBytes(report.input.bytes)}`,
  );
  lines.push(
    `  ${label("Emitted total").padEnd(20)}${formatBytes(report.output.bytes)}`,
  );
  const eliminated = report.impact.bytesEliminated;
  const elimPct = report.impact.eliminationPercent;
  lines.push(
    `  ${label("Eliminated").padEnd(20)}${formatSignedBytes(eliminated, colors)}${
      elimPct === null || elimPct === undefined
        ? ""
        : colors.dim(
            `  (${elimPct > 0 ? "+" : ""}${elimPct.toFixed(1)}% vs reference)`,
          )
    }`,
  );
  if (report.impact.redistributedBytes !== 0) {
    lines.push(
      `  ${colors.dim(
        `Redistributed (split duplication): ${formatSignedBytes(report.impact.redistributedBytes, colors)}`,
      )}`,
    );
  }
  lines.push("");
  lines.push(`  ${label("Files analyzed").padEnd(20)}${report.input.files}`);
  lines.push(
    `  ${label("Output chunks").padEnd(20)}${report.impact.chunksCreated}`,
  );
  lines.push(
    `  ${label("Selectors removed").padEnd(20)}${report.impact.selectorsRemoved}`,
  );
  lines.push(
    `  ${label("Variables chunks").padEnd(20)}${report.impact.variablesChunks}`,
  );
  lines.push("");
  lines.push(
    `  ${colors.dim(`Processing time  ${formatDuration(report.analysisMs)}`)}`,
  );

  lines.push("");
  lines.push(rule);
  lines.push("");
  lines.push(`  ${colors.bold("OPTIMIZATION BREAKDOWN")}`);
  lines.push("");
  lines.push(
    `  ${statusLine("Minification", report.operations.minified, colors)}`,
  );
  lines.push(
    `  ${statusLine("Page coverage splitting", report.operations.pageCoverageSplit, colors)}`,
  );
  lines.push(
    `  ${statusLine("Size budget splitting", report.operations.sizeBudgetSplit, colors)}`,
  );
  lines.push(
    `  ${statusLine("Variable isolation", report.operations.variablesIsolated, colors)}`,
  );
  lines.push(
    `  ${statusLine("Dead CSS elimination", report.operations.deadCodeEliminated, colors)}`,
  );

  if (report.chunks.length > 0) {
    lines.push("");
    lines.push(`  ${colors.bold("OUTPUT DISTRIBUTION")}`);
    lines.push("");
    const shown = report.chunks.slice(0, verbose ? 20 : 8);
    for (const chunk of shown) {
      const mark = chunk.oversized ? colors.yellow("▲") : colors.dim("·");
      lines.push(
        `  ${mark} ${chunk.name.padEnd(24)} ${formatBytes(chunk.sizeBytes)}`,
      );
    }
    if (report.chunks.length > shown.length) {
      lines.push(
        `  ${colors.dim(`… and ${report.chunks.length - shown.length} more chunks`)}`,
      );
    }
  }

  const decisions = report.decisions.slice(0, verbose ? 30 : 8);
  if (decisions.length > 0) {
    lines.push("");
    lines.push(rule);
    lines.push("");
    lines.push(`  ${colors.bold("OPTIMIZATION DECISIONS")}`);
    lines.push("");
    for (const decision of decisions) {
      lines.push(...formatDecision(decision, colors));
    }
    if (report.decisions.length > decisions.length) {
      lines.push(
        `  ${colors.dim(
          `… and ${report.decisions.length - decisions.length} more (use --verbose or --json)`,
        )}`,
      );
    }
  }

  if (report.warnings.length > 0) {
    lines.push("");
    for (const warning of report.warnings) {
      lines.push(`  ${colors.yellow("!")} ${warning}`);
    }
  }

  if (options.dryRun === true) {
    lines.push("");
    lines.push(rule);
    lines.push("");
    lines.push(`  ${colors.bold("No files were modified.")}`);
    lines.push(
      `  ${colors.dim("Run without --dry-run and with --out-dir to emit chunks.")}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

/** Formats an autofix report. */
export function formatFixTerminalReport(
  results: FixApplicationResult[],
  options: OptimizationTerminalOptions = {},
): string {
  const colors = picocolors.createColors(
    options.color ?? picocolors.isColorSupported,
  );
  const columns = Math.max(
    48,
    Math.min(options.columns ?? detectColumns(), 88),
  );
  const lines: string[] = [];
  const rule = colors.dim("─".repeat(Math.min(columns, 64)));

  const safe = results.reduce((sum, result) => sum + result.plan.safeCount, 0);
  const review = results.reduce(
    (sum, result) => sum + result.plan.reviewCount,
    0,
  );
  const unsafe = results.reduce(
    (sum, result) => sum + result.plan.unsafeCount,
    0,
  );
  const applied = results.reduce(
    (sum, result) =>
      sum + result.plan.items.filter((item) => item.applied).length,
    0,
  );
  const changedFiles = results.filter((result) => result.changed).length;
  const issues = results.reduce(
    (sum, result) => sum + result.plan.items.length,
    0,
  );

  lines.push("");
  lines.push(
    `  ${colors.bold(colors.cyan("CSS DOCTOR"))}${pad(
      columns - 22,
      "",
    )}${colors.dim("FIX REPORT")}`,
  );
  lines.push("");
  lines.push(`  ${colors.bold("Fix analysis completed")}`);
  lines.push("");
  lines.push(`  ${issues} issues detected`);
  lines.push(`  ${safe} safe fixes available`);
  lines.push(`  ${review} review-required fixes`);
  lines.push(`  ${unsafe} unsafe fixes skipped by default`);
  lines.push("");
  lines.push(`  Applied:`);
  lines.push(
    `    ${colors.green("✓")} ${applied} fix occurrence(s)${
      options.dryRun === true ? colors.dim(" (dry-run)") : ""
    }`,
  );
  lines.push("");
  lines.push(`  Skipped:`);
  lines.push(`    ${colors.yellow("▲")} ${review} fixes require review`);
  lines.push(`    ${colors.red("✕")} ${unsafe} fixes may change CSS behavior`);
  lines.push("");
  lines.push(
    `  Files ${options.dryRun === true ? "that would change" : "modified"}: ${changedFiles}`,
  );

  if (options.verbose === true) {
    lines.push("");
    lines.push(rule);
    lines.push("");
    for (const result of results) {
      if (!result.filePath) {
        continue;
      }
      lines.push(`  ${result.filePath}`);
      for (const item of result.plan.items.slice(0, 10)) {
        const marker = item.applied ? colors.green("✓") : colors.dim("·");
        lines.push(`    ${marker} ${item.rule} — ${item.message}`);
      }
    }
  }

  if (options.dryRun === true) {
    lines.push("");
    lines.push(`  ${colors.bold("No files were modified.")}`);
    lines.push(
      `  ${colors.dim("Re-run without --dry-run to apply Safe fixes.")}`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

/** Builds a short unified diff between original and fixed CSS. */
export function formatUnifiedDiff(
  filePath: string,
  before: string,
  after: string,
  options: { maxLines?: number } = {},
): string {
  if (before === after) {
    return "";
  }
  const maxLines = options.maxLines ?? 80;
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const lines = [`--- a/${filePath}`, `+++ b/${filePath}`, `@@ preview @@`];

  // Concise line-oriented preview (not a full LCS diff): show removed then added.
  for (const line of beforeLines.slice(0, Math.floor(maxLines / 2))) {
    lines.push(`-${line}`);
  }
  for (const line of afterLines.slice(0, Math.floor(maxLines / 2))) {
    lines.push(`+${line}`);
  }
  if (beforeLines.length + afterLines.length > maxLines) {
    lines.push(`\\ No newline / truncated for preview`);
  }
  return `${lines.join("\n")}\n`;
}

function formatDecision(
  decision: OptimizationDecision,
  colors: Palette,
): string[] {
  const marker =
    decision.type === "oversized-chunk" || decision.type === "retain-uncertain"
      ? colors.yellow("▲")
      : decision.changed
        ? colors.green("✓")
        : colors.cyan("●");
  const lines = [`  ${marker} ${colors.bold(decision.title)}`];
  if (decision.source.selector) {
    lines.push(`    ${colors.magenta(decision.source.selector)}`);
  }
  lines.push(`    ${colors.dim(decision.explanation)}`);
  return [...lines, ""];
}

function statusLine(
  labelText: string,
  enabled: boolean,
  colors: Palette,
): string {
  return `${labelText.padEnd(24)} ${
    enabled ? colors.green("Completed") : colors.dim("Skipped")
  }`;
}

function formatSignedBytes(value: number, colors: Palette): string {
  const abs = formatBytes(Math.abs(value));
  if (value > 0) {
    return colors.green(`+${abs}`);
  }
  if (value < 0) {
    return colors.red(`-${abs}`);
  }
  return colors.dim(abs);
}

function label(text: string): string {
  return text;
}

function detectColumns(): number {
  const columns = process.stdout.columns;
  return typeof columns === "number" && columns > 0 ? columns : 80;
}

function pad(width: number, text: string): string {
  return " ".repeat(Math.max(1, width - text.length));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${ms.toFixed(2)} ms`;
  }
  if (ms < 1000) {
    return `${ms.toFixed(1)} ms`;
  }
  return `${(ms / 1000).toFixed(2)} s`;
}
