import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeUnknownReport } from "../shared/normalize";
import type { GuiReport } from "../shared/report-model";
import {
  buildSelectorExplorerView,
  filterSelectorExplorerRows,
  type SelectorExplorerRow,
} from "../shared/selector-explorer";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadCheckReport(): GuiReport {
  const raw = JSON.parse(
    readFileSync(join(fixtures, "sample-check-report.json"), "utf8"),
  ) as unknown;
  return normalizeUnknownReport(raw, {
    source: { kind: "check-json", command: "check", path: "sample.json" },
  });
}

function attachFullAnalysis(report: GuiReport): GuiReport {
  assert.ok(report.cssAnalysis);
  report.cssAnalysis.selectorAnalysis = {
    schemaVersion: 1,
    completeness: "full",
    metrics: {
      totalSelectors: 6,
      totalDefinitions: 7,
      confirmedUsages: 5,
      distinctUsageFiles: 2,
      confirmedMatchedElements: 5,
      partialMatches: 1,
      unresolvedSelectors: 1,
      unusedSelectors: 1,
    },
    selectors: [
      {
        selector: ".card",
        category: "class",
        status: "used",
        confidence: "confirmed",
        matchedElements: 3,
        usageOccurrences: 3,
        usageFiles: 2,
        partialElements: 0,
        unresolvedElements: 0,
        hasUnprovenRuntimeState: false,
        hasUnprovenPositional: false,
        definitions: [
          { file: "src/styles/card.css", count: 1, line: 2, column: 1 },
          { file: "src/styles/components.css", count: 1 },
        ],
        usageByFile: [
          { file: "src/components/Card.tsx", count: 2 },
          { file: "src/pages/Home.tsx", count: 1 },
        ],
        notes: [],
      },
      {
        selector: "#app",
        category: "id",
        status: "used",
        confidence: "confirmed",
        matchedElements: 1,
        usageOccurrences: 1,
        usageFiles: 1,
        partialElements: 0,
        unresolvedElements: 0,
        hasUnprovenRuntimeState: false,
        hasUnprovenPositional: false,
        definitions: [{ file: "src/styles/layout.css", count: 1 }],
        usageByFile: [{ file: "src/app.tsx", count: 1 }],
        notes: [],
      },
      {
        selector: "button",
        category: "element",
        status: "used",
        confidence: "confirmed",
        matchedElements: 1,
        usageOccurrences: 1,
        usageFiles: 1,
        partialElements: 0,
        unresolvedElements: 0,
        hasUnprovenRuntimeState: false,
        hasUnprovenPositional: false,
        definitions: [{ file: "src/styles/reset.css", count: 1 }],
        usageByFile: [{ file: "src/components/Button.tsx", count: 1 }],
        notes: [],
      },
      {
        selector: "[data-state]",
        category: "attribute",
        status: "unused",
        confidence: "none",
        matchedElements: 0,
        usageOccurrences: 0,
        usageFiles: 0,
        partialElements: 0,
        unresolvedElements: 0,
        hasUnprovenRuntimeState: false,
        hasUnprovenPositional: false,
        definitions: [{ file: "src/styles/state.css", count: 1 }],
        usageByFile: [],
        notes: [],
      },
      {
        selector: "div > .card",
        category: "combinator",
        status: "partial",
        confidence: "partial",
        matchedElements: 0,
        usageOccurrences: 0,
        usageFiles: 0,
        partialElements: 2,
        unresolvedElements: 0,
        hasUnprovenRuntimeState: false,
        hasUnprovenPositional: false,
        definitions: [{ file: "src/styles/card.css", count: 1 }],
        usageByFile: [],
        notes: ["Parent combinator only partially matched."],
      },
      {
        selector: ".hero:hover",
        category: "pseudo",
        status: "unknown",
        confidence: "unresolved",
        matchedElements: 0,
        usageOccurrences: 0,
        usageFiles: 0,
        partialElements: 0,
        unresolvedElements: 1,
        hasUnprovenRuntimeState: true,
        hasUnprovenPositional: false,
        definitions: [{ file: "src/styles/hero.css", count: 1 }],
        usageByFile: [],
        notes: ["Runtime pseudo-state is not observed statically."],
      },
    ],
    notes: [],
  };
  return report;
}

test("uses canonical metrics without recalculating in the explorer", () => {
  const view = buildSelectorExplorerView(attachFullAnalysis(loadCheckReport()));
  assert.equal(view.overview.completeness, "full");
  assert.equal(view.overview.totalSelectors, 6);
  assert.equal(view.overview.totalDefinitions, 7);
  assert.equal(view.overview.confirmedUsages, 5);
  assert.equal(view.overview.distinctUsageFiles, 2);
  assert.equal(view.overview.unusedSelectors, 1);
  assert.equal(view.overview.partialOrUnresolved, 2);
  assert.equal(view.rows.length, 6);
});

test("keeps Created In and Used In independent with per-file counts", () => {
  const view = buildSelectorExplorerView(attachFullAnalysis(loadCheckReport()));
  const card = view.rows.find((row) => row.selector === ".card");
  assert.ok(card);
  assert.deepEqual(card.definitions.map((item) => item.file).sort(), [
    "src/styles/card.css",
    "src/styles/components.css",
  ]);
  assert.deepEqual(card.usages, [
    { file: "src/components/Card.tsx", count: 2 },
    { file: "src/pages/Home.tsx", count: 1 },
  ]);
  assert.equal(card.usageCount, 3);
  assert.equal(card.fileCount, 2);
  // Definitions must never appear as usages.
  assert.equal(
    card.usages?.some((item) => item.file.includes("styles")),
    false,
  );
});

test("covers categories and statuses in one unified table", () => {
  const view = buildSelectorExplorerView(attachFullAnalysis(loadCheckReport()));
  const bySelector = new Map(view.rows.map((row) => [row.selector, row]));
  assert.equal(bySelector.get(".card")?.category, "class");
  assert.equal(bySelector.get("#app")?.category, "id");
  assert.equal(bySelector.get("button")?.category, "element");
  assert.equal(bySelector.get("[data-state]")?.category, "attribute");
  assert.equal(bySelector.get("div > .card")?.category, "combinator");
  assert.equal(bySelector.get(".hero:hover")?.category, "pseudo");

  assert.equal(bySelector.get(".card")?.status, "used");
  assert.equal(bySelector.get("[data-state]")?.status, "unused");
  assert.equal(bySelector.get("div > .card")?.status, "partial");
  assert.equal(bySelector.get(".hero:hover")?.status, "unknown");
  assert.equal(bySelector.get("div > .card")?.usageCount, 0);
  assert.equal(bySelector.get("div > .card")?.partialElements, 2);
});

test("search is case-insensitive and preserves stable ordering", () => {
  const view = buildSelectorExplorerView(attachFullAnalysis(loadCheckReport()));
  const filtered = filterSelectorExplorerRows(view.rows, {
    query: "CARD",
    sortKey: "usages",
    sortDir: "desc",
  });
  assert.ok(filtered.some((row) => row.selector === ".card"));
  assert.ok(filtered.some((row) => row.selector === "div > .card"));
  assert.equal(filtered[0]?.selector, ".card");
});

test("filters by category and status", () => {
  const view = buildSelectorExplorerView(attachFullAnalysis(loadCheckReport()));
  const classes = filterSelectorExplorerRows(view.rows, {
    category: "class",
  });
  assert.ok(classes.every((row) => row.category === "class"));

  const unused = filterSelectorExplorerRows(view.rows, { status: "unused" });
  assert.deepEqual(
    unused.map((row) => row.selector),
    ["[data-state]"],
  );

  const partial = filterSelectorExplorerRows(view.rows, { status: "partial" });
  assert.equal(partial.length, 1);
  assert.equal(partial[0]?.selector, "div > .card");
});

test("sorts by usages ascending and descending with stable ties", () => {
  const view = buildSelectorExplorerView(attachFullAnalysis(loadCheckReport()));
  const desc = filterSelectorExplorerRows(view.rows, {
    sortKey: "usages",
    sortDir: "desc",
  });
  assert.equal(desc[0]?.selector, ".card");

  const asc = filterSelectorExplorerRows(view.rows, {
    sortKey: "usages",
    sortDir: "asc",
  });
  assert.equal(asc[0]?.usageCount, 0);

  const zeroUsage = asc.filter((row) => row.usageCount === 0);
  const selectors = zeroUsage.map((row) => row.selector);
  assert.deepEqual(
    selectors,
    [...selectors].sort((a, b) => a.localeCompare(b)),
  );
});

test("legacy class-only reports stay limited and labeled", () => {
  const raw = JSON.parse(
    readFileSync(join(fixtures, "sample-check-report.json"), "utf8"),
  ) as Record<string, unknown>;
  raw.classUsage = {
    byClass: { card: [{ file: "src/app.tsx", count: 2 }] },
    scannedFiles: 1,
    notes: [],
  };
  const report = normalizeUnknownReport(raw, {
    source: { kind: "check-json", command: "check", path: "sample.json" },
  });
  const view = buildSelectorExplorerView(report);
  assert.equal(view.overview.completeness, "legacy-class-only");
  assert.equal(view.overview.totalDefinitions, null);
  assert.ok(view.rows.every((row) => row.legacyProjection));
  assert.match(view.overview.note ?? "", /[Ll]egacy|[Ll]imited/);
});

test("missing usage keeps Created In without inventing Used In", () => {
  const view = buildSelectorExplorerView(loadCheckReport());
  assert.equal(view.overview.available, true);
  for (const row of view.rows) {
    assert.ok(row.definitions.length >= 0);
    assert.equal(row.usages, null);
    assert.equal(row.usageCount, null);
    assert.equal(row.fileCount, null);
  }
});

test("empty filter result does not drop source rows", () => {
  const view = buildSelectorExplorerView(attachFullAnalysis(loadCheckReport()));
  const filtered = filterSelectorExplorerRows(view.rows, {
    query: "this-selector-does-not-exist-xyz",
  });
  assert.equal(filtered.length, 0);
  assert.equal(view.rows.length, 6);
});

test("large selector lists filter without mutating source order contract", () => {
  const report = attachFullAnalysis(loadCheckReport());
  assert.ok(report.cssAnalysis?.selectorAnalysis);
  const base = report.cssAnalysis.selectorAnalysis.selectors[0];
  assert.ok(base);
  for (let index = 0; index < 250; index += 1) {
    report.cssAnalysis.selectorAnalysis.selectors.push({
      ...base,
      selector: `.gen-${index}`,
      usageOccurrences: index % 7,
      usageFiles: 1,
      usageByFile: [{ file: `src/gen/${index}.tsx`, count: index % 7 }],
      definitions: [{ file: `src/styles/gen-${index}.css`, count: 1 }],
    });
  }
  report.cssAnalysis.selectorAnalysis.metrics.totalSelectors =
    report.cssAnalysis.selectorAnalysis.selectors.length;

  const view = buildSelectorExplorerView(report);
  assert.ok(view.rows.length >= 250);
  const filtered = filterSelectorExplorerRows(view.rows, {
    query: ".gen-1",
    sortKey: "usages",
    sortDir: "desc",
  });
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every((row) => row.selector.includes("gen-1")));
  assertOrderedByUsagesDesc(filtered);
});

function assertOrderedByUsagesDesc(rows: SelectorExplorerRow[]): void {
  for (let index = 1; index < rows.length; index += 1) {
    const prev = rows[index - 1]?.usageCount ?? -1;
    const next = rows[index]?.usageCount ?? -1;
    assert.ok(prev >= next);
  }
}

test("carries confidence level and sources through to explorer rows", () => {
  const report = attachFullAnalysis(loadCheckReport());
  const records = report.cssAnalysis?.selectorAnalysis?.selectors;
  assert.ok(records);
  const card = records.find((row) => row.selector === ".card");
  assert.ok(card);
  card.level = "high";
  card.sources = ["static", "runtime"];

  const view = buildSelectorExplorerView(report);
  const row = view.rows.find((item) => item.selector === ".card");
  assert.equal(row?.level, "high");
  assert.deepEqual(row?.sources, ["static", "runtime"]);
  // Rows without level (older reports) stay unchanged.
  const other = view.rows.find((item) => item.selector === "#app");
  assert.equal(other?.level, undefined);
});
