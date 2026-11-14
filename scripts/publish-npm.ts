/**
 * Manual npm publish fallback when GitHub Actions release jobs fail.
 *
 * Mirrors release-step-1 / release-step-2 order:
 *   1) platform .node packages
 *   2) main binding loader
 *   3) adapters + CLI (vite → rsbuild → remix → nuxt → next → cli)
 *
 * `@zealakit/css-doctor-shared` is internal-only: it is built in the monorepo
 * and bundled into consumers, never published.
 *
 * Temporarily rewrites `workspace:*` @zealakit deps to the package version,
 * strips internal-only packages from publish manifests, validates packed
 * tarballs, then restores the original package.json files.
 *
 * Usage:
 *   pnpm publish:npm
 *   pnpm publish:npm:binding
 *   pnpm publish:npm:adapters
 *   pnpm publish:npm:dry
 *   tsx scripts/publish-npm.ts --help
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = {
  name: string;
  version: string;
  private?: boolean;
  main?: string;
  files?: string[];
  publishConfig?: {
    access?: string;
    [key: string]: unknown;
  };
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
};

type PublishTarget = {
  id: string;
  dir: string;
  kind: "platform" | "binding" | "adapter";
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Never published; consumers must bundle this package. */
const INTERNAL_ONLY_PACKAGES = new Set(["@zealakit/css-doctor-shared"]);

const SHARED_PACKAGE_DIR = "css-doctor-shared";
const SHARED_IMPORT_MARKER = "@zealakit/css-doctor-shared";

const PLATFORMS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64-gnu",
  "linux-x64-musl",
  "win32-x64-msvc",
] as const;

/** Publishable adapter/CLI packages (shared is intentionally omitted). */
const ADAPTER_DIRS = [
  "css-doctor-vite",
  "css-doctor-rsbuild",
  "css-doctor-remix",
  "css-doctor-nuxt",
  "css-doctor-next",
  "cli",
] as const;

/** Packages that import and must bundle css-doctor-shared. */
const BUNDLES_SHARED = new Set([
  "css-doctor-vite",
  "css-doctor-rsbuild",
  "css-doctor-next",
  "css-doctor-gui",
  "cli",
]);

const WORKSPACE_DEP_KEYS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function printHelp(): void {
  console.log(`Manual npm publish for @zealakit/css-doctor packages.

Usage:
  tsx scripts/publish-npm.ts [options]

Options:
  --all           Publish binding platforms + loader + adapters (default)
  --binding       Publish only platform binaries + main binding
  --adapters      Publish only vite/rsbuild/remix/nuxt/next/cli
  --dry-run       Run npm publish --dry-run (no registry write)
  --validate-only Build + pack-validate publish targets; do not publish
  --tag <tag>     npm dist-tag (default: latest, or beta for pre-release versions)
  --force         Publish even if the version already exists on npm
  --skip-missing  Skip packages whose build artifacts are missing
  -h, --help      Show this help

Notes:
  @zealakit/css-doctor-shared is internal-only and is never published.
  Consumers bundle it at build time; packed manifests must not depend on it.

Root scripts:
  pnpm publish:npm
  pnpm publish:npm:binding
  pnpm publish:npm:adapters
  pnpm publish:npm:dry
`);
}

function parseArgs(argv: string[]): {
  mode: "all" | "binding" | "adapters";
  dryRun: boolean;
  validateOnly: boolean;
  tag: string | null;
  force: boolean;
  skipMissing: boolean;
  help: boolean;
} {
  let mode: "all" | "binding" | "adapters" = "all";
  let dryRun = false;
  let validateOnly = false;
  let tag: string | null = null;
  let force = false;
  let skipMissing = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    switch (arg) {
      case "--all":
        mode = "all";
        break;
      case "--binding":
        mode = "binding";
        break;
      case "--adapters":
        mode = "adapters";
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--validate-only":
        validateOnly = true;
        break;
      case "--force":
        force = true;
        break;
      case "--skip-missing":
        skipMissing = true;
        break;
      case "--tag": {
        const next = argv[i + 1];
        if (!next || next.startsWith("-")) {
          throw new Error("--tag requires a value");
        }
        tag = next;
        i += 1;
        break;
      }
      case "-h":
      case "--help":
        help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { mode, dryRun, validateOnly, tag, force, skipMissing, help };
}

function readManifest(dir: string): PackageJson {
  const path = join(dir, "package.json");
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

function writeManifest(dir: string, manifest: PackageJson): void {
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function resolveNpmTag(version: string, explicit: string | null): string {
  if (explicit) {
    return explicit;
  }
  return /(alpha|beta|rc)/i.test(version) ? "beta" : "latest";
}

function packageExistsOnNpm(name: string, version: string): boolean {
  const result = spawnSync("npm", ["view", `${name}@${version}`, "version"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  return result.status === 0;
}

function runOrThrow(
  command: string,
  args: string[],
  cwd: string,
  label: string,
): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status ?? 1})`);
  }
}

function pinWorkspaceDeps(manifest: PackageJson, version: string): void {
  for (const key of WORKSPACE_DEP_KEYS) {
    const deps = manifest[key];
    if (!deps) {
      continue;
    }
    for (const [depName, depVersion] of Object.entries(deps)) {
      if (
        depName.startsWith("@zealakit/") &&
        (depVersion === "workspace:*" || depVersion.startsWith("workspace:"))
      ) {
        deps[depName] = version;
      }
    }
  }
}

function stripInternalOnlyDeps(manifest: PackageJson): void {
  for (const key of WORKSPACE_DEP_KEYS) {
    const deps = manifest[key];
    if (!deps) {
      continue;
    }
    for (const depName of Object.keys(deps)) {
      if (INTERNAL_ONLY_PACKAGES.has(depName)) {
        delete deps[depName];
      }
    }
    if (Object.keys(deps).length === 0) {
      delete manifest[key];
    }
  }
}

function assertNoForbiddenDeps(manifest: PackageJson, context: string): void {
  for (const key of WORKSPACE_DEP_KEYS) {
    const deps = manifest[key];
    if (!deps) {
      continue;
    }
    for (const [depName, depVersion] of Object.entries(deps)) {
      if (INTERNAL_ONLY_PACKAGES.has(depName)) {
        throw new Error(
          `${context}: packed/runtime dependency must not include internal package ${depName}`,
        );
      }
      if (
        typeof depVersion === "string" &&
        (depVersion === "workspace:*" || depVersion.startsWith("workspace:"))
      ) {
        throw new Error(
          `${context}: unresolved workspace protocol for ${depName}@${depVersion}`,
        );
      }
    }
  }
}

function prepareForPublish(
  manifest: PackageJson,
  version: string,
): PackageJson {
  if (INTERNAL_ONLY_PACKAGES.has(manifest.name)) {
    throw new Error(
      `Refusing to prepare internal-only package for publish: ${manifest.name}`,
    );
  }
  const next: PackageJson = structuredClone(manifest);
  next.version = version;
  delete next.private;
  next.publishConfig = { ...next.publishConfig, access: "public" };
  stripInternalOnlyDeps(next);
  pinWorkspaceDeps(next, version);
  assertNoForbiddenDeps(next, `${manifest.name} prepareForPublish`);
  return next;
}

function artifactMissing(
  target: PublishTarget,
  manifest: PackageJson,
): string | null {
  if (target.kind === "platform") {
    const binary = manifest.main;
    if (!binary || !existsSync(join(target.dir, binary))) {
      return `missing native binary (${binary ?? "main"})`;
    }
    return null;
  }

  if (target.kind === "binding") {
    if (!existsSync(join(target.dir, "index.js"))) {
      return "missing packages/binding/index.js (run binding build first)";
    }
    if (!existsSync(join(target.dir, "index.d.ts"))) {
      return "missing packages/binding/index.d.ts (run binding build first)";
    }
    return null;
  }

  if (!existsSync(join(target.dir, "dist"))) {
    return "missing dist/ (run package build first)";
  }
  return null;
}

function listDistFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listDistFiles(fullPath));
      continue;
    }
    if (/\.(js|cjs|mjs|d\.ts|d\.cts)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function assertSharedBundled(target: PublishTarget): void {
  if (target.kind !== "adapter" || !BUNDLES_SHARED.has(target.id)) {
    return;
  }

  const distDir = join(target.dir, "dist");
  if (!existsSync(distDir)) {
    throw new Error(`${target.id}: missing dist/ before shared-bundle check`);
  }

  const files = listDistFiles(distDir);
  const unresolved: string[] = [];
  let sawBundledHelper = false;
  // Match real module imports/requires only. CLI embeds package.json, which may
  // still mention the internal package name under devDependencies.
  const unresolvedImportPattern =
    /(?:from|require\()\s*["']@zealakit\/css-doctor-shared["']/;
  const helperPattern =
    /scanClassOccurrences|clampMinPageRatio|matchesPatterns/;

  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    if (unresolvedImportPattern.test(contents)) {
      unresolved.push(file.replace(`${root}/`, ""));
    }
    if (helperPattern.test(contents)) {
      sawBundledHelper = true;
    }
  }

  if (unresolved.length > 0) {
    throw new Error(
      `${target.id}: dist still references ${SHARED_IMPORT_MARKER}. ` +
        `Rebuild with shared bundled (remove it from tsup external / add noExternal). ` +
        `Files:\n${unresolved.join("\n")}`,
    );
  }

  if (!sawBundledHelper) {
    throw new Error(
      `${target.id}: expected bundled shared helpers in dist/, but no known symbols were found. ` +
        `Build the package after ensuring @zealakit/css-doctor-shared is not externalized.`,
    );
  }
}

function packAndValidateManifest(
  target: PublishTarget,
  prepared: PackageJson,
  packRoot: string,
): void {
  const pack = spawnSync("pnpm", ["pack", "--pack-destination", packRoot], {
    cwd: target.dir,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (pack.status !== 0) {
    throw new Error(
      `${prepared.name}: pnpm pack failed\n${pack.stdout}\n${pack.stderr}`,
    );
  }

  const match = `${pack.stdout}\n${pack.stderr}`.match(/[\w@/.-]+\.tgz/g);
  const tarballName = match?.at(-1)?.split("/").pop();
  if (!tarballName) {
    throw new Error(
      `${prepared.name}: could not parse pnpm pack output:\n${pack.stdout}`,
    );
  }
  const tarball = join(packRoot, tarballName);

  const extracted = spawnSync(
    "tar",
    ["-xOf", tarball, "package/package.json"],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  if (extracted.status !== 0 || !extracted.stdout.trim()) {
    throw new Error(
      `${prepared.name}: failed to read package/package.json from ${tarballName}`,
    );
  }

  const packedManifest = JSON.parse(extracted.stdout) as PackageJson;
  if (INTERNAL_ONLY_PACKAGES.has(packedManifest.name)) {
    throw new Error(
      `Internal-only package was packed for publish: ${packedManifest.name}`,
    );
  }
  assertNoForbiddenDeps(
    packedManifest,
    `${prepared.name} packed tarball (${tarballName})`,
  );
  console.log(`✅ Validated packed manifest ${prepared.name} ← ${tarballName}`);
}

function publishOne(
  target: PublishTarget,
  options: {
    version: string;
    tag: string;
    dryRun: boolean;
    validateOnly: boolean;
    force: boolean;
    skipMissing: boolean;
    packRoot: string;
  },
): "published" | "skipped" | "dry-run" | "validated" {
  const original = readManifest(target.dir);
  const name = original.name;

  if (INTERNAL_ONLY_PACKAGES.has(name) || target.id === SHARED_PACKAGE_DIR) {
    console.log(`⏩ Skipping internal-only package ${name}`);
    return "skipped";
  }

  const missing = artifactMissing(target, original);

  if (missing) {
    if (options.skipMissing) {
      console.log(`⚠️  Skipping ${name}: ${missing}`);
      return "skipped";
    }
    throw new Error(`Cannot publish ${name}: ${missing}`);
  }

  assertSharedBundled(target);

  if (
    !options.force &&
    !options.dryRun &&
    !options.validateOnly &&
    packageExistsOnNpm(name, options.version)
  ) {
    console.log(`⏩ ${name}@${options.version} already on npm. Skipping.`);
    return "skipped";
  }

  const prepared = prepareForPublish(original, options.version);
  writeManifest(target.dir, prepared);

  try {
    packAndValidateManifest(target, prepared, options.packRoot);

    if (options.validateOnly) {
      console.log(`🧪 Validated ${name}@${options.version} (${target.id})`);
      return "validated";
    }

    const args = [
      "publish",
      "--access",
      "public",
      "--tag",
      options.tag,
      "--no-git-checks",
      "--ignore-scripts",
    ];
    if (options.dryRun) {
      args.push("--dry-run");
    }

    console.log(
      `${options.dryRun ? "🧪" : "🚀"} ${options.dryRun ? "Dry-run" : "Publishing"} ${name}@${options.version} (${target.id})`,
    );

    const result = spawnSync("pnpm", args, {
      cwd: target.dir,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });

    if (result.status !== 0) {
      throw new Error(
        `Publish failed for ${name} (exit ${result.status ?? 1})`,
      );
    }

    return options.dryRun ? "dry-run" : "published";
  } finally {
    writeManifest(target.dir, original);
  }
}

function buildTargets(mode: "all" | "binding" | "adapters"): PublishTarget[] {
  const targets: PublishTarget[] = [];

  if (mode === "all" || mode === "binding") {
    for (const platform of PLATFORMS) {
      targets.push({
        id: `binding-${platform}`,
        dir: join(
          root,
          "packages/binding/npm",
          `css-doctor-binding-${platform}`,
        ),
        kind: "platform",
      });
    }
    targets.push({
      id: "binding",
      dir: join(root, "packages/binding"),
      kind: "binding",
    });
  }

  if (mode === "all" || mode === "adapters") {
    for (const dirName of ADAPTER_DIRS) {
      targets.push({
        id: dirName,
        dir: join(root, "packages", dirName),
        kind: "adapter",
      });
    }
  }

  for (const target of targets) {
    if (
      INTERNAL_ONLY_PACKAGES.has(readManifest(target.dir).name) ||
      target.id === SHARED_PACKAGE_DIR
    ) {
      throw new Error(
        `Publish target list incorrectly includes internal package ${target.id}`,
      );
    }
  }

  return targets;
}

function buildInternalShared(): void {
  console.log("Building internal @zealakit/css-doctor-shared…");
  runOrThrow(
    "pnpm",
    ["--filter", "@zealakit/css-doctor-shared", "build"],
    root,
    "shared build",
  );
}

function buildAdapterPackages(): void {
  for (const dirName of ADAPTER_DIRS) {
    const manifest = readManifest(join(root, "packages", dirName));
    console.log(`Building ${manifest.name}…`);
    runOrThrow(
      "pnpm",
      ["--filter", manifest.name, "build"],
      root,
      `${manifest.name} build`,
    );
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const bindingManifest = readManifest(join(root, "packages/binding"));
  const version = bindingManifest.version;
  const tag = resolveNpmTag(version, options.tag);
  const targets = buildTargets(options.mode);

  console.log(`Version: ${version}`);
  console.log(`Dist-tag: ${tag}`);
  console.log(
    `Mode: ${options.mode}${options.dryRun ? " (dry-run)" : ""}${options.validateOnly ? " (validate-only)" : ""}`,
  );
  console.log(`Targets: ${targets.length}`);
  console.log(
    `Internal-only (excluded): ${[...INTERNAL_ONLY_PACKAGES].join(", ")}`,
  );
  console.log("");

  if (options.mode === "all" || options.mode === "adapters") {
    buildInternalShared();
    if (options.validateOnly) {
      buildAdapterPackages();
    }
  }

  const packRoot = mkdtempSync(join(tmpdir(), "cssd-publish-packs-"));
  let published = 0;
  let skipped = 0;
  let dryRun = 0;
  let validated = 0;

  try {
    for (const target of targets) {
      const result = publishOne(target, {
        version,
        tag,
        dryRun: options.dryRun,
        validateOnly: options.validateOnly,
        force: options.force,
        skipMissing: options.skipMissing,
        packRoot,
      });
      if (result === "published") {
        published += 1;
      } else if (result === "dry-run") {
        dryRun += 1;
      } else if (result === "validated") {
        validated += 1;
      } else {
        skipped += 1;
      }
    }
  } finally {
    rmSync(packRoot, { recursive: true, force: true });
  }

  console.log("");
  console.log(
    `Done. published=${published} dry-run=${dryRun} validated=${validated} skipped=${skipped}`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ ${message}`);
  process.exit(1);
}
