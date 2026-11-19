#!/usr/bin/env node
/**
 * pnpm's content-addressable store can occasionally place the wrong native
 * esbuild binary under `@esbuild/<platform>@X` or `esbuild@X/bin/esbuild`.
 * When that happens, tsx/Vite fail with:
 *   Host version "A" does not match binary version "B"
 *
 * This script detects version mismatches and re-fetches the matching optional
 * dependency from the npm registry into the local pnpm virtual store.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  copyFileSync,
  chmodSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmDir = join(root, "node_modules/.pnpm");

if (!existsSync(pnpmDir)) {
  console.log("repair-esbuild-binaries: no node_modules/.pnpm; skipping");
  process.exit(0);
}

const platformPackage = (() => {
  const { platform, arch } = process;
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64";
  if (platform === "darwin" && arch === "x64") return "darwin-x64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "linux" && arch === "arm64") return "linux-arm64";
  if (platform === "win32" && arch === "x64") return "win32-x64";
  return null;
})();

if (!platformPackage) {
  console.log(
    `repair-esbuild-binaries: unsupported platform ${process.platform}/${process.arch}; skipping`,
  );
  process.exit(0);
}

function readVersion(binPath) {
  try {
    return execFileSync(binPath, ["--version"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function reinstallPlatformPackage(version) {
  const spec = `@esbuild/${platformPackage}@${version}`;
  const staging = mkdtempSync(join(tmpdir(), "cssd-esbuild-"));
  try {
    const pack = spawnSync(
      "npm",
      ["pack", `@esbuild/${platformPackage}@${version}`, "--silent"],
      { cwd: staging, encoding: "utf8" },
    );
    if (pack.status !== 0) {
      console.warn(
        `repair-esbuild-binaries: npm pack failed for ${spec}: ${pack.stderr}`,
      );
      return false;
    }
    const tarball = pack.stdout.trim().split("\n").at(-1);
    if (!tarball) {
      return false;
    }
    const extract = spawnSync("tar", ["-xzf", tarball], {
      cwd: staging,
      encoding: "utf8",
    });
    if (extract.status !== 0) {
      console.warn(`repair-esbuild-binaries: tar failed for ${spec}`);
      return false;
    }
    const packedBin = join(staging, "package", "bin", "esbuild");
    if (!existsSync(packedBin)) {
      console.warn(`repair-esbuild-binaries: packed binary missing for ${spec}`);
      return false;
    }
    const targetDir = join(
      pnpmDir,
      `@esbuild+${platformPackage}@${version}`,
      "node_modules/@esbuild",
      platformPackage,
      "bin",
    );
    mkdirSync(targetDir, { recursive: true });
    const targetBin = join(targetDir, "esbuild");
    copyFileSync(packedBin, targetBin);
    chmodSync(targetBin, 0o755);
    return readVersion(targetBin) === version;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

let repaired = 0;

for (const entry of readdirSync(pnpmDir)) {
  if (entry.startsWith(`@esbuild+${platformPackage}@`)) {
    const version = entry.slice(`@esbuild+${platformPackage}@`.length);
    const binPath = join(
      pnpmDir,
      entry,
      "node_modules/@esbuild",
      platformPackage,
      "bin/esbuild",
    );
    if (!existsSync(binPath)) {
      continue;
    }
    const actual = readVersion(binPath);
    if (actual === version) {
      continue;
    }
    console.log(
      `repair-esbuild-binaries: platform ${entry} has ${actual || "unreadable"}, want ${version}`,
    );
    if (reinstallPlatformPackage(version)) {
      repaired += 1;
      console.log(`repair-esbuild-binaries: restored ${entry}`);
    }
  }

  if (entry.startsWith("esbuild@")) {
    const pkgDir = join(pnpmDir, entry, "node_modules/esbuild");
    const binPath = join(pkgDir, "bin/esbuild");
    const pkgJsonPath = join(pkgDir, "package.json");
    if (!existsSync(binPath) || !existsSync(pkgJsonPath)) {
      continue;
    }
    const expected = JSON.parse(readFileSync(pkgJsonPath, "utf8")).version;
    const actual = readVersion(binPath);
    if (actual === expected) {
      continue;
    }
    const platformBin = join(
      pnpmDir,
      `@esbuild+${platformPackage}@${expected}`,
      "node_modules/@esbuild",
      platformPackage,
      "bin/esbuild",
    );
    if (!existsSync(platformBin) || readVersion(platformBin) !== expected) {
      reinstallPlatformPackage(expected);
    }
    if (existsSync(platformBin) && readVersion(platformBin) === expected) {
      copyFileSync(platformBin, binPath);
      chmodSync(binPath, 0o755);
      repaired += 1;
      console.log(
        `repair-esbuild-binaries: fixed ${entry} bin (${actual || "unreadable"} → ${expected})`,
      );
    }
  }
}

console.log(`repair-esbuild-binaries: repaired ${repaired} package(s)`);
