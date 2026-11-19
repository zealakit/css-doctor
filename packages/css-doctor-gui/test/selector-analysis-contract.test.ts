import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildClassUsageView } from "../shared/class-usage";
import { normalizeUnknownReport } from "../shared/normalize";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadRawCheck(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(fixtures, "sample-check-report.json"), "utf8"),
  ) as Record<string, unknown>;
}

test("normalize maps selectorAnalysis into cssAnalysis", () => {
  const raw = loadRawCheck();
  raw.selectorAnalysis = {
    schemaVersion: 1,
    completeness: "full",
    metrics: {
      totalSelectors: 2,
      totalDefinitions: 2,
      confirmedUsages: 3,
      distinctUsageFiles: 1,
      confirmedMatchedElements: 3,
      partialMatches: 0,
      unresolvedSelectors: 0,
      unusedSelectors: 1,
    },
    selectors: [
      {
        selector: ".card",
        category: "class",
        definitions: [{ file: "styles.css", count: 1 }],
        status: "used",
        confidence: "confirmed",
        matchedElements: 3,
        usageOccurrences: 3,
        usageFiles: 1,
        partialElements: 0,
        unresolvedElements: 0,
        hasUnprovenRuntimeState: false,
        hasUnprovenPositional: false,
        usageByFile: [{ file: "src/app.tsx", count: 3 }],
        notes: [],
      },
      {
        selector: ".unused",
        category: "class",
        definitions: [{ file: "styles.css", count: 1 }],
        status: "unused",
        confidence: "none",
        matchedElements: 0,
        usageOccurrences: 0,
        usageFiles: 0,
        partialElements: 0,
        unresolvedElements: 0,
        hasUnprovenRuntimeState: false,
        hasUnprovenPositional: false,
        usageByFile: [],
        notes: [],
      },
    ],
    symbols: null,
    scannedFiles: 1,
    elementsScanned: 4,
    notes: [],
  };
  raw.classUsage = {
    byClass: { card: [{ file: "src/app.tsx", count: 3 }] },
    scannedFiles: 1,
    notes: [],
  };

  const report = normalizeUnknownReport(raw, {
    source: { kind: "check-json", command: "check", path: "sample.json" },
  });
  assert.ok(report.cssAnalysis?.selectorAnalysis);
  assert.equal(report.cssAnalysis.selectorAnalysis.completeness, "full");
  assert.equal(report.cssAnalysis.selectorAnalysis.metrics.confirmedUsages, 3);
  assert.equal(report.cssAnalysis.selectorAnalysis.selectors.length, 2);

  const view = buildClassUsageView(report);
  assert.equal(view.overview.totalSelectors, 2);
  assert.equal(view.overview.totalUsages, 3);
  assert.equal(view.overview.deadSelectorCount, 1);
  assert.match(view.overview.note ?? "", /confirmed usages/i);
});

test("legacy classUsage-only becomes legacy-class-only projection", () => {
  const raw = loadRawCheck();
  raw.classUsage = {
    byClass: { card: [{ file: "src/app.tsx", count: 1 }] },
    scannedFiles: 1,
    notes: [],
  };

  const report = normalizeUnknownReport(raw, {
    source: { kind: "check-json", command: "check", path: "sample.json" },
  });
  assert.equal(
    report.cssAnalysis?.selectorAnalysis?.completeness,
    "legacy-class-only",
  );
  assert.equal(report.cssAnalysis?.selectorAnalysis?.selectors.length, 0);
  assert.match(
    report.cssAnalysis?.selectorAnalysis?.notes.join(" ") ?? "",
    /Legacy class-only/i,
  );
});

test("unsupported selectorAnalysis schema fails closed without inventing rows", () => {
  const raw = loadRawCheck();
  raw.selectorAnalysis = {
    schemaVersion: 99,
    completeness: "full",
    selectors: [{ selector: ".fake", status: "used", confidence: "confirmed" }],
  };

  const report = normalizeUnknownReport(raw, {
    source: { kind: "check-json", command: "check", path: "sample.json" },
  });
  assert.equal(report.cssAnalysis?.selectorAnalysis?.completeness, "absent");
  assert.equal(report.cssAnalysis?.selectorAnalysis?.selectors.length, 0);
  assert.match(
    report.cssAnalysis?.selectorAnalysis?.notes.join(" ") ?? "",
    /Unsupported/,
  );
});

test("absent selectorAnalysis and classUsage leaves selectorAnalysis null", () => {
  const raw = loadRawCheck();
  delete raw.classUsage;
  delete raw.selectorAnalysis;
  const report = normalizeUnknownReport(raw, {
    source: { kind: "check-json", command: "check", path: "sample.json" },
  });
  assert.equal(report.cssAnalysis?.selectorAnalysis, null);
});
