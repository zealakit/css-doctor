import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadProjectConfig } from "../src/utils/config";

async function writeProjectConfig(
  directory: string,
  body: unknown,
): Promise<void> {
  await mkdir(join(directory, ".css-doctor"), { recursive: true });
  await writeFile(
    join(directory, ".css-doctor/config.json"),
    `${JSON.stringify(body, null, 2)}\n`,
  );
}

test("missing config file returns defaults without errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cssd-config-"));
  const loaded = await loadProjectConfig(directory);
  assert.equal(loaded.path, null);
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.config.qualityGates.failOnRegression, false);
  assert.equal(loaded.config.qualityGates.maxSelectorIncreasePercent, null);
});

test("explicit false is preserved for qualityGates.failOnRegression", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cssd-config-"));
  await writeProjectConfig(directory, {
    qualityGates: {
      failOnRegression: false,
      maxSelectorIncreasePercent: 25,
    },
  });

  const loaded = await loadProjectConfig(directory);
  assert.equal(loaded.errors.length, 0);
  assert.equal(loaded.config.qualityGates.failOnRegression, false);
  assert.equal(loaded.config.qualityGates.maxSelectorIncreasePercent, 25);
});

test("malformed JSON reports a readable config error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cssd-config-"));
  await mkdir(join(directory, ".css-doctor"), { recursive: true });
  await writeFile(join(directory, ".css-doctor/config.json"), "{ not-json");
  const loaded = await loadProjectConfig(directory);
  assert.ok(
    loaded.errors.some((error) => error.includes("Failed to load config")),
  );
});

test("invalid qualityGates shape collects field errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cssd-config-"));
  await writeProjectConfig(directory, {
    qualityGates: {
      failOnRegression: "yes",
      maxSelectorIncreasePercent: -1,
    },
  });
  const loaded = await loadProjectConfig(directory);
  assert.ok(loaded.errors.some((error) => error.includes("failOnRegression")));
  assert.ok(
    loaded.errors.some((error) => error.includes("maxSelectorIncreasePercent")),
  );
});

test("coverage setting accepts booleans and paths, rejects junk", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loadProjectConfig } = await import("../src/utils/config");
  const dir = await mkdtemp(join(tmpdir(), "cssd-cfg-"));
  try {
    for (const [value, expected, errors] of [
      [true, true, 0],
      ['"cov/x.json"', "cov/x.json", 0],
      [3, false, 1],
    ] as const) {
      await writeFile(
        join(dir, "c.json"),
        `{"coverage": ${typeof value === "string" ? value : JSON.stringify(value)}}`,
      );
      const loaded = await loadProjectConfig(dir, "c.json");
      assert.equal(loaded.config.coverage, expected);
      assert.equal(loaded.errors.length, errors);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
