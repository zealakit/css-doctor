/**
 * Publish all @zealamic/css-doctor* packages (doc / patch republish fallback).
 *
 * Order matches the old release pipeline:
 *   1) platform binaries
 *   2) main binding
 *   3) adapters + CLI
 *
 * Temporarily pins `workspace:*` @zealamic deps to the release version, then
 * restores the original manifests after each publish. Optionally bumps the
 * patch version across packages and re-applies npm deprecation messages.
 *
 * Usage:
 *   pnpm publish:npm
 *   pnpm publish:npm:dry
 *   tsx scripts/publish-npm.ts --bump-patch --deprecate
 *   tsx scripts/publish-npm.ts --help
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = {
  name: string;
  version: string;
  private?: boolean;
  main?: string;
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

const PLATFORMS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-x64-gnu",
  "linux-x64-musl",
  "win32-x64-msvc",
] as const;

const ADAPTER_DIRS = [
  "css-doctor-vite",
  "css-doctor-rsbuild",
  "css-doctor-remix",
  "css-doctor-nuxt",
  "css-doctor-next",
  "cli",
] as const;

const WORKSPACE_DEP_KEYS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function printHelp(): void {
  console.log(`Publish all @zealamic/css-doctor* packages to npm.

Usage:
  tsx scripts/publish-npm.ts [options]

Options:
  --bump-patch     Bump every package patch version before publish (1.0.1 -> 1.0.2)
  --version <ver>  Force every package to this version (overrides --bump-patch)
  --deprecate      Re-apply npm deprecate messages after a successful publish
  --dry-run        Run npm/pnpm publish --dry-run
  --skip-missing   Skip packages whose build artifacts are missing
  --force          Publish even if the version already exists on npm
  -h, --help       Show help

Root scripts:
  pnpm publish:npm
  pnpm publish:npm:dry
`);
}

function parseArgs(argv: string[]): {
  bumpPatch: boolean;
  version: string | null;
  deprecate: boolean;
  dryRun: boolean;
  skipMissing: boolean;
  force: boolean;
  help: boolean;
} {
  let bumpPatch = false;
  let version: string | null = null;
  let deprecate = false;
  let dryRun = false;
  let skipMissing = false;
  let force = false;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    switch (arg) {
      case "--bump-patch":
        bumpPatch = true;
        break;
      case "--deprecate":
        deprecate = true;
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--skip-missing":
        skipMissing = true;
        break;
      case "--force":
        force = true;
        break;
      case "--version": {
        const next = argv[i + 1];
        if (!next || next.startsWith("-")) {
          throw new Error("--version requires a value");
        }
        version = next;
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

  return { bumpPatch, version, deprecate, dryRun, skipMissing, force, help };
}

function readManifest(dir: string): PackageJson {
  return JSON.parse(
    readFileSync(join(dir, "package.json"), "utf8"),
  ) as PackageJson;
}

function writeManifest(dir: string, manifest: PackageJson): void {
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function bumpPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version);
  if (
    !match ||
    match[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  ) {
    throw new Error(`Cannot bump non-semver version: ${version}`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  const suffix = match[4] ?? "";
  return `${major}.${minor}.${patch + 1}${suffix}`;
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

function pinWorkspaceDeps(manifest: PackageJson, version: string): void {
  for (const key of WORKSPACE_DEP_KEYS) {
    const deps = manifest[key];
    if (!deps) {
      continue;
    }
    for (const [depName, depVersion] of Object.entries(deps)) {
      if (
        depName.startsWith("@zealamic/") &&
        (depVersion === "workspace:*" || depVersion.startsWith("workspace:"))
      ) {
        deps[depName] = version;
      }
    }
  }
}

function prepareForPublish(
  manifest: PackageJson,
  version: string,
): PackageJson {
  const next: PackageJson = structuredClone(manifest);
  next.version = version;
  delete next.private;
  next.publishConfig = { ...next.publishConfig, access: "public" };
  pinWorkspaceDeps(next, version);
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
      return "missing packages/binding/index.js";
    }
    if (!existsSync(join(target.dir, "index.d.ts"))) {
      return "missing packages/binding/index.d.ts";
    }
    return null;
  }

  if (!existsSync(join(target.dir, "dist"))) {
    return "missing dist/";
  }
  return null;
}

function deprecateMessage(oldName: string): string {
  const newName = oldName.replace("@zealamic/", "@zealakit/");
  return (
    `DEPRECATED: moved to ${newName}. ` +
    `Install with: npm i ${newName} — ` +
    `https://github.com/zealakit/css-doctor`
  );
}

function buildTargets(): PublishTarget[] {
  const targets: PublishTarget[] = [];

  for (const platform of PLATFORMS) {
    targets.push({
      id: `binding-${platform}`,
      dir: join(root, "packages/binding/npm", `css-doctor-binding-${platform}`),
      kind: "platform",
    });
  }

  targets.push({
    id: "binding",
    dir: join(root, "packages/binding"),
    kind: "binding",
  });

  for (const dirName of ADAPTER_DIRS) {
    targets.push({
      id: dirName,
      dir: join(root, "packages", dirName),
      kind: "adapter",
    });
  }

  return targets;
}

function setPersistedVersion(target: PublishTarget, version: string): void {
  const manifest = readManifest(target.dir);
  if (manifest.version === version) {
    return;
  }
  manifest.version = version;
  writeManifest(target.dir, manifest);
}

function publishOne(
  target: PublishTarget,
  options: {
    version: string;
    dryRun: boolean;
    force: boolean;
    skipMissing: boolean;
  },
): "published" | "skipped" | "dry-run" {
  const original = readManifest(target.dir);
  const name = original.name;
  const missing = artifactMissing(target, original);

  if (missing) {
    if (options.skipMissing) {
      console.log(`⚠️  Skipping ${name}: ${missing}`);
      return "skipped";
    }
    throw new Error(`Cannot publish ${name}: ${missing}`);
  }

  if (
    !options.force &&
    !options.dryRun &&
    packageExistsOnNpm(name, options.version)
  ) {
    console.log(`⏩ ${name}@${options.version} already on npm. Skipping.`);
    return "skipped";
  }

  const prepared = prepareForPublish(original, options.version);
  writeManifest(target.dir, prepared);

  try {
    const args = [
      "publish",
      "--access",
      "public",
      "--no-git-checks",
      "--ignore-scripts",
    ];
    if (options.dryRun) {
      args.push("--dry-run");
    }

    console.log(
      `${options.dryRun ? "🧪" : "🚀"} ${options.dryRun ? "Dry-run" : "Publishing"} ${name}@${options.version}`,
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
    // Restore workspace:* manifests, then keep the bumped version on disk.
    const restored = structuredClone(original);
    restored.version = options.version;
    writeManifest(target.dir, restored);
  }
}

function deprecatePackage(name: string, dryRun: boolean): void {
  const message = deprecateMessage(name);
  const args = ["deprecate", name, message];
  if (dryRun) {
    console.log(`🧪 npm ${args.map((part) => JSON.stringify(part)).join(" ")}`);
    return;
  }
  console.log(`⚠️  npm deprecate ${name}`);
  const result = spawnSync("npm", args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`npm deprecate failed for ${name}`);
  }
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const targets = buildTargets();
  const binding = readManifest(join(root, "packages/binding"));
  const version =
    options.version ??
    (options.bumpPatch ? bumpPatchVersion(binding.version) : binding.version);

  console.log(`Version: ${version}`);
  console.log(`Dry-run: ${options.dryRun}`);
  console.log(`Targets: ${targets.length}`);
  console.log("");

  if (options.bumpPatch || options.version) {
    for (const target of targets) {
      setPersistedVersion(target, version);
    }
    // Keep root workspace version in sync for convenience.
    const rootManifest = readManifest(root);
    rootManifest.version = version;
    writeManifest(root, rootManifest);
    console.log(`Set package versions -> ${version}`);
    console.log("");
  }

  let published = 0;
  let skipped = 0;
  let dryRun = 0;
  const publishedNames: string[] = [];

  for (const target of targets) {
    const result = publishOne(target, {
      version,
      dryRun: options.dryRun,
      force: options.force,
      skipMissing: options.skipMissing,
    });
    const name = readManifest(target.dir).name;
    if (result === "published") {
      published += 1;
      publishedNames.push(name);
    } else if (result === "dry-run") {
      dryRun += 1;
      publishedNames.push(name);
    } else {
      skipped += 1;
    }
  }

  if (options.deprecate) {
    console.log("");
    console.log("Re-applying npm deprecation messages...");
    for (const name of publishedNames) {
      deprecatePackage(name, options.dryRun);
    }
  }

  console.log("");
  console.log(
    `Done. published=${published} dry-run=${dryRun} skipped=${skipped}`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n❌ ${message}`);
  process.exit(1);
}
