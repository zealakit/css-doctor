import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeClassHelpers,
  scanClassHelpers,
  scanSourceEvidence,
} from "../src/index";

function one(source: string) {
  const scan = scanClassHelpers(source);
  assert.equal(scan.calls.length, 1, "expected exactly one outer call");
  return { call: scan.calls[0]!, unknown: scan.unknown };
}

test("string literals and arrays are confirmed", () => {
  const { call, unknown } = one(`cn("a b", ["c", ["d"]], 'e')`);
  assert.deepEqual(call.confirmed.sort(), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(unknown, []);
});

test("static template parts confirmed, interpolated neighbours unknown", () => {
  const { call, unknown } = one("cn(`btn ${size} px-2 icon-${name}`)");
  assert.deepEqual(call.confirmed.sort(), ["btn", "px-2"]);
  assert.equal(unknown.length, 1);
});

test("object keys are unresolved, not confirmed", () => {
  const { call } = one(`clsx({ "is-active": on, open: x, 'a b': y })`);
  assert.deepEqual(call.unresolved.sort(), ["a", "b", "is-active", "open"]);
  assert.deepEqual(call.confirmed, []);
});

test("conditionals keep literal branches", () => {
  const { call, unknown } = one(`cn(on && "x", flag ? "y" : "z")`);
  assert.deepEqual(call.confirmed.sort(), ["x", "y", "z"]);
  assert.deepEqual(unknown, []);
});

test("identifiers, calls and spreads report unknown evidence with line", () => {
  const scan = scanClassHelpers(
    `const a = 1;\ncn(\n  variant,\n  getClass(),\n  ...rest,\n)`,
  );
  assert.equal(scan.unknown.length, 3);
  assert.deepEqual(
    scan.unknown.map((u) => u.line),
    [3, 4, 5],
  );
});

test("nested helper calls fold into the outer call", () => {
  const { call } = one(`cn("a", clsx({ b: x }), twMerge("c"))`);
  assert.deepEqual(call.confirmed.sort(), ["a", "c"]);
  assert.deepEqual(call.unresolved, ["b"]);
});

test("multiline calls and comments", () => {
  const { call } = one(`cn(
    // "ignored"
    "a", /* "nope" */
    "b"
  )`);
  assert.deepEqual(call.confirmed.sort(), ["a", "b"]);
});

test("cva: base and every variant value are confirmed", () => {
  const { call, unknown } = one(`cva("inline-flex gap-2", {
    variants: {
      size: { sm: "h-8 px-2", lg: ["h-12", "px-6"] },
      tone: { primary: "bg-blue-500", ghost: "" },
    },
    compoundVariants: [{ size: "sm", tone: "primary", class: "font-bold" }],
    defaultVariants: { size: "sm" },
  })`);
  assert.deepEqual(call.confirmed.sort(), [
    "bg-blue-500",
    "font-bold",
    "gap-2",
    "h-12",
    "h-8",
    "inline-flex",
    "px-2",
    "px-6",
  ]);
  assert.deepEqual(call.unresolved, []);
  assert.deepEqual(unknown, []);
});

test("tv slots and base", () => {
  const { call } = one(`tv({
    base: "root",
    slots: { icon: "i-class", label: "l-class" },
    variants: { size: { sm: { icon: "s-icon" } } },
  })`);
  assert.deepEqual(call.confirmed.sort(), [
    "i-class",
    "l-class",
    "root",
    "s-icon",
  ]);
});

test("declarations and member names are not calls", () => {
  assert.equal(scanClassHelpers(`function cn(a) { return a }`).calls.length, 0);
  assert.equal(scanClassHelpers(`obscn("a") + xcn("b")`).calls.length, 0);
});

test("custom helper list and normalization", () => {
  assert.equal(scanClassHelpers(`mine("a")`, ["mine"]).calls.length, 1);
  assert.equal(scanClassHelpers(`cn("a")`, ["mine"]).calls.length, 0);
  assert.deepEqual(normalizeClassHelpers(["ok", "bad name", 3]), ["ok"]);
  assert.ok(normalizeClassHelpers("nope").includes("cn"));
});

test("scanSourceEvidence integrates helper results and unknown count", () => {
  const evidence = scanSourceEvidence(
    `export const B = () => <button className={cn("btn", { active: on }, extra)} />;`,
  );
  assert.ok((evidence.confirmed.classes.get("btn") ?? 0) >= 1);
  assert.ok((evidence.unresolved.classes.get("active") ?? 0) >= 1);
  assert.equal(evidence.unknownEvidenceCount, 1);
  assert.equal(
    scanSourceEvidence(`cn("zzz")`, { classHelpers: [] }).confirmed.classes.has(
      "zzz",
    ),
    false,
  );
});

test("scanClasses picks up helper literals and conditional keys", async () => {
  const { scanClasses } = await import("../src/index");
  const classes = new Set<string>();
  scanClasses(
    `const c = cn("a", { b: on }); const v = cva("v-base");`,
    classes,
  );
  assert.deepEqual([...classes].sort(), ["a", "b", "v-base"]);
  const off = new Set<string>();
  scanClasses(`cn("a")`, off, []);
  assert.equal(off.size, 0);
});
