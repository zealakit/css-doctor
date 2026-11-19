/**
 * Regression snapshots of the CSS that `examples/*` builds emit.
 *
 * Builds each example (output directory cleaned first), analyses every emitted
 * CSS file with the native binding and compares against
 * `examples/css-snapshots.json`: hash-normalized file names, rule and selector
 * counts (exact) and byte size (within a small tolerance).
 *
 *   pnpm snapshot:examples            # verify
 *   pnpm snapshot:examples --update   # accept the current output
 *   pnpm snapshot:examples --only vite-react-tailwind
 *
 * Default behavior is guarded by this: a change in emitted chunks for an
 * unchanged example fails the check until the snapshot is reviewed and updated.
 */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type ExampleSpec = {
  /** Directory under `examples/`. */
  dir: string;
  /** Output directories removed before the build and scanned afterwards. */
  outputs: string[];
};

type CssEntry = {
  file: string;
  bytes: number;
  rules: number;
  selectors: number;
};

type SnapshotFile = {
  schemaVersion: 1;
  /** Allowed relative byte-size drift (0.01 = 1%). */
  byteTolerance: number;
  examples: Record<string, CssEntry[]>;
};

/** Examples covered by the snapshot (nuxt and remix do not emit comparable CSS). */
const EXAMPLES: ExampleSpec[] = [
  { dir: "vite-react-tailwind", outputs: ["dist"] },
  { dir: "vite-react-3rd-ui", outputs: ["dist"] },
  { dir: "vite-svelte-tailwind", outputs: ["dist"] },
  { dir: "vite-vue-tailwind", outputs: ["dist"] },
  { dir: "rsbuild-react-tailwind", outputs: ["dist"] },
  { dir: "astro-tailwind-sass", outputs: ["dist"] },
  { dir: "next-app-tailwind", outputs: [".next"] },
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = join(root, "examples", "css-snapshots.json");
const args = process.argv.slice(2);
const update = args.includes("--update");
const onlyIndex = args.indexOf("--only");
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : undefined;
const byteTolerance = 0.01;

const require = createRequire(join(root, "packages/binding/package.json"));
const binding = require("./index.js") as {
  analyzeCss(css: string): {
    stats: { ruleCount: number; selectorCount: number };
  };
};

main();

function main(): void {
  const selected = EXAMPLES.filter((example) => !only || example.dir === only);
  if (selected.length === 0) {
    fail(`No example named "${only}".`);
  }

  const current: Record<string, CssEntry[]> = {};
  for (const example of selected) {
    current[example.dir] = buildAndCollect(example);
  }

  const previous = readSnapshot();

  if (update) {
    const next: SnapshotFile = {
      schemaVersion: 1,
      byteTolerance,
      examples: { ...(previous?.examples ?? {}), ...current },
    };
    writeFileSync(snapshotPath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(
      `Updated ${relative(root, snapshotPath)} (${selected.length} example(s)).`,
    );
    return;
  }

  if (!previous) {
    fail(
      `Missing ${relative(root, snapshotPath)}; run with --update to create it.`,
    );
  }

  const problems: string[] = [];
  for (const [name, entries] of Object.entries(current)) {
    const expected = previous.examples[name];
    if (!expected) {
      problems.push(`${name}: no snapshot recorded (run --update).`);
      continue;
    }
    problems.push(...compare(name, expected, entries, previous.byteTolerance));
  }

  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(
      "\nCSS output changed. Review the diff, then run `pnpm snapshot:examples --update`.",
    );
    process.exit(1);
  }
  console.log(`CSS snapshots match for ${selected.length} example(s).`);
}

function buildAndCollect(example: ExampleSpec): CssEntry[] {
  const exampleRoot = join(root, "examples", example.dir);
  for (const output of example.outputs) {
    rmSync(join(exampleRoot, output), { recursive: true, force: true });
  }

  const packageName = JSON.parse(
    readFileSync(join(exampleRoot, "package.json"), "utf8"),
  ).name as string;
  console.log(`Building ${example.dir}…`);
  const result = spawnSync("pnpm", ["--filter", packageName, "build"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (result.status !== 0) {
    fail(`${example.dir}: build failed\n${result.stdout}\n${result.stderr}`);
  }

  const entries: CssEntry[] = [];
  for (const output of example.outputs) {
    for (const file of findCss(join(exampleRoot, output))) {
      const css = readFileSync(file, "utf8");
      let rules = 0;
      let selectors = 0;
      if (css.trim().length > 0) {
        const { stats } = binding.analyzeCss(css);
        rules = stats.ruleCount;
        selectors = stats.selectorCount;
      }
      entries.push({
        file: normalizeName(file),
        bytes: Buffer.byteLength(css),
        rules,
        selectors,
      });
    }
  }
  return entries.sort(
    (a, b) => a.file.localeCompare(b.file) || a.bytes - b.bytes,
  );
}

function findCss(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      out.push(...findCss(path));
    } else if (extname(entry) === ".css") {
      out.push(path);
    }
  }
  return out;
}

/** Drops content hashes so names are stable across rebuilds. */
function normalizeName(file: string): string {
  const name = basename(file, ".css");
  if (/^[0-9a-f]{16}$/.test(name)) {
    return "<hash>.css";
  }
  // `name.<hash>` (Rsbuild, Next, Astro) or Vite's `name-<8 chars>`, where the
  // hash itself may contain dashes.
  const stem = /\.[A-Za-z0-9_]{8,10}$/.test(name)
    ? name.replace(/\.[A-Za-z0-9_]{8,10}$/, "")
    : name.replace(/-[A-Za-z0-9_-]{8}$/, "");
  return `${stem}.css`;
}

function compare(
  name: string,
  expected: CssEntry[],
  actual: CssEntry[],
  tolerance: number,
): string[] {
  const problems: string[] = [];
  if (expected.length !== actual.length) {
    problems.push(
      `${name}: ${actual.length} CSS file(s), expected ${expected.length}`,
    );
  }
  const count = Math.min(expected.length, actual.length);
  for (let index = 0; index < count; index += 1) {
    const want = expected[index] as CssEntry;
    const got = actual[index] as CssEntry;
    if (want.file !== got.file) {
      problems.push(
        `${name}: file ${index} is ${got.file}, expected ${want.file}`,
      );
      continue;
    }
    if (want.rules !== got.rules || want.selectors !== got.selectors) {
      problems.push(
        `${name}/${got.file}: rules ${got.rules} selectors ${got.selectors}, expected rules ${want.rules} selectors ${want.selectors}`,
      );
    }
    const drift =
      want.bytes === 0
        ? got.bytes
        : Math.abs(got.bytes - want.bytes) / want.bytes;
    if (drift > tolerance) {
      problems.push(
        `${name}/${got.file}: ${got.bytes} bytes, expected ${want.bytes} (±${tolerance * 100}%)`,
      );
    }
  }
  return problems;
}

function readSnapshot(): SnapshotFile | null {
  try {
    return JSON.parse(readFileSync(snapshotPath, "utf8")) as SnapshotFile;
  } catch {
    return null;
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
