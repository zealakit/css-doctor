import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { collectProjectClassUsage } from "../src/utils/collect-class-usage";
import { runGuiStartupAnalysis } from "../src/utils/gui-startup-analysis";

async function withTempDir<T>(run: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "cssd-usage-"));
  try {
    return await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test("collectProjectClassUsage counts literal className hits per file", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src/app.tsx"),
      `export const App = () => <div className="card hero card" />;`,
    );
    await writeFile(
      join(cwd, "src/header.tsx"),
      `export const Header = () => <header className="hero" />;`,
    );

    const usage = await collectProjectClassUsage(cwd);
    assert.ok(usage.scannedFiles >= 2);
    assert.deepEqual(usage.byClass.card, [{ file: "src/app.tsx", count: 2 }]);
    assert.deepEqual(usage.byClass.hero?.map((hit) => hit.file).sort(), [
      "src/app.tsx",
      "src/header.tsx",
    ]);
    assert.equal(
      usage.byClass.hero?.reduce((sum, hit) => sum + hit.count, 0),
      2,
    );
  });
});

test("collectProjectClassUsage counts id tag and attribute hits", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src/shell.tsx"),
      `export const Shell = () => (
        <main id="App" data-state="open">
          <button disabled type="button">Go</button>
        </main>
      );`,
    );
    await writeFile(
      join(cwd, "src/panel.vue"),
      `<template><section id="panel"><input required /></section></template>`,
    );

    const usage = await collectProjectClassUsage(cwd);
    assert.deepEqual(usage.byId.app, [{ file: "src/shell.tsx", count: 1 }]);
    assert.deepEqual(usage.byId.panel, [{ file: "src/panel.vue", count: 1 }]);
    assert.ok((usage.byTag.button?.[0]?.count ?? 0) >= 1);
    assert.ok((usage.byTag.input?.[0]?.count ?? 0) >= 1);
    assert.equal(
      usage.byAttribute["data-state=open"]?.[0]?.file,
      "src/shell.tsx",
    );
    assert.ok(usage.byAttribute.disabled);
    assert.ok(usage.byAttribute.required);
    assert.ok((usage.elementsScanned ?? 0) >= 3);
  });
});

test("collectProjectClassUsage matches compounds via Core", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src/app.tsx"),
      `export const App = () => (
        <>
          <div className="card" />
          <div className="card active" />
          <div className="card"><p>Hi</p></div>
        </>
      );`,
    );

    const usage = await collectProjectClassUsage(cwd, {
      selectors: [".card.active", ".card p", ".card:hover", ".missing"],
    });
    const bySelector = Object.fromEntries(
      usage.selectorMatches.map((item) => [item.selector, item]),
    );
    assert.equal(bySelector[".card.active"]?.confidence, "confirmed");
    assert.equal(bySelector[".card.active"]?.status, "used");
    assert.equal(bySelector[".card.active"]?.matchCount, 1);
    assert.equal(bySelector[".card.active"]?.matchedElements, 1);
    assert.equal(bySelector[".card p"]?.confidence, "confirmed");
    assert.equal(bySelector[".card:hover"]?.confidence, "partial");
    assert.equal(bySelector[".card:hover"]?.status, "partial");
    assert.equal(bySelector[".card:hover"]?.hasUnprovenRuntimeState, true);
    assert.equal(bySelector[".missing"]?.confidence, "none");
    assert.equal(bySelector[".missing"]?.status, "unused");
  });
});

test("dynamic class bindings stay unresolved", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src/Widget.svelte"),
      `<div class:active={isActive} class="base"></div>`,
    );
    const usage = await collectProjectClassUsage(cwd);
    assert.equal(usage.byClass.base?.[0]?.count, 1);
    assert.equal(usage.byClass.active, undefined);
    assert.ok(usage.unresolvedByClass.active);
  });
});

test("gui startup attaches classUsage for Used In columns", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src/app.css"),
      ".card { color: red; }\n.hero { color: blue; }\n",
    );
    await writeFile(
      join(cwd, "src/app.tsx"),
      `export const App = () => <div className="card hero" />;`,
    );

    const result = await runGuiStartupAnalysis({
      patterns: ["src/app.css"],
      cwd,
    });
    assert.equal(result.exitCode, 0);
    assert.ok(result.report.classUsage);
    assert.ok(result.report.classUsage?.byClass.card);
    assert.equal(
      result.report.classUsage?.byClass.card?.[0]?.file,
      "src/app.tsx",
    );
    assert.equal(result.report.classUsage?.byClass.card?.[0]?.count, 1);
  });
});

test("collectProjectClassUsage resolves class helpers and reports unknown evidence", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src/button.tsx"),
      [
        `const button = cva("btn", { variants: { size: { sm: "btn-sm", lg: "btn-lg" } } });`,
        `export const B = ({ extra }) => <button className={cn(button(), "px-2", { "is-active": on }, extra)} />;`,
      ].join("\n"),
    );

    const usage = await collectProjectClassUsage(cwd);
    for (const name of ["btn", "btn-sm", "btn-lg", "px-2"]) {
      assert.ok(usage.byClass[name], `${name} should be confirmed`);
    }
    assert.ok(usage.unresolvedByClass["is-active"]);
    assert.equal(usage.byClass["is-active"], undefined);
    assert.equal(usage.unknownEvidenceCount, 2); // button() and extra
    assert.equal(usage.unknownEvidenceByFile["src/button.tsx"]?.[0]?.line, 2);

    const disabled = await collectProjectClassUsage(cwd, { classHelpers: [] });
    assert.equal(disabled.byClass["btn-sm"], undefined);
  });
});

test("collectProjectClassUsage maps CSS Modules access to local classes", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src/card.tsx"),
      `import styles from "./card.module.css";
const { title } = styles;
export const C = () => <div className={styles.card + styles["is-open"]}>{title}</div>;`,
    );
    await writeFile(
      join(cwd, "src/dyn.tsx"),
      `import s from "./dyn.module.css";\nexport const D = ({ v }) => <i className={s[v]} />;`,
    );

    const usage = await collectProjectClassUsage(cwd);
    for (const name of ["card", "is-open", "title"]) {
      assert.ok(usage.byClass[name], `${name} should be used`);
    }
    assert.equal(usage.unknownEvidenceByFile["src/dyn.tsx"]?.length, 1);
    assert.equal(usage.unknownEvidenceByFile["src/card.tsx"], undefined);
  });
});

test("runtime coverage upgrades selector verdicts via Core rules", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src/app.tsx"),
      `export const A = () => <div className="seen" />;`,
    );
    const verdicts = new Map<string, "hit" | "coveredUnused">([
      [".runtime-only", "hit"],
      [".ghost", "coveredUnused"],
    ]);
    const usage = await collectProjectClassUsage(cwd, {
      selectors: [".seen", ".runtime-only", ".ghost", ".plain"],
      runtimeVerdicts: verdicts,
    });
    const by = (selector: string) =>
      usage.selectorMatches.find((match) => match.selector === selector);

    assert.equal(by(".seen")?.status, "used");
    assert.deepEqual(by(".seen")?.sources, ["static"]);

    assert.equal(by(".runtime-only")?.status, "used");
    assert.equal(by(".runtime-only")?.level, "high");
    assert.deepEqual(by(".runtime-only")?.sources, ["static", "runtime"]);

    assert.equal(by(".ghost")?.status, "unused");
    assert.equal(by(".ghost")?.level, "high");

    assert.equal(by(".plain")?.status, "unused");
    assert.equal(by(".plain")?.level, "medium");
  });
});

test("reports compound selectors whose classes never meet on one element", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(
      join(cwd, "src/a.tsx"),
      `export const A = () => <div className="btn" />;`,
    );
    await writeFile(
      join(cwd, "src/b.tsx"),
      `export const B = () => <div className="primary" />;`,
    );
    await writeFile(
      join(cwd, "src/c.tsx"),
      `export const C = () => <div className="card active" />;`,
    );

    const usage = await collectProjectClassUsage(cwd, {
      selectors: [".btn.primary", ".card.active", ".btn.ghost", ".btn:not(.x)"],
    });
    assert.deepEqual(
      usage.compoundNeverMatch.map((item) => item.selector),
      [".btn.primary"],
    );
    assert.deepEqual(usage.compoundNeverMatch[0]?.filesByClass, {
      btn: ["src/a.tsx"],
      primary: ["src/b.tsx"],
    });
  });
});
