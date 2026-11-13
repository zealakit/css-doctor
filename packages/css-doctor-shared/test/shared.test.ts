import assert from "node:assert/strict";
import test from "node:test";

import {
  clampMaxChunkSize,
  clampMinPageRatio,
  describeError,
  isClassToken,
  matchesPatterns,
  scanClasses,
} from "../src/index";

test("scanClasses extracts literal class tokens case-insensitively", () => {
  const classes = new Set<string>();
  scanClasses(`<div className="Foo md:flex" class='bar'>`, classes);
  scanClasses(`el.classList.add("Baz")`, classes);
  assert.deepEqual([...classes].sort(), ["bar", "baz", "foo", "md:flex"]);
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
