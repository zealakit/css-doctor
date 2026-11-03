/**
 * Manual npm publish fallback when GitHub Actions release jobs fail.
 *
 * Mirrors release-step-1 / release-step-2 order:
 *   1) platform .node packages
 *   2) main binding loader
 *   3) adapters + CLI (vite → rsbuild → remix → nuxt → next → cli)
 *
 * Temporarily rewrites `workspace:*` @zealakit deps to the package version,
 * then restores the original package.json files.
 *
 * Usage:
 *   pnpm publish:npm
 *   pnpm publish:npm:binding
 *   pnpm publish:npm:adapters
 *   pnpm publish:npm:dry
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
  console.log(`Manual npm publish for @zealakit/css-doctor packages.

Usage:
  tsx scripts/publish-npm.ts [options]

Options:
  --all           Publish binding platforms + loader + adapters (default)
  --binding       Publish only platform binaries + main binding
  --adapters      Publish only vite/rsbuild/remix/nuxt/next/cli
  --dry-run       Run npm publish --dry-run (no registry write)
  --tag <tag>     npm dist-tag (default: latest, or beta for pre-release versions)
  --force         Publish even if the version already exists on npm
  --skip-missing  Skip packages whose build artifacts are missing
  -h, --help      Show this help

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
  tag: string | null;
  force: boolean;
  skipMissing: boolean;
  help: boolean;
} {
  let mode: "all" | "binding" | "adapters" = "all";
  let dryRun = false;
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

  return { mode, dryRun, tag, force, skipMissing, help };
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

function publishOne(
  target: PublishTarget,
  options: {
    version: string;
    tag: string;
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

  return targets;
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
  console.log(`Mode: ${options.mode}${options.dryRun ? " (dry-run)" : ""}`);
  console.log(`Targets: ${targets.length}`);
  console.log("");

  let published = 0;
  let skipped = 0;
  let dryRun = 0;

  for (const target of targets) {
    const result = publishOne(target, {
      version,
      tag,
      dryRun: options.dryRun,
      force: options.force,
      skipMissing: options.skipMissing,
    });
    if (result === "published") {
      published += 1;
    } else if (result === "dry-run") {
      dryRun += 1;
    } else {
      skipped += 1;
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
