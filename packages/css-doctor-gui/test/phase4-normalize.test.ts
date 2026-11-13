import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildExplorerFiles } from "../shared/explorer";
import { normalizeUnknownReport } from "../shared/normalize";

const fixtureDir = dirname(fileURLToPath(import.meta.url));

test("split JSON populates splitting chunks and status", async () => {
  const raw = JSON.parse(
    await readFile(
      join(fixtureDir, "fixtures/sample-split-report.json"),
      "utf8",
    ),
  ) as unknown;

  const report = normalizeUnknownReport(raw, {
    source: { kind: "split-json", command: "split" },
  });

  assert.ok(report.splitting);
  assert.ok(report.optimization);
  assert.ok((report.splitting?.chunkCount ?? 0) >= 1);
  assert.ok(
    report.splitting?.status === "completed" ||
      report.splitting?.status === "completed_with_warnings",
  );
  assert.equal(report.regression, null);
});

test("diff JSON populates regression with Core status", async () => {
  const raw = JSON.parse(
    await readFile(
      join(fixtureDir, "fixtures/sample-diff-report.json"),
      "utf8",
    ),
  ) as unknown;

  const report = normalizeUnknownReport(raw, {
    source: { kind: "diff-json", command: "diff" },
  });

  assert.ok(report.regression);
  assert.equal(report.regression?.comparisonStatus, "completed");
  assert.ok(report.regression?.status);
  assert.ok(report.regression?.baseline);
  assert.ok(report.regression?.current);
  assert.ok(report.regression?.changes);
  assert.ok(report.regression?.diagnostics);
  assert.equal(report.splitting, null);
});

test("diff without regression payload marks baseline/comparison failure", () => {
  const report = normalizeUnknownReport(
    {
      schemaVersion: 1,
      command: "diff",
      success: false,
      errors: ["Baseline file not found: .css-doctor/baseline.json"],
      warnings: [],
      baselinePath: ".css-doctor/baseline.json",
      regression: null,
    },
    { source: { kind: "diff-json", command: "diff" } },
  );

  assert.equal(report.regression?.comparisonStatus, "baseline_missing");
  assert.equal(report.regression?.status, null);
});

test("diff with incompatible baseline does not look like no-regression", () => {
  const report = normalizeUnknownReport(
    {
      schemaVersion: 1,
      command: "diff",
      success: false,
      errors: ["Baseline is incompatible with this tool version."],
      warnings: [],
      baselinePath: ".css-doctor/baseline.json",
      regression: null,
    },
    { source: { kind: "diff-json", command: "diff" } },
  );

  assert.equal(report.regression?.comparisonStatus, "baseline_incompatible");
  assert.equal(report.regression?.status, null);
});

test("healthy Core status preserves zero deltas (no changes)", async () => {
  const raw = JSON.parse(
    await readFile(
      join(fixtureDir, "fixtures/sample-diff-report.json"),
      "utf8",
    ),
  ) as unknown;

  const report = normalizeUnknownReport(raw, {
    source: { kind: "diff-json", command: "diff" },
  });

  assert.equal(report.regression?.status, "healthy");
  assert.equal(report.regression?.scoreChange, 0);
  assert.equal(report.regression?.changes?.cssSize.changeBytes, 0);
});

test("split chunks retain Core names, sizes, and classifications", async () => {
  const raw = JSON.parse(
    await readFile(
      join(fixtureDir, "fixtures/sample-split-report.json"),
      "utf8",
    ),
  ) as unknown;

  const report = normalizeUnknownReport(raw, {
    source: { kind: "split-json", command: "split" },
  });
  const chunk = report.splitting?.chunks[0];
  assert.ok(chunk);
  assert.equal(chunk?.name, "common");
  assert.equal(chunk?.classification, "common");
  assert.equal(chunk?.sizeBytes, 123);
  assert.equal(chunk?.oversized, false);
  assert.ok((report.splitting?.warnings.length ?? 0) >= 1);
  assert.equal(report.splitting?.status, "completed_with_warnings");

  const files = buildExplorerFiles(report);
  assert.ok(files.some((file) => file.hasSplitting && file.hasOptimization));
  assert.ok(files.some((file) => file.chunkNames.includes("common")));
});

test("explorer merges analysis, split, and diagnostic file paths", async () => {
  const check = normalizeUnknownReport(
    JSON.parse(
      await readFile(
        join(fixtureDir, "fixtures/sample-check-report.json"),
        "utf8",
      ),
    ),
    { source: { kind: "check-json", command: "check" } },
  );
  const files = buildExplorerFiles(check);
  assert.ok(files.some((file) => file.path === "src/app.css"));
  assert.ok(files.some((file) => file.hasAnalysis));
});
