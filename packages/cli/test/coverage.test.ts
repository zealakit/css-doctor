import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { importCoverage } from "../src/commands/coverage";
import {
  classifySelectors,
  emptyCoverageFile,
  mergeCoverage,
  resolveRoute,
  runtimeEvidenceFrom,
} from "../src/runtime-coverage/coverage-store";
import { extractRules } from "../src/runtime-coverage/extract-rules";
import { parseCoverageJson } from "../src/runtime-coverage/parse-coverage";

const CSS = `.a, .b { color: red; }
@media (min-width: 10px) { .c { color: blue; } .d:hover { x: y } }
@keyframes spin { from { a: b } to { a: c } }
.e { content: "}"; }
`;

function rangeOf(text: string, needle: string) {
  const start = CSS.indexOf(needle);
  assert.ok(start >= 0, needle);
  return { start, end: start + text.length };
}

test("extractRules finds nested conditional rules and skips keyframes", () => {
  const rules = extractRules(CSS);
  assert.deepEqual(
    rules.map((r) => r.selectors),
    [[".a", ".b"], [".c"], [".d:hover"], [".e"]],
  );
  assert.equal(
    CSS.slice(rules[3]?.start, rules[3]?.end),
    '.e { content: "}"; }',
  );
});

test("classifySelectors maps used ranges to rules", () => {
  const usedA = rangeOf(".a, .b { color: red; }", ".a, .b");
  const usedC = rangeOf(".c { color: blue; }", ".c {");
  const { used, unused } = classifySelectors({
    pageUrl: "",
    stylesheetUrl: "x.css",
    text: CSS,
    usedRanges: [usedA, usedC],
  });
  assert.deepEqual(used, [".a", ".b", ".c"]);
  assert.deepEqual(unused, [".d:hover", ".e"]);
});

test("parses puppeteer/playwright, wrapper and cdp formats", () => {
  const array = parseCoverageJson(
    [{ url: "a.css", text: ".a{}", ranges: [{ start: 0, end: 4 }] }],
    { pageUrl: "http://x/y" },
  );
  assert.equal(array.format, "puppeteer-playwright");
  assert.equal(array.entries[0]?.pageUrl, "http://x/y");

  const wrapper = parseCoverageJson({
    format: "css-doctor-coverage",
    pageUrl: "http://x/blog/1",
    entries: [{ url: "a.css", text: ".a{}", ranges: [] }],
  });
  assert.equal(wrapper.format, "css-doctor");
  assert.equal(wrapper.entries[0]?.pageUrl, "http://x/blog/1");

  const cdp = parseCoverageJson({
    coverage: [
      { styleSheetId: "1", startOffset: 0, endOffset: 4, used: true },
      { styleSheetId: "1", startOffset: 4, endOffset: 9, used: false },
    ],
    styleSheets: { "1": { url: "a.css", text: ".a{}.b{}" } },
  });
  assert.equal(cdp.format, "cdp");
  assert.deepEqual(cdp.entries[0]?.usedRanges, [{ start: 0, end: 4 }]);

  assert.throws(() => parseCoverageJson({ nope: 1 }), /Unrecognized/);
  assert.throws(
    () => parseCoverageJson([{ url: "a.css", ranges: [] }]),
    /no stylesheet `text`/,
  );
});

test("route maps convert URLs to app routes", () => {
  const map = { "/blog/*": "/blog/[id]", "/docs/**": "/docs/[...slug]" };
  assert.equal(resolveRoute("http://h/blog/123?x=1", map), "/blog/[id]");
  assert.equal(resolveRoute("http://h/docs/a/b/c", map), "/docs/[...slug]");
  assert.equal(resolveRoute("http://h/about/", map), "/about");
  assert.equal(resolveRoute("", map), "/");
});

test("merge unions used selectors; stale builds are reported, not applied", () => {
  const entry = (used: Array<{ start: number; end: number }>) => ({
    pageUrl: "http://h/",
    stylesheetUrl: "a.css",
    text: CSS,
    usedRanges: used,
  });
  const a = rangeOf(".a, .b { color: red; }", ".a, .b");
  const c = rangeOf(".c { color: blue; }", ".c {");

  let file = mergeCoverage(emptyCoverageFile(), [entry([a])], {
    buildId: "v1",
  });
  file = mergeCoverage(file, [entry([c])], { buildId: "v1" });
  assert.equal(file.entries.length, 1);
  assert.deepEqual(file.entries[0]?.used, [".a", ".b", ".c"]);

  const evidence = runtimeEvidenceFrom(file, { buildId: "v1" });
  assert.equal(evidence.verdicts.get(".a"), "hit");
  assert.equal(evidence.verdicts.get(".e"), "coveredUnused");

  const stale = runtimeEvidenceFrom(file, { buildId: "v2" });
  assert.equal(stale.verdicts.size, 0);
  assert.equal(stale.warnings.length, 1);

  const changed = runtimeEvidenceFrom(file, {
    cssHashes: { "a.css": "different" },
  });
  assert.equal(changed.verdicts.size, 0);
  assert.match(changed.warnings[0] ?? "", /changed since import/);
});

test("importCoverage writes and merges coverage.json", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cssd-cov-"));
  try {
    const css = ".hero { a: b } .dead { a: b }";
    await writeFile(
      join(cwd, "raw.json"),
      JSON.stringify([
        { url: "app.css", text: css, ranges: [{ start: 0, end: 15 }] },
      ]),
    );
    await writeFile(join(cwd, "routes.json"), '{"/blog/*":"/blog/[id]"}');

    const report = await importCoverage(["raw.json"], {
      cwd,
      pageUrl: "http://h/blog/9",
      routeMap: "routes.json",
      buildId: "b1",
    });
    assert.equal(report.success, true, report.errors.join());
    assert.deepEqual(report.routes, ["/blog/[id]"]);
    assert.equal(report.usedSelectors, 1);
    assert.equal(report.unusedSelectors, 1);

    const stored = JSON.parse(
      await readFile(join(cwd, ".css-doctor/coverage.json"), "utf8"),
    );
    assert.equal(stored.entries[0].route, "/blog/[id]");
    assert.deepEqual(stored.entries[0].used, [".hero"]);

    const bad = await importCoverage(["missing.json"], { cwd });
    assert.equal(bad.success, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
