import { resolve } from "node:path";

import { buildSelectorAnalysisReport } from "@zealakit/css-doctor-shared";

import { runCheck, type CheckReport } from "../commands/check";
import { terminalExitCode } from "../formatters/terminal";
import { collectProjectClassUsage } from "./collect-class-usage";
import {
  DEFAULT_REPORTS_DIR,
  defaultLatestReportPath,
  persistCliReport,
} from "./report-io";
import {
  missingPatternsGuidance,
  resolveCheckPatterns,
} from "./resolve-check-patterns";

/** Stable path for the report produced by the current `css-doctor gui` startup. */
export const GUI_STARTUP_REPORT_NAME = "check-gui-startup.json";

export type GuiStartupAnalysisOptions = {
  /** Explicit CSS globs; otherwise project config / baseline patterns. */
  patterns?: string[];
  cwd?: string;
  /** Optional threshold override (else project config). */
  threshold?: number;
  failUnder?: number;
};

export type GuiStartupAnalysisResult = {
  report: CheckReport;
  /** Absolute path to the atomic startup envelope for this run. */
  reportPath: string;
  /** Absolute path to `check-latest.json` when `--save` semantics wrote it. */
  latestPath: string | null;
  exitCode: 0 | 1;
  patternSource: "cli" | "config" | "baseline" | "default" | "none";
};

/**
 * Runs the existing `runCheck` pipeline once for `css-doctor gui` startup.
 *
 * Always writes `check-gui-startup.json` (success or failure) so the GUI can
 * load this run's result without reading a partial file. Updates
 * `check-latest.json` only when `report.success` is true (same as CLI `--save`).
 */
export async function runGuiStartupAnalysis(
  options: GuiStartupAnalysisOptions = {},
): Promise<GuiStartupAnalysisResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const resolved = await resolveCheckPatterns(options.patterns ?? [], {
    cwd,
    discover: true,
  });
  const threshold =
    options.threshold !== undefined
      ? options.threshold
      : (resolved.loaded.config.threshold ?? undefined);

  const report = await runCheck(resolved.patterns, {
    cwd,
    threshold,
    failUnder: options.failUnder,
  });

  let annotated =
    resolved.source === "none" ? withMissingPatternsGuidance(report) : report;

  // Attach symbol bags + canonical selectorAnalysis for the GUI.
  // Plain `css-doctor check` stays unchanged (no classUsage / selectorAnalysis).
  if (annotated.success || annotated.files.length > 0) {
    const selectors = collectSelectorsFromReport(annotated);
    const classUsage = await collectProjectClassUsage(cwd, {
      selectors: selectors.map((item) => item.selector),
    });
    const selectorAnalysis = buildSelectorAnalysisReport({
      definitions: selectors,
      matches: classUsage.selectorMatches,
      symbols: {
        byClass: classUsage.byClass,
        byId: classUsage.byId,
        byTag: classUsage.byTag,
        byAttribute: classUsage.byAttribute,
        unresolvedByClass: classUsage.unresolvedByClass,
        unresolvedById: classUsage.unresolvedById,
        unresolvedByAttribute: classUsage.unresolvedByAttribute,
      },
      scannedFiles: classUsage.scannedFiles,
      elementsScanned: classUsage.elementsScanned,
      notes: classUsage.notes,
    });
    annotated = { ...annotated, classUsage, selectorAnalysis };
  }

  const reportPath = resolve(cwd, DEFAULT_REPORTS_DIR, GUI_STARTUP_REPORT_NAME);
  const persisted = await persistCliReport(annotated, {
    cwd,
    out: reportPath,
    save: true,
  });
  if (!persisted.ok) {
    throw new Error(persisted.error);
  }

  return {
    report: annotated,
    reportPath,
    latestPath: annotated.success
      ? defaultLatestReportPath("check", cwd)
      : null,
    exitCode: terminalExitCode(annotated),
    patternSource: resolved.source,
  };
}

function withMissingPatternsGuidance(report: CheckReport): CheckReport {
  return {
    ...report,
    errors: [missingPatternsGuidance()],
  };
}

function collectSelectorsFromReport(report: CheckReport): Array<{
  selector: string;
  file: string;
  kinds: string[];
  line?: number;
  column?: number;
}> {
  const selectors: Array<{
    selector: string;
    file: string;
    kinds: string[];
    line?: number;
    column?: number;
  }> = [];

  for (const file of report.files) {
    const result = file.result;
    if (!result || !Array.isArray(result.selectors)) {
      continue;
    }
    const rules = Array.isArray(result.rules) ? result.rules : [];
    for (const selector of result.selectors) {
      if (
        !selector ||
        typeof selector.raw !== "string" ||
        !selector.raw.trim()
      ) {
        continue;
      }
      const rule =
        typeof selector.ruleIndex === "number"
          ? rules[selector.ruleIndex]
          : undefined;
      const location =
        rule && typeof rule === "object" && rule !== null && "location" in rule
          ? (rule as { location?: { line?: number; column?: number } }).location
          : undefined;
      selectors.push({
        selector: selector.raw,
        file: file.path,
        kinds: Array.isArray(selector.kinds) ? selector.kinds.map(String) : [],
        line: typeof location?.line === "number" ? location.line : undefined,
        column:
          typeof location?.column === "number" ? location.column : undefined,
      });
    }
  }
  return selectors;
}
