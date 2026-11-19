import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  IncompatibleSchemaError,
  countDiagnostics,
  normalizeSeverity,
  normalizeUnknownReport,
} from "../shared/normalize";
import { GUI_REPORT_SCHEMA_VERSION } from "../shared/report-model";

const fixtureDir = dirname(fileURLToPath(import.meta.url));

test("normalizes a valid check JSON report", async () => {
  const raw = JSON.parse(
    await readFile(
      join(fixtureDir, "fixtures/sample-check-report.json"),
      "utf8",
    ),
  ) as unknown;

  const report = normalizeUnknownReport(raw, {
    source: { kind: "check-json", command: "check", path: "sample.json" },
  });

  assert.equal(report.schemaVersion, GUI_REPORT_SCHEMA_VERSION);
  assert.equal(report.source.command, "check");
  assert.equal(report.summary?.fileCount, 1);
  assert.equal(report.health?.overall, 82);
  assert.equal(report.diagnosticCounts.total, 2);
  assert.equal(report.optimization, null);
  assert.ok(report.cssAnalysis);
  assert.ok(report.diagnostics.some((item) => item.code === "dead.empty-rule"));
  assert.ok(report.diagnostics.some((item) => item.code === "empty-rule"));
});

test("treats missing optional health as null, not zero", () => {
  const report = normalizeUnknownReport(
    {
      schemaVersion: 1,
      command: "check",
      version: "1.1.1",
      generatedAt: "2026-11-13T00:00:00.000Z",
      cwd: "/tmp",
      patterns: ["a.css"],
      threshold: null,
      failUnder: null,
      success: true,
      errors: [],
      files: [],
      summary: {
        files: 0,
        analyzed: 0,
        failed: 0,
        filesWithIssues: 0,
        totalSizeBytes: 0,
        rules: 0,
        selectors: 0,
        declarations: 0,
        warnings: 0,
        hints: 0,
        issues: 0,
        analysisMs: 0,
        totalMs: 0,
      },
      health: null,
    },
    { source: { kind: "check-json", command: "check" } },
  );

  assert.equal(report.health, null);
  assert.equal(report.diagnosticCounts.total, 0);
  assert.deepEqual(countDiagnostics([]), {
    error: 0,
    warning: 0,
    info: 0,
    unknown: 0,
    total: 0,
  });
});

test("rejects incompatible schema versions", () => {
  assert.throws(
    () =>
      normalizeUnknownReport(
        {
          schemaVersion: 99,
          command: "check",
          files: [],
          summary: {},
          health: null,
          errors: [],
        },
        { source: { kind: "check-json", command: "check" } },
      ),
    (error: unknown) => error instanceof IncompatibleSchemaError,
  );
});

test("normalizes severity aliases", () => {
  assert.equal(normalizeSeverity("critical"), "error");
  assert.equal(normalizeSeverity("WARN"), "warning");
  assert.equal(normalizeSeverity("suggestion"), "info");
  assert.equal(normalizeSeverity("weird"), "unknown");
});
