import picocolors from "picocolors";

import type { JsHealthReport } from "@zealakit/css-doctor-binding";

type Palette = ReturnType<typeof picocolors.createColors>;

export type HealthTerminalOptions = {
  color?: boolean;
  columns?: number;
  topIssues?: number;
};

const DEFAULT_TOP_ISSUES = 8;
const BAR_WIDTH = 36;

/** Formats a polished CSS Health Score report for the terminal. */
export function formatHealthTerminalReport(
  report: JsHealthReport,
  options: HealthTerminalOptions = {},
): string {
  const colors = picocolors.createColors(
    options.color ?? picocolors.isColorSupported,
  );
  const columns = Math.max(
    48,
    Math.min(options.columns ?? detectColumns(), 88),
  );
  const topIssues = options.topIssues ?? DEFAULT_TOP_ISSUES;
  const lines: string[] = [];
  const rule = colors.dim("─".repeat(Math.min(columns, 64)));

  lines.push("");
  lines.push(
    `  ${colors.bold(colors.cyan("CSS DOCTOR"))}${pad(
      columns - 22,
      "",
    )}${colors.dim("HEALTH REPORT")}`,
  );
  lines.push("");
  lines.push(`  ${colors.bold("Overall Health")}`);
  lines.push("");
  lines.push(
    `       ${scoreColor(report.overall, colors)(colors.bold(`${report.overall}/100`))}   ${colors.bold(report.grade)}  ${statusLabel(report.status, colors)}`,
  );
  lines.push("");
  lines.push(`  ${scoreBar(report.overall, colors)}`);
  lines.push("");
  lines.push(
    `  ${colors.dim(
      `Analyzed ${report.summary.files} file${report.summary.files === 1 ? "" : "s"} · ${formatNumber(report.summary.rules)} rules · ${formatNumber(report.summary.declarations)} declarations`,
    )}`,
  );
  lines.push(
    `  ${colors.dim(
      `Total size ${formatBytes(report.summary.sizeBytes)} · Analysis completed in ${formatDuration(report.summary.analysisMs)}`,
    )}`,
  );
  lines.push("");
  lines.push(rule);
  lines.push("");
  lines.push(`  ${colors.bold("HEALTH BREAKDOWN")}`);
  lines.push("");

  for (const dimension of report.dimensions) {
    const label = dimensionLabel(dimension.id).padEnd(24);
    const scoreText =
      dimension.score === undefined || dimension.score === null
        ? "  n/a"
        : `${String(dimension.score).padStart(3, " ")}/100`;
    const bar =
      dimension.score === undefined || dimension.score === null
        ? colors.dim("░".repeat(20))
        : miniBar(dimension.score, colors);
    lines.push(`  ${label}${scoreText}  ${bar}`);
  }

  lines.push("");
  lines.push(rule);
  lines.push("");
  lines.push(`  ${colors.bold("DIAGNOSTICS")}`);
  lines.push("");
  lines.push(
    `  ${colors.red("✖")}  ${report.summary.errors} Error${report.summary.errors === 1 ? "" : "s"}`,
  );
  lines.push(
    `  ${colors.yellow("▲")}  ${report.summary.warnings} Warning${report.summary.warnings === 1 ? "" : "s"}`,
  );
  lines.push(
    `  ${colors.cyan("●")}  ${report.summary.suggestions} Suggestion${report.summary.suggestions === 1 ? "" : "s"}`,
  );

  if (report.diagnostics.length > 0) {
    lines.push("");
    lines.push(`  ${colors.bold("TOP ISSUES")}`);
    lines.push("");

    const shown = report.diagnostics.slice(0, topIssues);
    for (const diagnostic of shown) {
      const marker =
        diagnostic.severity === "error"
          ? colors.red("✖")
          : diagnostic.severity === "warning"
            ? colors.yellow("▲")
            : colors.cyan("●");
      lines.push(`  ${marker}  ${colors.bold(titleFromCode(diagnostic.code))}`);
      const where = [
        diagnostic.filePath,
        diagnostic.location
          ? `${diagnostic.location.line}:${diagnostic.location.column}`
          : undefined,
      ]
        .filter(Boolean)
        .join(":");
      if (where) {
        lines.push(`     ${colors.dim(where)}`);
      }
      if (diagnostic.selector) {
        lines.push(`     ${colors.magenta(diagnostic.selector)}`);
      }
      lines.push(`     ${colors.dim(diagnostic.remediation)}`);
      lines.push("");
    }

    if (report.diagnostics.length > shown.length) {
      lines.push(
        `  ${colors.dim(
          `… and ${report.diagnostics.length - shown.length} more (see --json for full list)`,
        )}`,
      );
      lines.push("");
    }
  }

  if (report.recommendations.length > 0) {
    lines.push(`  ${colors.bold("RECOMMENDATIONS")}`);
    lines.push("");
    report.recommendations.forEach((recommendation, index) => {
      lines.push(`  ${index + 1}. ${recommendation}`);
    });
    lines.push("");
  }

  lines.push(rule);
  lines.push("");
  lines.push(`  ${finalStatusLine(report, colors)}`);
  lines.push("");
  lines.push(
    `  ${colors.dim("Run `css-doctor health --help` for more options.")}`,
  );
  lines.push("");

  return lines.join("\n");
}

/** Compact one-block health summary for `css-doctor check`. */
export function formatCompactHealthSummary(
  report: JsHealthReport,
  options: { color?: boolean } = {},
): string {
  const colors = picocolors.createColors(
    options.color ?? picocolors.isColorSupported,
  );
  return (
    `${colors.bold("Health")} ${scoreColor(
      report.overall,
      colors,
    )(
      `${report.overall}/100`,
    )} ${colors.bold(report.grade)} ${colors.dim(`(${report.status})`)} ` +
    `${colors.dim("·")} ${report.summary.errors} err ` +
    `${colors.dim("·")} ${report.summary.warnings} warn ` +
    `${colors.dim("·")} ${report.summary.suggestions} info`
  );
}

function finalStatusLine(report: JsHealthReport, colors: Palette): string {
  if (report.overall >= 90) {
    return `${colors.green(colors.bold("HEALTHY"))}  CSS quality is within recommended limits.`;
  }
  if (report.overall >= 70) {
    return `${colors.yellow(colors.bold("NEEDS ATTENTION"))}  Address the top warnings before release.`;
  }
  return `${colors.red(colors.bold("CRITICAL"))}  CSS quality is below recommended limits.`;
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

function statusLabel(status: string, colors: Palette): string {
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  if (status === "excellent" || status === "good") {
    return colors.green(label);
  }
  if (status === "fair") {
    return colors.yellow(label);
  }
  return colors.red(label);
}

function scoreBar(score: number, colors: Palette): string {
  const filled = Math.round((score / 100) * BAR_WIDTH);
  const empty = Math.max(0, BAR_WIDTH - filled);
  return `${scoreColor(score, colors)("█".repeat(filled))}${colors.dim("░".repeat(empty))}`;
}

function miniBar(score: number, colors: Palette): string {
  const width = 20;
  const filled = Math.round((score / 100) * width);
  return `${scoreColor(score, colors)("█".repeat(filled))}${colors.dim("░".repeat(width - filled))}`;
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
