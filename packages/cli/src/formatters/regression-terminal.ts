import picocolors from "picocolors";

import type {
  DimensionDelta,
  GateEvaluation,
  RegressionReport,
  RegressionStatus,
} from "../types/regression";

type Palette = ReturnType<typeof picocolors.createColors>;

export type RegressionTerminalOptions = {
  color?: boolean;
  columns?: number;
  verbose?: boolean;
};

/** Formats a polished CSS regression report for the terminal. */
export function formatRegressionTerminalReport(
  report: RegressionReport,
  options: RegressionTerminalOptions = {},
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
      columns - 28,
      "",
    )}${colors.dim("REGRESSION REPORT")}`,
  );
  lines.push("");
  lines.push(`  ${colors.bold("Overall Health")}`);
  lines.push("");
  lines.push(
    `       ${scoreColor(
      report.current.score,
      colors,
    )(
      colors.bold(`${report.current.score}/100`),
    )}   ${colors.bold(report.current.grade)}  ${statusWord(
      report.current.status,
      colors,
    )}`,
  );
  lines.push("");
  lines.push(`  ${label("Baseline").padEnd(14)}${report.baseline.score}/100`);
  lines.push(`  ${label("Current").padEnd(14)}${report.current.score}/100`);
  lines.push(
    `  ${label("Change").padEnd(14)}${formatSigned(
      report.changes.score,
      "points",
      colors,
    )}`,
  );
  lines.push("");
  lines.push(`  ${statusBanner(report.status, colors)}`);
  lines.push("");
  lines.push(
    `  ${colors.dim(
      `Analyzed ${report.current.files} files · ${formatNumber(report.current.rules)} rules · ${formatNumber(report.current.declarations)} declarations`,
    )}`,
  );

  if (report.warnings.length > 0) {
    lines.push("");
    for (const warning of report.warnings) {
      lines.push(`  ${colors.yellow("!")} ${colors.dim(warning)}`);
    }
  }

  lines.push("");
  lines.push(rule);
  lines.push("");
  lines.push(`  ${colors.bold("DIMENSION COMPARISON")}`);
  lines.push("");
  lines.push(
    `  ${"Dimension".padEnd(26)}${"Baseline".padStart(8)}  ${"Current".padStart(8)}  ${"Change".padStart(7)}`,
  );
  lines.push("");

  for (const dimension of report.changes.dimensions) {
    lines.push(`  ${formatDimensionRow(dimension, colors)}`);
  }

  lines.push("");
  lines.push(rule);
  lines.push("");
  lines.push(`  ${colors.bold("CSS SIZE ANALYSIS")}`);
  lines.push("");
  lines.push(
    `  ${formatMetricLine(
      "Total size",
      formatBytes(report.changes.cssSize.baseline),
      formatBytes(report.changes.cssSize.current),
      report.changes.cssSize.changePercent,
      colors,
    )}`,
  );
  lines.push(
    `  ${formatMetricLine(
      "Rules",
      formatNumber(report.changes.rules.baseline),
      formatNumber(report.changes.rules.current),
      report.changes.rules.changePercent,
      colors,
    )}`,
  );
  lines.push(
    `  ${formatMetricLine(
      "Declarations",
      formatNumber(report.changes.declarations.baseline),
      formatNumber(report.changes.declarations.current),
      report.changes.declarations.changePercent,
      colors,
    )}`,
  );

  const largest = [...report.files.modified]
    .filter((file) => (file.sizeChangePercent ?? 0) > 0)
    .sort(
      (left, right) =>
        (right.sizeChangePercent ?? 0) - (left.sizeChangePercent ?? 0),
    )
    .slice(0, verbose ? 10 : 3);

  if (largest.length > 0) {
    lines.push("");
    lines.push(`  ${colors.bold("LARGEST INCREASES")}`);
    lines.push("");
    for (const file of largest) {
      lines.push(`  ${file.path}`);
      lines.push(
        `    ${formatBytes(file.baselineSizeBytes ?? 0)} → ${formatBytes(
          file.currentSizeBytes ?? 0,
        )}    ${formatPercent(file.sizeChangePercent, colors)}`,
      );
      lines.push("");
    }
  }

  lines.push(rule);
  lines.push("");
  lines.push(`  ${colors.bold("DIAGNOSTIC CHANGES")}`);
  lines.push("");
  lines.push(
    `  ${colors.red("+")} ${report.diagnostics.new.length} New issues`,
  );
  lines.push(
    `  ${colors.green("-")} ${report.diagnostics.resolved.length} Resolved issues`,
  );
  lines.push(
    `  ${colors.dim("=")} ${report.diagnostics.persistent.length} Persistent issues`,
  );

  const newIssues = report.diagnostics.new.slice(0, verbose ? 20 : 5);
  if (newIssues.length > 0) {
    lines.push("");
    lines.push(`  ${colors.bold("NEW ISSUES")}`);
    lines.push("");
    for (const diagnostic of newIssues) {
      const marker =
        diagnostic.severity === "error" ? colors.red("✖") : colors.yellow("▲");
      lines.push(`  ${marker} ${colors.bold(titleFromCode(diagnostic.code))}`);
      const where = [diagnostic.filePath, diagnostic.selector]
        .filter(Boolean)
        .join(" · ");
      if (where) {
        lines.push(`    ${colors.dim(where)}`);
      }
    }
    if (report.diagnostics.new.length > newIssues.length) {
      lines.push("");
      lines.push(
        `  ${colors.dim(
          `… and ${report.diagnostics.new.length - newIssues.length} more`,
        )}`,
      );
    }
  }

  if (
    report.files.added.length > 0 ||
    report.files.removed.length > 0 ||
    report.files.regressed.length > 0
  ) {
    lines.push("");
    lines.push(rule);
    lines.push("");
    lines.push(`  ${colors.bold("FILE CHANGES")}`);
    lines.push("");
    lines.push(
      `  + ${report.files.added.length} added · - ${report.files.removed.length} removed · ~ ${report.files.modified.length} modified`,
    );
    if (verbose) {
      for (const file of report.files.added.slice(0, 10)) {
        lines.push(`  ${colors.green("+")} ${file.path}`);
      }
      for (const file of report.files.removed.slice(0, 10)) {
        lines.push(`  ${colors.red("-")} ${file.path}`);
      }
      for (const file of report.files.regressed.slice(0, 10)) {
        lines.push(`  ${colors.yellow("~")} ${file.path} (size growth)`);
      }
    }
  }

  if (report.qualityGates && report.qualityGates.results.length > 0) {
    lines.push("");
    lines.push(rule);
    lines.push("");
    lines.push(...formatQualityGates(report.qualityGates, colors));
  }

  lines.push("");
  lines.push(rule);
  lines.push("");
  lines.push(`  ${finalStatusLine(report.status, colors)}`);
  lines.push("");

  return lines.join("\n");
}

function formatQualityGates(gates: GateEvaluation, colors: Palette): string[] {
  const lines = [`  ${colors.bold("QUALITY GATES")}`, ""];
  for (const result of gates.results) {
    const marker = result.passed ? colors.green("✓") : colors.red("✗");
    lines.push(
      `  ${marker} ${result.label.padEnd(26)} ${colors.dim(result.detail)}`,
    );
  }
  lines.push("");
  lines.push(
    `  RESULT: ${
      gates.passed
        ? colors.green(colors.bold("PASSED"))
        : colors.red(colors.bold("FAILED"))
    }`,
  );
  if (!gates.passed && gates.failureSummary) {
    lines.push("");
    lines.push(`  ${gates.failureSummary}`);
  }
  return lines;
}

function formatDimensionRow(
  dimension: DimensionDelta,
  colors: Palette,
): string {
  const labelText = dimensionLabel(dimension.id).padEnd(26);
  const baseline =
    dimension.baseline === null || dimension.baseline === undefined
      ? "n/a".padStart(8)
      : String(dimension.baseline).padStart(8);
  const current =
    dimension.current === null || dimension.current === undefined
      ? "n/a".padStart(8)
      : String(dimension.current).padStart(8);
  const changeText =
    dimension.change === null || dimension.change === undefined
      ? "n/a"
      : dimension.change > 0
        ? `+${dimension.change}`
        : `${dimension.change}`;
  const meaningful =
    dimension.change !== null &&
    dimension.change !== undefined &&
    Math.abs(dimension.change) > 1;
  const changeColored =
    dimension.change === null || dimension.change === undefined
      ? colors.dim(changeText.padStart(7))
      : dimension.change > 0
        ? colors.green(changeText.padStart(7))
        : dimension.change < 0
          ? colors.red(changeText.padStart(7))
          : colors.dim(changeText.padStart(7));
  const row = `${labelText}${baseline}  ${current}  ${changeColored}`;
  return meaningful
    ? row
    : colors.dim(
        `${labelText}${baseline}  ${current}  ${changeText.padStart(7)}`,
      );
}

function formatMetricLine(
  labelText: string,
  baseline: string,
  current: string,
  percent: number | null | undefined,
  colors: Palette,
): string {
  return `${labelText.padEnd(14)}${baseline} → ${current}   ${formatPercent(
    percent,
    colors,
  )}`;
}

function statusBanner(status: RegressionStatus, colors: Palette): string {
  const text = `STATUS: ${status.toUpperCase()}`;
  switch (status) {
    case "healthy":
    case "improved":
      return colors.green(colors.bold(text));
    case "mixed":
    case "inconclusive":
      return colors.yellow(colors.bold(text));
    case "regressed":
      return colors.red(colors.bold(text));
    default:
      return colors.bold(text);
  }
}

function finalStatusLine(status: RegressionStatus, colors: Palette): string {
  switch (status) {
    case "healthy":
      return `${colors.green(colors.bold("HEALTHY"))}  No meaningful CSS regression detected.`;
    case "improved":
      return `${colors.green(colors.bold("IMPROVED"))}  CSS quality improved relative to baseline.`;
    case "mixed":
      return `${colors.yellow(colors.bold("MIXED"))}  Improvements and regressions coexist.`;
    case "inconclusive":
      return `${colors.yellow(colors.bold("INCONCLUSIVE"))}  Insufficient comparable data.`;
    case "regressed":
      return `${colors.red(colors.bold("REGRESSED"))}  CSS quality deteriorated relative to baseline.`;
    default:
      return status;
  }
}

function scoreColor(score: number, colors: Palette): (text: string) => string {
  if (score >= 90) {
    return colors.green;
  }
  if (score >= 70) {
    return colors.yellow;
  }
  return colors.red;
}

function statusWord(status: string, colors: Palette): string {
  const labelText = status.charAt(0).toUpperCase() + status.slice(1);
  if (status === "excellent" || status === "good") {
    return colors.green(labelText);
  }
  if (status === "fair") {
    return colors.yellow(labelText);
  }
  return colors.red(labelText);
}

function formatSigned(value: number, unit: string, colors: Palette): string {
  return `${formatSignedNumber(value, colors)} ${unit}`;
}

function formatSignedNumber(value: number, colors: Palette): string {
  const text = value > 0 ? `+${value}` : `${value}`;
  if (value > 0) {
    return colors.green(text);
  }
  if (value < 0) {
    return colors.red(text);
  }
  return colors.dim(text);
}

function formatPercent(
  value: number | null | undefined,
  colors: Palette,
): string {
  if (value === null || value === undefined) {
    return colors.dim("n/a");
  }
  const text = `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
  if (value > 0) {
    return colors.red(text);
  }
  if (value < 0) {
    return colors.green(text);
  }
  return colors.dim(text);
}

function dimensionLabel(id: string): string {
  switch (id) {
    case "selectorComplexity":
      return "Selector Complexity";
    case "duplicateRules":
      return "Duplicate Rules";
    case "cssSizeEfficiency":
      return "CSS Size Efficiency";
    case "deadCss":
      return "Dead CSS";
    case "variableConsistency":
      return "Variable Consistency";
    default:
      return id;
  }
}

function titleFromCode(code: string): string {
  const leaf = code.split(".").pop() ?? code;
  return leaf
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function detectColumns(): number {
  const columns = process.stdout.columns;
  return typeof columns === "number" && columns > 0 ? columns : 80;
}

function pad(width: number, text: string): string {
  return " ".repeat(Math.max(1, width - text.length));
}

function label(text: string): string {
  return text;
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
