#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const build = spawnSync("pnpm", ["--filter", "@zealakit/css-doctor-gui", "build"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const local = spawnSync("pnpm", ["exec", "tauri", "--version"], {
  cwd: root,
  encoding: "utf8",
  shell: process.platform === "win32",
});
const cargo = spawnSync("cargo", ["tauri", "--version"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});

let command;
let args;
if (local.status === 0) {
  command = "pnpm";
  args = ["exec", "tauri", "build"];
} else if (cargo.status === 0) {
  command = "cargo";
  args = ["tauri", "build"];
} else {
  console.error(`css-doctor-gui desktop:build

Tauri CLI is not available. Desktop packaging requires Tauri 2 + Rust toolchain.

Install:
  pnpm --filter @zealakit/css-doctor-gui add -D @tauri-apps/cli@2
  # or: cargo install tauri-cli --version "^2.0.0"

Web production (verified without Tauri):
  pnpm --filter @zealakit/css-doctor-gui build
  pnpm --filter @zealakit/css-doctor-gui start
`);
  process.exit(1);
}

const result = spawnSync(command, args, {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
