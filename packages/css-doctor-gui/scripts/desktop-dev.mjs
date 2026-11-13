#!/usr/bin/env node
/**
 * Starts Tauri desktop development when the toolchain is available.
 * Web mode does not require this script.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cargoToml = join(root, "src-tauri/Cargo.toml");

if (!existsSync(cargoToml)) {
  console.error("css-doctor-gui: missing src-tauri scaffold.");
  process.exit(1);
}

const build = spawnSync("pnpm", ["--filter", "css-doctor-gui", "build"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const tauri = resolveTauri();
if (!tauri) {
  printMissingTauri("dev");
  process.exit(1);
}

const result = spawnSync(tauri.command, [...tauri.prefix, "dev"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    // Desktop shell spawns the production Node sidecar (not Vite).
  },
});
process.exit(result.status ?? 1);

function resolveTauri() {
  const local = spawnSync("pnpm", ["exec", "tauri", "--version"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (local.status === 0) {
    return { command: "pnpm", prefix: ["exec", "tauri"] };
  }
  const cargo = spawnSync("cargo", ["tauri", "--version"], {
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (cargo.status === 0) {
    return { command: "cargo", prefix: ["tauri"] };
  }
  return null;
}

function printMissingTauri(mode) {
  console.error(`css-doctor-gui desktop:${mode}

Tauri CLI is not available.

Desktop strategy (Option B): Tauri webview + Node HTTP sidecar (NAPI).
Install one of:

  pnpm --filter css-doctor-gui add -D @tauri-apps/cli@2
  cargo install tauri-cli --version "^2.0.0"

Web mode remains available without Tauri:

  pnpm --filter css-doctor-gui build
  css-doctor gui
`);
}
