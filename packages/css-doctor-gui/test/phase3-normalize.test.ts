import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeUnknownReport } from "../shared/normalize";

const fixtureDir = dirname(fileURLToPath(import.meta.url));

test("check JSON builds cssAnalysis with selectors and dead candidates", async () => {
  const raw = JSON.parse(
    await readFile(
      join(fixtureDir, "fixtures/sample-check-report.json"),
      "utf8",
    ),
  ) as unknown;

  const report = normalizeUnknownReport(raw, {
    source: { kind: "check-json", command: "check" },
  });

  assert.ok(report.cssAnalysis);
  assert.equal(report.cssAnalysis?.totals.selectors, 2);
  assert.equal(report.cssAnalysis?.selectors.length, 2);
  assert.ok(
    report.cssAnalysis?.kindDistribution.some((item) => item.key === "class"),
  );
  assert.ok(
    report.cssAnalysis?.deadCssCandidates.some(
      (item) => item.status === "candidate",
    ),
  );
  assert.equal(report.cssAnalysis?.usage, null);
  assert.equal(report.cssAnalysis?.atRules, null);
  assert.equal(report.optimization, null);
});

test("optimize JSON fills optimization without inventing analysis", async () => {
  const raw = JSON.parse(
    await readFile(
      join(fixtureDir, "fixtures/sample-optimize-report.json"),
      "utf8",
    ),
  ) as unknown;

  const report = normalizeUnknownReport(raw, {
    source: { kind: "optimize-json", command: "optimize" },
  });

  assert.equal(report.source.command, "optimize");
  assert.ok(report.optimization);
  assert.equal(report.optimization?.summary.inputBytes, 200);
  assert.equal(report.optimization?.summary.emittedBytesTotal, 150);
  assert.equal(report.optimization?.summary.bytesEliminated, 50);
  assert.equal(report.optimization?.operations.minified, true);
  assert.equal(report.optimization?.decisions.length, 1);
  assert.equal(report.optimization?.warnings.length, 1);
  assert.ok(report.splitting);
  assert.ok((report.splitting?.chunkCount ?? 0) >= 1);
  assert.equal(report.cssAnalysis, null);
  assert.equal(report.health, null);
});

test("Phase 2 check reports without selector arrays still normalize", () => {
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
      files: [
        {
          path: "a.css",
          sizeBytes: 10,
          ok: true,
          totalMs: 1,
          readMs: 0,
          analysisMs: 1,
          issues: [],
          result: {
            selectors: [],
            rules: [],
            stats: {
              ruleCount: 0,
              selectorCount: 0,
              declarationCount: 0,
              importantDeclarationCount: 0,
              uniqueClassCount: 0,
              uniqueIdCount: 0,
              uniqueTagCount: 0,
              uniqueAttributeCount: 0,
              maxNestingDepth: 0,
              warningCount: 0,
            },
            warnings: [],
          },
        },
      ],
      summary: {
        files: 1,
        analyzed: 1,
        failed: 0,
        filesWithIssues: 0,
        totalSizeBytes: 10,
        rules: 0,
        selectors: 0,
        declarations: 0,
        warnings: 0,
        hints: 0,
        issues: 0,
        analysisMs: 1,
        totalMs: 1,
      },
      health: null,
    },
    { source: { kind: "check-json", command: "check" } },
  );

  assert.ok(report.cssAnalysis);
  assert.equal(report.cssAnalysis?.totals.selectors, 0);
  assert.deepEqual(report.cssAnalysis?.selectors, []);
});
