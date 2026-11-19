import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  missingPatternsGuidance,
  resolveCheckPatterns,
} from "../src/utils/resolve-check-patterns";

async function withTempDir<T>(run: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "cssd-patterns-"));
  try {
    return await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test("CLI patterns win over config", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, ".css-doctor"), { recursive: true });
    await writeFile(
      join(cwd, ".css-doctor/config.json"),
      JSON.stringify({ patterns: ["from-config.css"] }),
    );
    const resolved = await resolveCheckPatterns(["from-cli.css"], { cwd });
    assert.equal(resolved.source, "cli");
    assert.deepEqual(resolved.patterns, ["from-cli.css"]);
  });
});

test("config patterns are used when CLI patterns are empty", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, ".css-doctor"), { recursive: true });
    await writeFile(
      join(cwd, ".css-doctor/config.json"),
      JSON.stringify({ patterns: ["src/**/*.css"] }),
    );
    const resolved = await resolveCheckPatterns([], { cwd });
    assert.equal(resolved.source, "config");
    assert.deepEqual(resolved.patterns, ["src/**/*.css"]);
  });
});

test("baseline patterns are used when config patterns are empty", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, ".css-doctor"), { recursive: true });
    await writeFile(
      join(cwd, ".css-doctor/baseline.json"),
      JSON.stringify({
        schemaVersion: 1,
        config: { patterns: ["baseline.css"] },
      }),
    );
    const resolved = await resolveCheckPatterns([], {
      cwd,
      discover: false,
    });
    assert.equal(resolved.source, "baseline");
    assert.deepEqual(resolved.patterns, ["baseline.css"]);
  });
});

test("discovers documented src/**/*.css when it matches files", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src/app.css"), ".ok { color: red; }\n");
    const resolved = await resolveCheckPatterns([], { cwd, discover: true });
    assert.equal(resolved.source, "default");
    assert.deepEqual(resolved.patterns, ["src/**/*.css"]);
  });
});

test("discovers root *.css when src layout is absent", async () => {
  await withTempDir(async (cwd) => {
    await writeFile(join(cwd, "styles.css"), ".ok { color: blue; }\n");
    const resolved = await resolveCheckPatterns([], { cwd, discover: true });
    assert.equal(resolved.source, "default");
    assert.deepEqual(resolved.patterns, ["*.css"]);
  });
});

test("discover can be disabled and yields none without config", async () => {
  await withTempDir(async (cwd) => {
    await writeFile(join(cwd, "styles.css"), ".ok { color: blue; }\n");
    const resolved = await resolveCheckPatterns([], { cwd, discover: false });
    assert.equal(resolved.source, "none");
    assert.deepEqual(resolved.patterns, []);
  });
});

test("missingPatternsGuidance points at CLI args and config", () => {
  assert.match(missingPatternsGuidance(), /css-doctor gui/);
  assert.match(missingPatternsGuidance(), /config\.json/);
});
