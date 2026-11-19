import assert from "node:assert/strict";
import test from "node:test";

import { isCssModuleSpecifier, scanCssModuleUsage } from "../src/index";

const one = (source: string) => {
  const usage = scanCssModuleUsage(source);
  assert.equal(usage.length, 1);
  return usage[0] as (typeof usage)[number];
};

test("static member and bracket access", () => {
  const usage = one(`import styles from "./a.module.css";
    const a = <div className={styles.card + " " + styles["is-active"] + styles['x']} />;`);
  assert.deepEqual(usage.locals, ["card", "is-active", "x"]);
  assert.equal(usage.dynamic, false);
});

test("destructuring and named imports", () => {
  const usage = one(`import styles, { hero } from "./a.module.scss";
    const { card, "btn-primary": primary } = styles;`);
  assert.deepEqual(usage.locals, ["btn-primary", "card", "hero"]);
  assert.equal(usage.dynamic, false);
});

test("dynamic access marks the whole module dynamic", () => {
  assert.equal(one(`import s from "./a.module.css"; s[variant]`).dynamic, true);
  assert.equal(
    one(`import s from "./a.module.css"; const { a, ...rest } = s;`).dynamic,
    true,
  );
  assert.equal(
    one(`import s from "./a.module.css"; <Child styles={s} />`).dynamic,
    true,
  );
});

test("non-module css imports are ignored", () => {
  assert.deepEqual(
    scanCssModuleUsage(`import "./a.css"; import s from "./b.css";`),
    [],
  );
  assert.equal(isCssModuleSpecifier("./x.module.css?inline"), true);
});
