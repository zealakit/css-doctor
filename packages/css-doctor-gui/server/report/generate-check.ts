import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import fg from "fast-glob";

import { normalizeCheckReport } from "../../shared/normalize";
import type { GuiReportLoadResult } from "../../shared/report-model";

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
      "Unable to load @zealakit/css-doctor-binding. Build it with " +
        "`pnpm --filter @zealakit/css-doctor-binding build`.\n" +
        (error instanceof Error ? error.message : String(error)),
    );
  }
}

export type GenerateCheckOptions = {
  patterns: string[];
  cwd?: string;
  threshold?: number;
};

/**
 * Runs a check-like analysis via the NAPI binding and normalizes to GuiReport.
 * Mirrors CLI `runCheck` outputs without depending on the CLI package (avoids
 * a workspace cycle: cli → gui).
 */
export async function generateCheckReport(
  options: GenerateCheckOptions,
): Promise<GuiReportLoadResult> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const patterns = options.patterns
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  const threshold = options.threshold ?? null;

  if (patterns.length === 0) {
    return {
      ok: false,
      code: "validation_error",
      message:
        'Provide at least one CSS glob/pattern (example: "src/**/*.css").',
    };
  }

  try {
    const cwdStat = await stat(cwd);
    if (!cwdStat.isDirectory()) {
      return {
        ok: false,
        code: "validation_error",
        message: `Working directory is not a directory: ${cwd}`,
      };
    }
  } catch {
    return {
      ok: false,
      code: "not_found",
      message: `Working directory does not exist: ${cwd}`,
    };
  }

  const startedAt = performance.now();
  let files: string[];
  try {
    files = await resolveCssFiles(patterns, cwd);
  } catch (error) {
    return {
      ok: false,
      code: "analysis_failure",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (files.length === 0) {
    return {
      ok: false,
      code: "not_found",
      message: `No CSS files matched: ${patterns.join(", ")}`,
    };
  }

  try {
    const binding = loadBinding();
    const fileResults = [];
    const healthFiles = [];

    for (const absolutePath of files) {
      const displayPath = toDisplayPath(absolutePath, cwd);
      const readStarted = performance.now();
      let content: string;
      let sizeBytes = 0;
      try {
        const [text, fileStat] = await Promise.all([
          readFile(absolutePath, "utf8"),
          stat(absolutePath),
        ]);
        content = text;
        sizeBytes = fileStat.size;
      } catch (error) {
        fileResults.push({
          path: displayPath,
          absolutePath,
          sizeBytes: 0,
          ok: false,
          totalMs: roundMs(performance.now() - readStarted),
          readMs: roundMs(performance.now() - readStarted),
          analysisMs: 0,
          issues: [],
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const readMs = roundMs(performance.now() - readStarted);
      const analysisStarted = performance.now();
      try {
        const result = binding.analyzeCss(content);
        const analysisMs = roundMs(performance.now() - analysisStarted);
        const issues = collectCheckIssues(result, threshold);
        fileResults.push({
          path: displayPath,
          absolutePath,
          sizeBytes,
          ok: true,
          totalMs: roundMs(readMs + analysisMs),
          readMs,
          analysisMs,
          issues,
          result,
        });
        healthFiles.push({
          cssContent: content,
          filePath: displayPath,
          sizeBytes,
        });
      } catch (error) {
        fileResults.push({
          path: displayPath,
          absolutePath,
          sizeBytes,
          ok: false,
          totalMs: roundMs(performance.now() - readStarted),
          readMs,
          analysisMs: roundMs(performance.now() - analysisStarted),
          issues: [],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const health =
      healthFiles.length > 0
        ? binding.evaluateCssHealthBatch({
            files: healthFiles,
            thresholds:
              threshold === null ? undefined : { manySelectors: threshold },
          })
        : null;

    const analyzed = fileResults.filter((file) => file.ok).length;
    const failed = fileResults.length - analyzed;
    const issues = fileResults.flatMap((file) => file.issues);
    const warnings = issues.filter((issue) => issue.kind === "syntax").length;

    const checkReport = {
      schemaVersion: 1 as const,
      command: "check" as const,
      version: "1.1.1",
      generatedAt: new Date().toISOString(),
      cwd,
      patterns,
      threshold,
      failUnder: null,
      success: failed === 0,
      errors: [],
      files: fileResults,
      summary: {
        files: fileResults.length,
        analyzed,
        failed,
        filesWithIssues: fileResults.filter((file) => file.issues.length > 0)
          .length,
        totalSizeBytes: fileResults.reduce(
          (total, file) => total + file.sizeBytes,
          0,
        ),
        rules: fileResults.reduce(
          (total, file) => total + (file.result?.stats.ruleCount ?? 0),
          0,
        ),
        selectors: fileResults.reduce(
          (total, file) => total + (file.result?.stats.selectorCount ?? 0),
          0,
        ),
        declarations: fileResults.reduce(
          (total, file) =>
            total +
            (file.result?.stats.declarationCount ?? 0) +
            (file.result?.stats.importantDeclarationCount ?? 0),
          0,
        ),
        warnings,
        hints: issues.length - warnings,
        issues: issues.length,
        analysisMs: roundMs(
          fileResults.reduce((total, file) => total + file.analysisMs, 0),
        ),
        totalMs: roundMs(performance.now() - startedAt),
      },
      health,
    };

    const report = normalizeCheckReport(checkReport, {
      source: {
        kind: "generated-check",
        command: "check",
        toolVersion: checkReport.version,
      },
    });

    return { ok: true, report };
  } catch (error) {
    return {
      ok: false,
      code: "analysis_failure",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function resolveCssFiles(
  patterns: string[],
  cwd: string,
): Promise<string[]> {
  const matches = await fg(patterns, {
    cwd,
    absolute: true,
    onlyFiles: true,
    unique: true,
    caseSensitiveMatch: false,
    ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.next/**"],
  });
  return matches
    .filter((file) => file.toLowerCase().endsWith(".css"))
    .sort((left, right) => left.localeCompare(right));
}

function toDisplayPath(absolutePath: string, cwd: string): string {
  const relativePath = relative(cwd, absolutePath);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    return absolutePath.split(sep).join("/");
  }
  return relativePath.split(sep).join("/");
}

type AnalysisResult = ReturnType<BindingModule["analyzeCss"]>;

function collectCheckIssues(
  result: AnalysisResult,
  threshold: number | null,
): Array<{
  kind: string;
  severity: "warning";
  message: string;
  location?: { line: number; column: number };
  selector?: string;
}> {
  const issues: Array<{
    kind: string;
    severity: "warning";
    message: string;
    location?: { line: number; column: number };
    selector?: string;
  }> = [];

  for (const warning of result.warnings) {
    issues.push({
      kind: "syntax",
      severity: "warning",
      message: warning.message,
      ...(warning.location ? { location: warning.location } : {}),
    });
  }

  const parentRuleIndices = new Set(
    result.rules
      .map((rule) => rule.parentRuleIndex)
      .filter((index): index is number => index !== undefined),
  );

  for (const rule of result.rules) {
    const hasNoDeclarations =
      rule.declarationCount === 0 && rule.importantDeclarationCount === 0;
    const hasNoNestedRules = !parentRuleIndices.has(rule.index);
    if (!(hasNoDeclarations && hasNoNestedRules)) {
      continue;
    }
    const selectorText = rule.selectorIndices
      .map((index) => result.selectors[index]?.raw)
      .filter((value): value is string => value !== undefined)
      .join(", ");
    issues.push({
      kind: "empty-rule",
      severity: "warning",
      message:
        selectorText.length > 0
          ? `Rule "${selectorText}" has no declarations and no nested rules (dead code candidate).`
          : "Rule has no declarations and no nested rules (dead code candidate).",
      location: rule.location,
      ...(selectorText.length > 0 ? { selector: selectorText } : {}),
    });
  }

  const seenSelectors = new Map<string, AnalysisResult["selectors"][number]>();
  for (const selector of result.selectors) {
    const first = seenSelectors.get(selector.raw);
    if (!first) {
      seenSelectors.set(selector.raw, selector);
      continue;
    }
    const firstRule = result.rules[first.ruleIndex];
    const currentRule = result.rules[selector.ruleIndex];
    issues.push({
      kind: "duplicate-selector",
      severity: "warning",
      message:
        `Selector "${selector.raw}" is defined in multiple rules` +
        (firstRule ? ` (first at line ${firstRule.location.line})` : "") +
        "; verify whether this is intentional.",
      ...(currentRule ? { location: currentRule.location } : {}),
      selector: selector.raw,
    });
  }

  if (threshold !== null && result.selectors.length > threshold) {
    issues.push({
      kind: "threshold",
      severity: "warning",
      message:
        `Selector threshold exceeded: ${result.selectors.length} selectors found ` +
        `(threshold: ${threshold}).`,
    });
  }

  return issues;
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}
