import assert from "node:assert/strict";
import test from "node:test";

import { CssModuleRegistry, extractCssModuleLocals } from "../src/index";

test("extractCssModuleLocals reads css-loader and ESM export shapes", () => {
  assert.deepEqual(
    extractCssModuleLocals(
      `var x = {}; ___CSS_LOADER_EXPORT___.locals = {"card":"a_card__x","is-open":"a_is-open__y a_b"};`,
    ),
    { card: "a_card__x", "is-open": "a_is-open__y a_b" },
  );
  assert.deepEqual(extractCssModuleLocals(`export default {"a":"b"};`), {
    a: "b",
  });
  assert.deepEqual(extractCssModuleLocals(`module.exports = {"a":"b"}`), {
    a: "b",
  });
  assert.equal(extractCssModuleLocals(`nothing here`), null);
  assert.equal(extractCssModuleLocals(`export default {a: foo()}`), null);
});

test("registry maps used locals, dynamic access and unseen modules", () => {
  const registry = new CssModuleRegistry();
  registry.register("/p/a.module.css?x", {
    hero: "a_hero__1",
    extra: "a_extra__2",
  });
  registry.register("/p/b.module.css", { box: "b_box__3" });

  const used = new Set<string>();
  registry.addUsedClasses(
    `import s from "./a.module.css"; const c = s.hero;`,
    used,
  );
  assert.deepEqual([...used], ["a_hero__1"]);
  assert.deepEqual(registry.unseenClasses(), ["b_box__3"]);

  const dynamic = new Set<string>();
  registry.addUsedClasses(`import s from "./a.module.css"; s[k]`, dynamic);
  assert.deepEqual([...dynamic].sort(), ["a_extra__2", "a_hero__1"]);

  registry.resetSeen();
  assert.equal(registry.unseenClasses().length, 3);
});

test("coversAsset requires every scoped class to be registered", () => {
  const registry = new CssModuleRegistry();
  registry.register("/p/a.module.css", { hero: "a_hero__1" });
  const scoped = /\.([A-Za-z0-9]+_[A-Za-z0-9-]+__[A-Za-z0-9_-]+)/;
  assert.equal(registry.coversAsset(".a_hero__1{x:y}", scoped), true);
  assert.equal(
    registry.coversAsset(".a_hero__1{x:y}.z_other__9{}", scoped),
    false,
  );
  assert.equal(
    new CssModuleRegistry().coversAsset(".a_hero__1{}", scoped),
    false,
  );
});
