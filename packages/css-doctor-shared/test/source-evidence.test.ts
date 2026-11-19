import assert from "node:assert/strict";
import test from "node:test";

import {
  extractClassLiterals,
  scanMarkupUsage,
  scanSourceEvidence,
} from "../src/index";

test("extracts static ternary class branches without inventing dynamics", () => {
  const extracted = extractClassLiterals(`{isActive ? "active" : "inactive"}`);
  assert.deepEqual(extracted.confirmed.sort(), ["active", "inactive"]);
  assert.deepEqual(extracted.unresolved, []);
});

test("extracts static template segments only", () => {
  const extracted = extractClassLiterals("`card ${variant} hero`");
  assert.deepEqual(extracted.confirmed.sort(), ["card", "hero"]);
});

test("vue object class keys are unresolved not confirmed", () => {
  const extracted = extractClassLiterals(`{ active: isActive, 'foo-bar': x }`);
  assert.ok(extracted.unresolved.includes("active"));
  assert.ok(extracted.unresolved.includes("foo-bar"));
  assert.equal(extracted.confirmed.includes("active"), false);
});

test("jsx element evidence captures nest parents for combinators", () => {
  const evidence = scanSourceEvidence(`
    <div className="card">
      <p className="body">Hi</p>
    </div>
  `);
  assert.equal(evidence.elements.length, 2);
  assert.equal(evidence.elements[0]?.classes.includes("card"), true);
  assert.equal(evidence.elements[1]?.tag, "p");
  assert.equal(evidence.elements[1]?.parentIndex, 0);
  assert.equal(evidence.elements[1]?.depth, 1);
});

test("compound class evidence stays per-element", () => {
  const evidence = scanSourceEvidence(
    `<div className="card" /><div className="card active" />`,
  );
  assert.equal(evidence.elements[0]?.classes.includes("active"), false);
  assert.deepEqual(evidence.elements[1]?.classes.sort(), ["active", "card"]);
});

test("pascal case components are not native tags", () => {
  const evidence = scanSourceEvidence(
    `<Button className="primary" /><button />`,
  );
  assert.equal(evidence.elements[0]?.tag, null);
  assert.equal(evidence.elements[1]?.tag, "button");
  assert.equal(evidence.confirmed.tags.has("button"), true);
  assert.equal(evidence.confirmed.tags.size, 1);
});

test("vue and svelte bindings", () => {
  const vue = scanSourceEvidence(
    `<div :class="{ active: isActive }" id="panel" data-state="open" />`,
  );
  assert.equal(vue.confirmed.ids.get("panel"), 1);
  assert.equal(vue.confirmed.attributes.get("data-state=open"), 1);
  assert.ok((vue.unresolved.classes.get("active") ?? 0) >= 1);

  const svelte = scanSourceEvidence(
    `<div class:active={isActive} class="base" />`,
  );
  assert.equal(svelte.confirmed.classes.get("base"), 1);
  assert.ok((svelte.unresolved.classes.get("active") ?? 0) >= 1);
});

test("astro-like template attributes", () => {
  const evidence = scanSourceEvidence(
    `<section id="hero" class="wrap"><h1 class="title">Hi</h1></section>`,
  );
  assert.equal(evidence.confirmed.ids.get("hero"), 1);
  assert.equal(evidence.confirmed.classes.get("wrap"), 1);
  assert.equal(evidence.confirmed.tags.get("h1"), 1);
});

test("comments and unrelated strings are ignored", () => {
  const bucket = scanMarkupUsage(`
    <!-- <div id="nope" class="ghost"></div> -->
    const text = "className=\\"ghost\\"";
    <div className="real" />
  `);
  assert.equal(bucket.classes.get("real"), 1);
  assert.equal(bucket.classes.has("ghost"), false);
  assert.equal(bucket.ids.has("nope"), false);
});

test("source locations are 1-based", () => {
  const evidence = scanSourceEvidence(`\n  <div id="app" />`);
  assert.equal(evidence.elements[0]?.line, 2);
  assert.ok((evidence.elements[0]?.column ?? 0) >= 1);
});

test("regression: plain className multi-token still confirmed", () => {
  const bucket = scanMarkupUsage(`<div className="card hero card" />`);
  assert.equal(bucket.classes.get("card"), 2);
  assert.equal(bucket.classes.get("hero"), 1);
});
