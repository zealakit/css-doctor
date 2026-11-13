#!/usr/bin/env node
/**
 * Phase 9 pack verification: pack selected workspace packages, install into a
 * temporary consumer project outside the monorepo, then exercise
 * `css-doctor check --save` and `css-doctor gui --no-open`.
 *
 * Does not publish. Set CSSD_P9_KEEP=1 to retain temp dirs after success.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const guiRoot = resolve(scriptDir, "..");
const repoRoot = resolve(guiRoot, "../..");

const PLATFORM_PACKAGES = {
  "darwin-arm64": {
    dir: "css-doctor-binding-darwin-arm64",
    node: "css-doctor-binding.darwin-arm64.node",
  },
  "darwin-x64": {
    dir: "css-doctor-binding-darwin-x64",
    node: "css-doctor-binding.darwin-x64.node",
  },
  "linux-x64": {
    dir: "css-doctor-binding-linux-x64-gnu",
    node: "css-doctor-binding.linux-x64-gnu.node",
  },
  "win32-x64": {
    dir: "css-doctor-binding-win32-x64-msvc",
    node: "css-doctor-binding.win32-x64-msvc.node",
  },
};

const platformKey = `${process.platform}-${process.arch}`;
const platformSpec = PLATFORM_PACKAGES[platformKey];

function fail(message) {
  process.stderr.write(`verify-consumer-pack: ${message}\n`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed`);
  }
  return result;
}

function packPackage(directory, outDir) {
  const result = spawnSync("pnpm", ["pack", "--pack-destination", outDir], {
    cwd: directory,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`pnpm pack failed in ${directory}\n${result.stdout}\n${result.stderr}`);
  }
  const match = `${result.stdout}\n${result.stderr}`.match(/[\w@/.-]+\.tgz/g);
  const name = match?.at(-1)?.split("/").pop();
  if (!name) {
    fail(`Could not parse pack output for ${directory}:\n${result.stdout}`);
  }
  return join(outDir, name);
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolvePort(port)));
    });
  });
}

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

if (!platformSpec) {
  fail(`Unsupported host platform for pack verification: ${platformKey}`);
}

const platformPkgDir = join(repoRoot, "packages/binding/npm", platformSpec.dir);
const bindingNode = join(repoRoot, "packages/binding", platformSpec.node);
if (!existsSync(bindingNode)) {
  fail(`Missing ${bindingNode}. Build @zealakit/css-doctor-binding first.`);
}

process.stdout.write("verify-consumer-pack: building packages…\n");
run("pnpm", ["--filter", "@zealakit/css-doctor-shared", "build"], {
  cwd: repoRoot,
});
run("pnpm", ["--filter", "@zealakit/css-doctor-vite", "build"], {
  cwd: repoRoot,
});
run("pnpm", ["--filter", "@zealakit/css-doctor-cli", "build"], {
  cwd: repoRoot,
});
run("pnpm", ["--filter", "@zealakit/css-doctor-gui", "build"], { cwd: repoRoot });

copyFileSync(bindingNode, join(platformPkgDir, platformSpec.node));

const packRoot = mkdtempSync(join(tmpdir(), "cssd-p9-packs-"));
const consumerRoot = mkdtempSync(join(tmpdir(), "cssd-p9-consumer-"));
const platformMeta = JSON.parse(
  readFileSync(join(platformPkgDir, "package.json"), "utf8"),
);

process.stdout.write(`verify-consumer-pack: packs → ${packRoot}\n`);
process.stdout.write(`verify-consumer-pack: consumer → ${consumerRoot}\n`);

const tarballs = {
  shared: packPackage(join(repoRoot, "packages/css-doctor-shared"), packRoot),
  binding: packPackage(join(repoRoot, "packages/binding"), packRoot),
  platform: packPackage(platformPkgDir, packRoot),
  vite: packPackage(join(repoRoot, "packages/css-doctor-vite"), packRoot),
  cli: packPackage(join(repoRoot, "packages/cli"), packRoot),
  gui: packPackage(guiRoot, packRoot),
};

for (const [name, path] of Object.entries(tarballs)) {
  process.stdout.write(`  packed ${name}: ${path}\n`);
}

const guiListing = spawnSync("tar", ["-tzf", tarballs.gui], {
  encoding: "utf8",
}).stdout;
if (!guiListing.includes("package/dist/index.html")) {
  fail("GUI tarball missing package/dist/index.html");
}
if (!guiListing.includes("package/dist-server/index.js")) {
  fail("GUI tarball missing package/dist-server/index.js");
}
if (guiListing.includes("package/src/") || guiListing.includes("src-tauri")) {
  fail("GUI tarball unexpectedly includes source or Tauri tree");
}

const packedGuiJson = spawnSync(
  "tar",
  ["-xOf", tarballs.gui, "package/package.json"],
  { encoding: "utf8" },
).stdout;
const packedGui = JSON.parse(packedGuiJson);
if (packedGui.dependencies?.["@zealakit/css-doctor-binding"]?.includes("workspace:")) {
  fail("Packed GUI still contains workspace: dependency protocol");
}
if (packedGui.dependencies?.react) {
  fail("Packed GUI should not list react as a runtime dependency (SPA is prebundled)");
}

writeFileSync(
  join(consumerRoot, "package.json"),
  `${JSON.stringify(
    {
      name: "css-doctor-gui-p9-consumer",
      private: true,
      type: "module",
      devDependencies: {
        "@zealakit/css-doctor-binding": `file:${tarballs.binding}`,
        [platformMeta.name]: `file:${tarballs.platform}`,
        "@zealakit/css-doctor-shared": `file:${tarballs.shared}`,
        "@zealakit/css-doctor-cli": `file:${tarballs.cli}`,
        "@zealakit/css-doctor-vite": `file:${tarballs.vite}`,
        "@zealakit/css-doctor-gui": `file:${tarballs.gui}`,
      },
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  join(consumerRoot, "styles.css"),
  ".hero { color: tomato; }\n.unused-only { display: none; }\n",
);
writeFileSync(
  join(consumerRoot, "vite.config.js"),
  'import { defineConfig } from "vite";\n' +
    'import cssDoctor from "@zealakit/css-doctor-vite";\n' +
    "export default defineConfig({ plugins: [cssDoctor()] });\n",
);

process.stdout.write("verify-consumer-pack: npm install (consumer)…\n");
run("npm", ["install", "--no-fund", "--no-audit"], { cwd: consumerRoot });

process.stdout.write("verify-consumer-pack: css-doctor check --save…\n");
const check = spawnSync(
  "npx",
  ["css-doctor", "check", "styles.css", "--json", "--save"],
  { cwd: consumerRoot, encoding: "utf8" },
);
if (check.status !== 0) {
  fail(`check failed\n${check.stdout}\n${check.stderr}`);
}
const latest = join(consumerRoot, ".css-doctor/reports/check-latest.json");
if (!existsSync(latest)) {
  fail("Expected .css-doctor/reports/check-latest.json after --save");
}

const port = await freePort();
process.stdout.write(`verify-consumer-pack: css-doctor gui --port ${port}…\n`);
const gui = spawn(
  "npx",
  [
    "css-doctor",
    "gui",
    "--port",
    String(port),
    "--strict-port",
    "--no-open",
    "--host",
    "127.0.0.1",
  ],
  {
    cwd: consumerRoot,
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let output = "";
gui.stdout.on("data", (chunk) => {
  output += chunk.toString("utf8");
});
gui.stderr.on("data", (chunk) => {
  output += chunk.toString("utf8");
});

try {
  await waitFor(
    () => /css-doctor gui: web mode|listening on/i.test(output),
    20_000,
    "gui startup",
  );

  if (/analyzeCss|running analysis/i.test(output)) {
    fail("GUI startup unexpectedly mentioned analysis");
  }

  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  if (!health.ok) {
    fail(`/api/health -> ${health.status}`);
  }
  const healthBody = await health.json();
  if (healthBody.service !== "css-doctor-gui") {
    fail(`Unexpected health payload: ${JSON.stringify(healthBody)}`);
  }

  const index = await fetch(`http://127.0.0.1:${port}/`);
  const html = await index.text();
  if (!/<!doctype html>/i.test(html)) {
    fail("Production index.html not served");
  }

  const discover = await fetch(
    `http://127.0.0.1:${port}/api/report/discover?cwd=${encodeURIComponent(consumerRoot)}`,
  );
  if (!discover.ok) {
    fail(`/api/report/discover -> ${discover.status}`);
  }
  const discovered = await discover.json();
  if (!Array.isArray(discovered.reports) || discovered.reports.length < 1) {
    fail(`Expected discovered reports, got ${JSON.stringify(discovered)}`);
  }

  // Missing-GUI consumer: CLI without css-doctor-gui must print install help.
  const absentRoot = mkdtempSync(join(tmpdir(), "cssd-p9-absent-"));
  writeFileSync(
    join(absentRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "css-doctor-gui-p9-absent",
        private: true,
        type: "module",
        devDependencies: {
          "@zealakit/css-doctor-binding": `file:${tarballs.binding}`,
          [platformMeta.name]: `file:${tarballs.platform}`,
          "@zealakit/css-doctor-cli": `file:${tarballs.cli}`,
        },
      },
      null,
      2,
    )}\n`,
  );
  run("npm", ["install", "--no-fund", "--no-audit"], { cwd: absentRoot });
  const missing = spawnSync("npx", ["css-doctor", "gui", "--no-open"], {
    cwd: absentRoot,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
  });
  const missingText = `${missing.stdout}\n${missing.stderr}`;
  if (missing.status === 0 || !/CSS Doctor GUI is not installed/i.test(missingText)) {
    fail(`Expected missing-GUI install help, got status=${missing.status}\n${missingText}`);
  }
  if (
    !/npm install -D @zealakit\/css-doctor-gui|pnpm add -D @zealakit\/css-doctor-gui/.test(
      missingText,
    )
  ) {
    fail(`Missing install command in error:\n${missingText}`);
  }
  if (process.env.CSSD_P9_KEEP !== "1") {
    rmSync(absentRoot, { recursive: true, force: true });
  }

  process.stdout.write("verify-consumer-pack: OK\n");
  process.stdout.write(`  consumer: ${consumerRoot}\n`);
  process.stdout.write(`  packs: ${packRoot}\n`);
} finally {
  gui.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  try {
    gui.kill("SIGKILL");
  } catch {
    // ignore
  }
  if (process.env.CSSD_P9_KEEP !== "1") {
    rmSync(consumerRoot, { recursive: true, force: true });
    rmSync(packRoot, { recursive: true, force: true });
    rmSync(join(platformPkgDir, platformSpec.node), { force: true });
  }
}
