import assert from "node:assert/strict";
import test from "node:test";

import {
  SELECTOR_ANALYSIS_SCHEMA_VERSION,
  aggregateSelectorMetrics,
  buildSelectorAnalysisReport,
  legacyClassOnlyAnalysis,
  parseSelectorAnalysis,
  type SelectorAnalysisRecord,
} from "../src/index";

function sampleRecord(
  overrides: Partial<SelectorAnalysisRecord> & { selector: string },
): SelectorAnalysisRecord {
  return {
    category: "class",
    definitions: [{ file: "styles.css", count: 1 }],
    status: "used",
    confidence: "confirmed",
    matchedElements: 1,
    usageOccurrences: 1,
    usageFiles: 1,
    partialElements: 0,
    unresolvedElements: 0,
    hasUnprovenRuntimeState: false,
    hasUnprovenPositional: false,
    usageByFile: [{ file: "src/app.tsx", count: 1 }],
    notes: [],
    ...overrides,
  };
}

test("aggregateSelectorMetrics counts confirmed only and reconciles files", () => {
  const metrics = aggregateSelectorMetrics([
    sampleRecord({ selector: ".card" }),
    sampleRecord({
      selector: ".hero:hover",
      status: "partial",
      confidence: "partial",
      matchedElements: 0,
      usageOccurrences: 0,
      usageFiles: 0,
      partialElements: 2,
      usageByFile: [],
    }),
    sampleRecord({
      selector: "#missing",
      status: "unused",
      confidence: "none",
      matchedElements: 0,
      usageOccurrences: 0,
      usageFiles: 0,
      usageByFile: [],
    }),
    sampleRecord({
      selector: "button",
      status: "unknown",
      confidence: "unresolved",
      matchedElements: 0,
      usageOccurrences: 0,
      usageFiles: 0,
      unresolvedElements: 1,
      usageByFile: [],
    }),
  ]);

  assert.equal(metrics.totalSelectors, 4);
  assert.equal(metrics.totalDefinitions, 4);
  assert.equal(metrics.confirmedUsages, 1);
  assert.equal(metrics.confirmedMatchedElements, 1);
  assert.equal(metrics.partialMatches, 1);
  assert.equal(metrics.unresolvedSelectors, 1);
  assert.equal(metrics.unusedSelectors, 1);
  assert.equal(metrics.distinctUsageFiles, 1);
});

test("aggregateSelectorMetrics leaves distinctUsageFiles null without paths", () => {
  const metrics = aggregateSelectorMetrics([
    sampleRecord({
      selector: ".card",
      usageByFile: [],
      usageFiles: 2,
    }),
  ]);
  assert.equal(metrics.distinctUsageFiles, null);
});

test("buildSelectorAnalysisReport keeps definitions and matches independent", () => {
  const report = buildSelectorAnalysisReport({
    definitions: [
      { selector: ".card", file: "a.css", kinds: ["class"] },
      { selector: ".card", file: "a.css", kinds: ["class"] },
      { selector: "#app", file: "a.css", kinds: ["id"] },
      { selector: "div > button", file: "a.css", kinds: ["tag"] },
      { selector: "[data-state]", file: "a.css", kinds: ["attribute"] },
      { selector: "*", file: "a.css", kinds: ["universal"] },
    ],
    matches: [
      {
        selector: ".card",
        confidence: "confirmed",
        status: "used",
        matchedElements: 2,
        usageOccurrences: 2,
        usageFiles: 1,
      },
      {
        selector: "#app",
        confidence: "none",
        status: "unused",
        matchedElements: 0,
      },
      {
        selector: "div > button",
        confidence: "partial",
        status: "partial",
        matchedElements: 0,
        partialElements: 1,
      },
    ],
    symbols: {
      byClass: { card: [{ file: "src/x.tsx", count: 2 }] },
    },
    scannedFiles: 3,
    elementsScanned: 10,
  });

  assert.equal(report.schemaVersion, SELECTOR_ANALYSIS_SCHEMA_VERSION);
  assert.equal(report.completeness, "full");
  assert.equal(report.metrics.totalSelectors, 5);
  assert.equal(report.metrics.totalDefinitions, 6);
  assert.equal(report.metrics.confirmedUsages, 2);
  assert.equal(report.metrics.partialMatches, 1);
  assert.equal(report.metrics.unusedSelectors, 1);
  // Two selectors without match rows → unknown (not unused).
  assert.equal(report.metrics.unresolvedSelectors, 2);

  const card = report.selectors.find((row) => row.selector === ".card");
  assert.ok(card);
  assert.equal(card.definitions[0]?.count, 2);
  assert.equal(card.usageOccurrences, 2);

  const combinator = report.selectors.find(
    (row) => row.selector === "div > button",
  );
  assert.equal(combinator?.category, "combinator");
  assert.equal(combinator?.status, "partial");

  const star = report.selectors.find((row) => row.selector === "*");
  assert.equal(star?.status, "unknown");
  assert.equal(star?.confidence, "none");
});

test("parseSelectorAnalysis accepts schema v1 and rejects future versions", () => {
  const built = buildSelectorAnalysisReport({
    definitions: [{ selector: ".a", file: "a.css", kinds: ["class"] }],
    matches: [
      {
        selector: ".a",
        confidence: "confirmed",
        status: "used",
        matchedElements: 1,
      },
    ],
  });
  const ok = parseSelectorAnalysis(built);
  assert.equal(ok.ok, true);

  const absent = parseSelectorAnalysis(undefined);
  assert.equal(absent.ok, false);
  if (!absent.ok) {
    assert.equal(absent.code, "absent");
  }

  const future = parseSelectorAnalysis({
    ...built,
    schemaVersion: 99,
  });
  assert.equal(future.ok, false);
  if (!future.ok) {
    assert.equal(future.code, "unsupported_schema");
    assert.match(future.message, /99/);
  }

  const invalid = parseSelectorAnalysis({ schemaVersion: "1" });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.code, "invalid");
  }
});

test("legacyClassOnlyAnalysis is never completeness full", () => {
  const report = legacyClassOnlyAnalysis({
    byClass: { card: [{ file: "src/a.tsx", count: 1 }] },
    scannedFiles: 1,
  });
  assert.equal(report.completeness, "legacy-class-only");
  assert.equal(report.selectors.length, 0);
  assert.equal(report.metrics.confirmedUsages, 0);
  assert.ok(report.notes.some((note) => /Legacy class-only/i.test(note)));
});

test("missing metrics field is rebuilt; empty selectors stay empty", () => {
  const parsed = parseSelectorAnalysis({
    schemaVersion: 1,
    completeness: "full",
    selectors: [],
    symbols: null,
    scannedFiles: 0,
    elementsScanned: 0,
    notes: [],
  });
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.report.metrics.totalSelectors, 0);
    assert.equal(parsed.report.selectors.length, 0);
    assert.equal(parsed.report.symbols, null);
  }
});
