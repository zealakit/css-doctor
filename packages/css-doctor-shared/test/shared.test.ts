import assert from "node:assert/strict";
import test from "node:test";

import {
  clampMaxChunkSize,
  clampMinPageRatio,
  createMarkupUsageBucket,
  describeError,
  isClassToken,
  matchesPatterns,
  scanClasses,
  scanClassOccurrences,
  scanMarkupUsage,
} from "../src/index";

test("scanClasses extracts literal class tokens case-insensitively", () => {
  const classes = new Set<string>();
  scanClasses(`<div className="Foo md:flex" class='bar'>`, classes);
  scanClasses(`el.classList.add("Baz")`, classes);
  assert.deepEqual([...classes].sort(), ["bar", "baz", "foo", "md:flex"]);
});

test("scanClassOccurrences counts repeated tokens in one attribute", () => {
  const counts = new Map<string, number>();
  scanClassOccurrences(`<div className="card hero card" />`, counts);
  assert.equal(counts.get("card"), 2);
  assert.equal(counts.get("hero"), 1);
});

test("scanMarkupUsage extracts class id tag and attribute evidence", () => {
  const bucket = scanMarkupUsage(`
    <div id="App" className="card" data-state="open" disabled>
      <button type="button">Ok</button>
    </div>
    <!-- <span id="commented">no</span> -->
  `);
  assert.equal(bucket.classes.get("card"), 1);
  assert.equal(bucket.ids.get("app"), 1);
  assert.ok((bucket.tags.get("div") ?? 0) >= 1);
  assert.ok((bucket.tags.get("button") ?? 0) >= 1);
  assert.equal(bucket.attributes.get("data-state"), 1);
  assert.equal(bucket.attributes.get("data-state=open"), 1);
  assert.equal(bucket.attributes.get("disabled"), 1);
  assert.equal(bucket.ids.has("commented"), false);
});

test("scanMarkupUsage treats dynamic attribute values as presence-only", () => {
  const bucket = createMarkupUsageBucket();
  scanMarkupUsage(`<div data-state={state} id={\`x\${n}\`} />`, bucket);
  assert.equal(bucket.attributes.get("data-state"), 1);
  assert.equal(bucket.attributes.has("data-state=open"), false);
  assert.equal(bucket.ids.size, 0);
});

test("scanMarkupUsage ignores PascalCase components as tags", () => {
  const bucket = scanMarkupUsage(`<Button className="primary" /><div />`);
  assert.equal(bucket.tags.has("button"), false);
  assert.equal(bucket.tags.get("div"), 1);
  assert.equal(bucket.classes.get("primary"), 1);
});

test("isClassToken rejects template leftovers", () => {
  assert.equal(isClassToken("ok"), true);
  assert.equal(isClassToken("w-[10px]"), true);
  assert.equal(isClassToken(`\${x}`), false);
  assert.equal(isClassToken(""), false);
});

test("clampMinPageRatio preserves falsey-but-valid zero", () => {
  assert.equal(clampMinPageRatio(0).value, 0);
  assert.equal(clampMinPageRatio(1).value, 1);
  assert.equal(clampMinPageRatio(0.5).warning, undefined);
  assert.ok(clampMinPageRatio(Number.NaN).warning);
  assert.equal(clampMinPageRatio(2).value, 0.5);
});

test("clampMaxChunkSize rejects non-positive sizes", () => {
  assert.equal(clampMaxChunkSize(1024).value, 1024);
  assert.ok(clampMaxChunkSize(0).warning);
  assert.ok(clampMaxChunkSize(1.5).warning);
});

test("matchesPatterns supports string and RegExp", () => {
  assert.equal(matchesPatterns("static/css/app.css", ["static/css"]), true);
  assert.equal(matchesPatterns("app.css", [/\.module\.css$/]), false);
  assert.equal(matchesPatterns("x.module.css", [/\.module\.css$/]), true);
});

test("describeError handles non-Error values", () => {
  assert.equal(describeError(new Error("boom")), "boom");
  assert.equal(describeError("plain"), "plain");
});
