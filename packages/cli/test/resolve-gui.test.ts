import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  detectInstallCommand,
  formatMissingGuiMessage,
  loadGuiServerModule,
  resolveGuiServerEntry,
} from "../src/utils/resolve-gui";

const repoGuiRoot = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  "..",
  "css-doctor-gui",
);

test("formatMissingGuiMessage recommends installing css-doctor-gui", () => {
  const message = formatMissingGuiMessage("/tmp/empty-project");
  assert.match(message, /CSS Doctor GUI is not installed/);
  assert.match(message, /css-doctor-gui/);
  assert.doesNotMatch(message, /pnpm --filter/);
});

test("detectInstallCommand prefers pnpm when lockfile exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cssd-gui-pm-"));
  try {
    await writeFile(join(directory, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    assert.equal(
      detectInstallCommand(directory),
      "pnpm add -D @zealakit/css-doctor-gui",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resolveGuiServerEntry finds GUI from a consuming project node_modules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cssd-gui-consumer-"));
  const isolatedCli = join(directory, "isolated-cli-module.js");
  try {
    await writeFile(join(directory, "package.json"), '{"name":"consumer"}\n');
    await writeFile(isolatedCli, "export {};\n");
    await mkdir(join(directory, "node_modules", "@zealakit"), {
      recursive: true,
    });
    await symlink(
      repoGuiRoot,
      join(directory, "node_modules", "@zealakit", "css-doctor-gui"),
      "dir",
    );

    const resolved = resolveGuiServerEntry({
      cwd: directory,
      fromModuleUrl: isolatedCli,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) {
      return;
    }
    assert.match(resolved.entryPath, /css-doctor-gui/);
    assert.match(resolved.entryPath, /dist-server/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("resolveGuiServerEntry fails without hardcoded workspace paths when GUI is absent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cssd-gui-missing-"));
  const isolatedCli = join(directory, "isolated-cli-module.js");
  try {
    await writeFile(join(directory, "package.json"), '{"name":"alone"}\n');
    await writeFile(isolatedCli, "export {};\n");

    const resolved = resolveGuiServerEntry({
      cwd: directory,
      fromModuleUrl: isolatedCli,
    });
    assert.equal(
      resolved.ok,
      false,
      resolved.ok
        ? `unexpected entry ${resolved.entryPath} from ${resolved.resolvedFrom}`
        : undefined,
    );
    if (resolved.ok) {
      return;
    }
    assert.match(resolved.message, /not installed/i);
    assert.match(
      resolved.message,
      /pnpm add -D @zealakit\/css-doctor-gui|npm install -D @zealakit\/css-doctor-gui/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("loadGuiServerModule loads startGuiServer from consumer install", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cssd-gui-load-"));
  const isolatedCli = join(directory, "isolated-cli-module.js");
  try {
    await writeFile(join(directory, "package.json"), '{"name":"consumer"}\n');
    await writeFile(isolatedCli, "export {};\n");
    await mkdir(join(directory, "node_modules", "@zealakit"), {
      recursive: true,
    });
    await symlink(
      repoGuiRoot,
      join(directory, "node_modules", "@zealakit", "css-doctor-gui"),
      "dir",
    );

    const loaded = await loadGuiServerModule({
      cwd: directory,
      fromModuleUrl: isolatedCli,
    });
    assert.equal(loaded.ok, true);
    if (!loaded.ok) {
      return;
    }
    assert.equal(typeof loaded.module.startGuiServer, "function");
    assert.equal(typeof loaded.module.launchDesktopApp, "function");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
