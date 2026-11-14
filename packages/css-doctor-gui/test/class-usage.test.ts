import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  buildClassUsageView,
  filterClassUsageRows,
} from "../shared/class-usage";
import { normalizeUnknownReport } from "../shared/normalize";
import type {
  GuiCssUsage,
  GuiReport,
  GuiSelectorRow,
} from "../shared/report-model";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function emptyUsage(partial: Partial<GuiCssUsage> = {}): GuiCssUsage {
  return {
    byClass: {},
    byId: {},
    byTag: {},
    byAttribute: {},
    ...partial,
  };
}

function selectorRow(
  partial: Partial<GuiSelectorRow> & Pick<GuiSelectorRow, "id" | "raw">,
): GuiSelectorRow {
  return {
    filePath: "src/app.css",
    kinds: [],
    classes: [],
    ids: [],
    tags: [],
    attributes: [],
    specificityIds: 0,
    specificityClasses: 0,
    specificityTypes: 0,
    nestingDepth: 0,
    ...partial,
  };
}

function loadCheckReport(): GuiReport {
  const raw = JSON.parse(
    readFileSync(join(fixtures, "sample-check-report.json"), "utf8"),
  ) as unknown;
  return normalizeUnknownReport(raw, {
    source: { kind: "check-json", command: "check", path: "sample.json" },
  });
}

test("aggregates Created In from CSS definitions without inventing Used In", () => {
  const view = buildClassUsageView(loadCheckReport());
  assert.equal(view.overview.available, true);
  assert.equal(view.overview.usageAvailable, false);
  assert.equal(view.overview.totalClasses, 2);
  assert.equal(view.overview.totalSelectors, 2);
  assert.equal(view.overview.totalUsages, null);
  assert.equal(view.overview.deadClassCount, null);
  assert.equal(view.overview.deadSelectorCount, null);
  assert.equal(view.overview.totalCssFiles, 1);
  assert.equal(view.rows.length, 2);

  const card = view.rows.find((row) => row.token === "card");
  assert.ok(card);
  assert.equal(card.kind, "class");
  assert.equal(card.selector, ".card");
  assert.equal(card.className, ".card");
  assert.equal(card.usageCount, null);
  assert.equal(card.fileCount, null);
  assert.equal(card.usages, null);
  assert.equal(card.confidence, "unknown");
  assert.deepEqual(card.definitions, [
    { file: "src/app.css", sourceType: "css", count: 1 },
  ]);
});

test("supports multiple definition files for one class", () => {
  const report = loadCheckReport();
  assert.ok(report.cssAnalysis);
  report.cssAnalysis.selectors.push(
    selectorRow({
      id: "extra",
      filePath: "src/layout.css",
      raw: ".card",
      kinds: ["class"],
      classes: ["card"],
      specificityClasses: 1,
    }),
  );

  const view = buildClassUsageView(report);
  const card = view.rows.find((row) => row.token === "card");
  assert.ok(card);
  assert.deepEqual(card.definitions.map((item) => item.file).sort(), [
    "src/app.css",
    "src/layout.css",
  ]);
  assert.equal(view.overview.totalCssFiles, 2);
  assert.equal(card.usages, null);
});

test("marks missing definition paths as unavailable/unknown", () => {
  const report = loadCheckReport();
  assert.ok(report.cssAnalysis);
  report.cssAnalysis.selectors = [
    selectorRow({
      id: "orphan",
      filePath: "",
      raw: ".ghost",
      kinds: ["class"],
      classes: ["ghost"],
      specificityClasses: 1,
    }),
  ];

  const view = buildClassUsageView(report);
  assert.equal(view.rows.length, 1);
  assert.deepEqual(view.rows[0]?.definitions, [
    { file: "Unavailable", sourceType: "unknown", count: 1 },
  ]);
  assert.equal(view.overview.totalCssFiles, 0);
});

test("does not confuse definition locations with usage locations", () => {
  const report = loadCheckReport();
  assert.ok(report.cssAnalysis);
  report.cssAnalysis.usage = emptyUsage({
    byClass: {
      card: [
        { file: "src/components/card.tsx", count: 4 },
        { file: "src/pages/home.tsx", count: 2 },
      ],
    },
  });

  const view = buildClassUsageView(report);
  const card = view.rows.find((row) => row.token === "card");
  assert.ok(card);
  assert.equal(view.overview.usageAvailable, true);
  assert.equal(card.confidence, "confirmed");
  assert.deepEqual(card.definitions, [
    { file: "src/app.css", sourceType: "css", count: 1 },
  ]);
  assert.deepEqual(card.usages, [
    { file: "src/components/card.tsx", count: 4 },
    { file: "src/pages/home.tsx", count: 2 },
  ]);
  assert.equal(card.usageCount, 6);
  assert.equal(card.fileCount, 2);
  assert.equal(
    card.usageCount,
    card.usages?.reduce((sum, item) => sum + item.count, 0),
  );
});

test("Files column counts distinct usage files only", () => {
  const report = loadCheckReport();
  assert.ok(report.cssAnalysis);
  report.cssAnalysis.usage = emptyUsage({
    byClass: {
      unused: [{ file: "src/pages/home.tsx", count: 3 }],
      card: [
        { file: "src/a.tsx", count: 1 },
        { file: "src/b.tsx", count: 1 },
        { file: "src/c.tsx", count: 1 },
      ],
    },
  });

  const view = buildClassUsageView(report);
  const card = view.rows.find((row) => row.token === "card");
  const unused = view.rows.find((row) => row.token === "unused");
  assert.equal(card?.fileCount, 3);
  assert.equal(unused?.fileCount, 1);
  assert.equal(view.overview.totalUsages, 6);
});

test("sorts by Usages descending with stable class-name tie-break", () => {
  const report = loadCheckReport();
  assert.ok(report.cssAnalysis);
  report.cssAnalysis.usage = emptyUsage({
    byClass: {
      card: [{ file: "a.tsx", count: 5 }],
      unused: [{ file: "b.tsx", count: 1 }],
      alpha: [{ file: "c.tsx", count: 1 }],
      beta: [{ file: "d.tsx", count: 1 }],
    },
  });

  const view = buildClassUsageView(report);
  assert.equal(view.rows[0]?.token, "card");
  assert.equal(view.rows[0]?.usageCount, 5);

  const tied = view.rows
    .filter((row) => row.usageCount === 1)
    .map((row) => row.token);
  assert.deepEqual(tied, ["alpha", "beta", "unused"]);
});

test("when usage is missing, sorts by definition occurrence then token", () => {
  const report = loadCheckReport();
  assert.ok(report.cssAnalysis);
  report.cssAnalysis.selectors.push(
    selectorRow({
      id: "extra",
      filePath: "src/app.css",
      raw: ".card:hover",
      kinds: ["class"],
      classes: ["card"],
      specificityClasses: 2,
    }),
  );

  const view = buildClassUsageView(report);
  assert.equal(view.overview.usageAvailable, false);
  assert.equal(view.rows[0]?.token, "card");
  assert.equal(view.rows[0]?.definitions[0]?.count, 2);
  assert.equal(view.rows[0]?.usages, null);
});

test("search is case-insensitive and preserves sort order", () => {
  const report = loadCheckReport();
  assert.ok(report.cssAnalysis);
  report.cssAnalysis.usage = emptyUsage({
    byClass: {
      card: [{ file: "a.tsx", count: 2 }],
      unused: [{ file: "b.tsx", count: 1 }],
    },
  });
  const view = buildClassUsageView(report);
  const filtered = filterClassUsageRows(view.rows, "CARD");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.token, "card");
  assert.equal(filtered[0]?.usageCount, 2);
  assert.equal(view.overview.deadClassCount, 0);

  const byFile = filterClassUsageRows(view.rows, "a.tsx");
  assert.equal(byFile.length, 1);
  assert.equal(byFile[0]?.token, "card");
});

test("filters by selector kind", () => {
  const report = loadCheckReport();
  assert.ok(report.cssAnalysis);
  report.cssAnalysis.selectors.push(
    selectorRow({
      id: "id-row",
      raw: "#app",
      kinds: ["id"],
      ids: ["app"],
      specificityIds: 1,
    }),
    selectorRow({
      id: "tag-row",
      raw: "button",
      kinds: ["type"],
      tags: ["button"],
      specificityTypes: 1,
    }),
  );
  report.cssAnalysis.usage = emptyUsage({
    byClass: { card: [{ file: "a.tsx", count: 1 }] },
    byId: { app: [{ file: "a.tsx", count: 1 }] },
    byTag: { button: [{ file: "a.tsx", count: 2 }] },
  });

  const view = buildClassUsageView(report);
  assert.ok((view.overview.totalSelectors ?? 0) >= 4);
  const ids = filterClassUsageRows(view.rows, "", "id");
  assert.equal(ids.length, 1);
  assert.equal(ids[0]?.selector, "#app");
  assert.equal(ids[0]?.confidence, "confirmed");

  const tags = filterClassUsageRows(view.rows, "", "tag");
  assert.equal(tags.length, 1);
  assert.equal(tags[0]?.selector, "button");
  assert.equal(tags[0]?.usageCount, 2);
});

test("marks overview unavailable when css analysis is missing", () => {
  const report = loadCheckReport();
  report.cssAnalysis = null;
  const view = buildClassUsageView(report);
  assert.equal(view.overview.available, false);
  assert.equal(view.overview.totalClasses, null);
  assert.equal(view.overview.totalSelectors, null);
  assert.equal(view.overview.totalUsages, null);
  assert.equal(view.overview.totalCssFiles, null);
  assert.equal(view.overview.deadClassCount, null);
  assert.equal(view.rows.length, 0);
});

test("normalize preserves selector class tokens from Core", () => {
  const report = loadCheckReport();
  assert.ok(report.cssAnalysis);
  assert.deepEqual(report.cssAnalysis.selectors[0]?.classes, ["card"]);
  assert.deepEqual(report.cssAnalysis.selectors[0]?.ids, []);
  assert.equal(report.cssAnalysis.usage, null);
});

test("normalize maps check classUsage into cssAnalysis.usage", () => {
  const raw = JSON.parse(
    readFileSync(join(fixtures, "sample-check-report.json"), "utf8"),
  ) as Record<string, unknown>;
  raw.classUsage = {
    byClass: {
      card: [{ file: "src/app.tsx", count: 3 }],
    },
    byId: {
      app: [{ file: "src/app.tsx", count: 1 }],
    },
    scannedFiles: 1,
    notes: [],
  };
  const report = normalizeUnknownReport(raw, {
    source: { kind: "check-json", command: "check", path: "sample.json" },
  });
  assert.ok(report.cssAnalysis?.usage);
  assert.deepEqual(report.cssAnalysis.usage.byId.app, [
    { file: "src/app.tsx", count: 1 },
  ]);
  const view = buildClassUsageView(report);
  assert.equal(view.overview.usageAvailable, true);
  const card = view.rows.find((row) => row.token === "card");
  assert.equal(card?.usageCount, 3);
  assert.equal(card?.fileCount, 1);
  assert.deepEqual(card?.usages, [{ file: "src/app.tsx", count: 3 }]);
  const app = view.rows.find((row) => row.kind === "id" && row.token === "app");
  assert.equal(app?.selector, "#app");
  assert.equal(app?.usageCount, 1);
});

test("older reports with only byClass remain readable", () => {
  const raw = JSON.parse(
    readFileSync(join(fixtures, "sample-check-report.json"), "utf8"),
  ) as Record<string, unknown>;
  raw.classUsage = {
    byClass: {
      card: [{ file: "src/app.tsx", count: 1 }],
    },
    scannedFiles: 1,
    notes: [],
  };
  const report = normalizeUnknownReport(raw, {
    source: { kind: "check-json", command: "check", path: "sample.json" },
  });
  assert.ok(report.cssAnalysis?.usage);
  assert.deepEqual(report.cssAnalysis.usage.byId, {});
  assert.deepEqual(report.cssAnalysis.usage.byTag, {});
  assert.deepEqual(report.cssAnalysis.usage.byAttribute, {});
});
