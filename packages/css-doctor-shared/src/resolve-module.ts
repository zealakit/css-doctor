/**
 * Dependency-free module resolver for static source scanning.
 *
 * Handles relative imports, tsconfig/jsconfig `paths` + `baseUrl` (following
 * `extends`), and workspace packages via `package.json` `exports` / `main`.
 * Adapters prefer their bundler's resolver and fall back to this one.
 *
 * Never throws: unresolvable imports return `{ kind: "unresolved" }`.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

export type ResolveResult =
  | { kind: "file"; path: string }
  /** Third-party package (not a workspace link); intentionally not scanned. */
  | { kind: "external" }
  /** Style asset (css/scss/...); handled elsewhere. */
  | { kind: "style" }
  | { kind: "unresolved" };

export type ModuleResolverOptions = {
  /** Extra directories tried for `@/...`-style fallbacks (e.g. `src/`). */
  fallbackRoots?: readonly string[];
  extensions?: readonly string[];
};

export type ModuleResolver = {
  resolve(specifier: string, importer: string): ResolveResult;
  /** Drops cached tsconfig/package lookups and resolutions. */
  clear(): void;
};

const DEFAULT_EXTENSIONS = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".mdx",
  ".vue",
  ".svelte",
  ".astro",
];
const STYLE_RE = /\.(css|scss|sass|less|styl|stylus|pcss)(\?.*)?$/i;
const EXPORT_CONDITIONS = ["import", "module", "default", "require", "node"];

type PathsConfig = {
  baseDir: string;
  paths: Array<{ pattern: string; targets: string[] }>;
  hasBaseUrl: boolean;
};

export function createModuleResolver(
  options: ModuleResolverOptions = {},
): ModuleResolver {
  const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
  const fallbackRoots = options.fallbackRoots ?? [];
  const resolutions = new Map<string, ResolveResult>();
  const tsconfigByDir = new Map<string, PathsConfig | null>();

  function probe(base: string): string | null {
    if (isFile(base)) {
      return base;
    }
    for (const ext of extensions) {
      if (isFile(base + ext)) {
        return base + ext;
      }
    }
    for (const ext of extensions) {
      const candidate = join(base, `index${ext}`);
      if (isFile(candidate)) {
        return candidate;
      }
    }
    return null;
  }

  function fromBase(base: string): ResolveResult {
    if (STYLE_RE.test(base)) {
      return { kind: "style" };
    }
    const found = probe(base);
    if (!found) {
      return { kind: "unresolved" };
    }
    return STYLE_RE.test(found)
      ? { kind: "style" }
      : { kind: "file", path: found };
  }

  function pathsFor(dir: string): PathsConfig | null {
    if (tsconfigByDir.has(dir)) {
      return tsconfigByDir.get(dir) ?? null;
    }
    let found: PathsConfig | null = null;
    for (const name of ["tsconfig.json", "jsconfig.json"]) {
      const file = join(dir, name);
      if (existsSync(file)) {
        found = loadPathsConfig(file, new Set());
        break;
      }
    }
    if (!found) {
      const parent = dirname(dir);
      found = parent !== dir ? pathsFor(parent) : null;
    }
    tsconfigByDir.set(dir, found);
    return found;
  }

  function viaPaths(specifier: string, importer: string): ResolveResult | null {
    const config = pathsFor(dirname(importer));
    if (!config) {
      return null;
    }
    let matched = false;
    for (const { pattern, targets } of config.paths) {
      const captured = matchPattern(pattern, specifier);
      if (captured === null) {
        continue;
      }
      matched = true;
      for (const target of targets) {
        const result = fromBase(
          resolve(config.baseDir, target.replace("*", captured)),
        );
        if (result.kind !== "unresolved") {
          return result;
        }
      }
    }
    if (matched) {
      // An alias claimed the specifier but no target exists: do not fall
      // through to node_modules lookup.
      return { kind: "unresolved" };
    }
    if (config.hasBaseUrl && !specifier.startsWith(".")) {
      const result = fromBase(resolve(config.baseDir, specifier));
      if (result.kind !== "unresolved") {
        return result;
      }
    }
    return null;
  }

  function viaPackage(specifier: string, importer: string): ResolveResult {
    const parts = specifier.split("/");
    const nameLength = specifier.startsWith("@") ? 2 : 1;
    const packageName = parts.slice(0, nameLength).join("/");
    const subpath = parts.slice(nameLength).join("/");
    if (!packageName || (specifier.startsWith("@") && parts.length < 2)) {
      return { kind: "unresolved" };
    }

    let dir = dirname(importer);
    for (;;) {
      const candidate = join(dir, "node_modules", packageName);
      if (existsSync(candidate)) {
        let real = candidate;
        try {
          real = realpathSync(candidate);
        } catch {
          // keep candidate
        }
        if (real.split(sep).includes("node_modules")) {
          return { kind: "external" };
        }
        return resolvePackageEntry(real, subpath, fromBase);
      }
      const parent = dirname(dir);
      if (parent === dir) {
        return { kind: "external" };
      }
      dir = parent;
    }
  }

  function resolveUncached(specifier: string, importer: string): ResolveResult {
    if (STYLE_RE.test(specifier)) {
      return { kind: "style" };
    }
    if (specifier.startsWith(".")) {
      return fromBase(resolve(dirname(importer), specifier));
    }
    if (isAbsolute(specifier)) {
      return fromBase(specifier);
    }
    const aliased = viaPaths(specifier, importer);
    if (aliased) {
      return aliased;
    }
    if (specifier.startsWith("@/") || specifier.startsWith("~/")) {
      for (const root of fallbackRoots) {
        const result = fromBase(resolve(root, specifier.slice(2)));
        if (result.kind !== "unresolved") {
          return result;
        }
      }
      return { kind: "unresolved" };
    }
    if (/^(node:|data:|https?:)/.test(specifier)) {
      return { kind: "external" };
    }
    return viaPackage(specifier, importer);
  }

  return {
    resolve(specifier, importer) {
      const key = `${importer}\0${specifier}`;
      const cached = resolutions.get(key);
      if (cached) {
        return cached;
      }
      let result: ResolveResult;
      try {
        result = resolveUncached(specifier, importer);
      } catch {
        result = { kind: "unresolved" };
      }
      resolutions.set(key, result);
      return result;
    },
    clear() {
      resolutions.clear();
      tsconfigByDir.clear();
    },
  };
}

function resolvePackageEntry(
  packageDir: string,
  subpath: string,
  fromBase: (base: string) => ResolveResult,
): ResolveResult {
  const manifest = readJson(join(packageDir, "package.json"));
  const key = subpath ? `./${subpath}` : ".";
  const candidates: string[] = [];

  if (manifest?.exports !== undefined) {
    const target = pickExport(manifest.exports, key);
    if (target) {
      candidates.push(resolve(packageDir, target));
    }
  } else if (!subpath) {
    for (const field of ["module", "main"]) {
      const value = manifest?.[field];
      if (typeof value === "string") {
        candidates.push(resolve(packageDir, value));
      }
    }
  } else {
    candidates.push(resolve(packageDir, subpath));
  }

  // Built output may not exist (or is generated): map dist/* back to src/*.
  for (const candidate of [...candidates]) {
    const rel = candidate.slice(packageDir.length + 1);
    const mapped = rel.replace(/^(?:dist|build|lib)[\\/]/, `src${sep}`);
    if (mapped !== rel) {
      candidates.push(join(packageDir, mapped.replace(/\.(c|m)?js$/, "")));
    }
  }
  if (!subpath) {
    candidates.push(join(packageDir, "src", "index"));
  }

  for (const candidate of candidates) {
    const stripped = candidate.replace(/\.(c|m)?js$/, "");
    for (const base of [candidate, stripped]) {
      const result = fromBase(base);
      if (result.kind !== "unresolved") {
        return result;
      }
    }
  }
  return { kind: "unresolved" };
}

function pickExport(exportsField: unknown, key: string): string | null {
  if (typeof exportsField === "string") {
    return key === "." ? exportsField : null;
  }
  if (!exportsField || typeof exportsField !== "object") {
    return null;
  }
  const record = exportsField as Record<string, unknown>;
  const hasSubpaths = Object.keys(record).some((k) => k.startsWith("."));
  if (!hasSubpaths) {
    return key === "." ? pickCondition(record) : null;
  }
  if (key in record) {
    return pickCondition(record[key]);
  }
  for (const [pattern, value] of Object.entries(record)) {
    const captured = matchPattern(pattern, key);
    if (captured !== null) {
      const target = pickCondition(value);
      return target ? target.replace("*", captured) : null;
    }
  }
  return null;
}

function pickCondition(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickCondition(item);
      if (picked) {
        return picked;
      }
    }
    return null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const condition of EXPORT_CONDITIONS) {
      if (condition in record) {
        const picked = pickCondition(record[condition]);
        if (picked) {
          return picked;
        }
      }
    }
  }
  return null;
}

/** Returns the `*` capture (or "" for exact patterns), or null on mismatch. */
function matchPattern(pattern: string, value: string): string | null {
  const star = pattern.indexOf("*");
  if (star < 0) {
    return pattern === value ? "" : null;
  }
  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);
  if (
    value.length >= prefix.length + suffix.length &&
    value.startsWith(prefix) &&
    value.endsWith(suffix)
  ) {
    return value.slice(prefix.length, value.length - suffix.length);
  }
  return null;
}

function loadPathsConfig(file: string, seen: Set<string>): PathsConfig | null {
  if (seen.has(file)) {
    return null;
  }
  seen.add(file);
  const json = readJson(file);
  if (!json) {
    return null;
  }

  let inherited: PathsConfig | null = null;
  const extendsValue = json.extends;
  const parents = Array.isArray(extendsValue) ? extendsValue : [extendsValue];
  for (const parent of parents) {
    if (typeof parent !== "string") {
      continue;
    }
    const target = resolveExtends(parent, dirname(file));
    if (target) {
      inherited = loadPathsConfig(target, seen) ?? inherited;
    }
  }

  const compiler = (json.compilerOptions ?? {}) as Record<string, unknown>;
  const baseUrl =
    typeof compiler.baseUrl === "string" ? compiler.baseUrl : undefined;
  const rawPaths =
    compiler.paths && typeof compiler.paths === "object"
      ? (compiler.paths as Record<string, unknown>)
      : undefined;

  // `paths` resolve against baseUrl when set, otherwise the config's own dir.
  const baseDir = baseUrl
    ? resolve(dirname(file), baseUrl)
    : rawPaths
      ? dirname(file)
      : (inherited?.baseDir ?? dirname(file));

  const paths = rawPaths
    ? Object.entries(rawPaths).map(([pattern, targets]) => ({
        pattern,
        targets: Array.isArray(targets)
          ? targets.filter((t): t is string => typeof t === "string")
          : [],
      }))
    : (inherited?.paths ?? []);

  return {
    baseDir,
    paths,
    hasBaseUrl: Boolean(baseUrl) || (inherited?.hasBaseUrl ?? false),
  };
}

function resolveExtends(value: string, fromDir: string): string | null {
  if (value.startsWith(".") || isAbsolute(value)) {
    const base = resolve(fromDir, value);
    for (const candidate of [
      base,
      `${base}.json`,
      join(base, "tsconfig.json"),
    ]) {
      if (isFile(candidate)) {
        return candidate;
      }
    }
    return null;
  }
  // Package-based extends (`@scope/tsconfig/base.json`).
  let dir = fromDir;
  for (;;) {
    for (const suffix of ["", ".json", "/tsconfig.json"]) {
      const candidate = join(dir, "node_modules", value + suffix);
      if (isFile(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const text = readFileSync(file, "utf8");
    const parsed = JSON.parse(stripJsonComments(text)) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** tsconfig allows comments and trailing commas. */
function stripJsonComments(text: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? "";
    if (inString) {
      out += char;
      if (char === "\\") {
        out += text[i + 1] ?? "";
        i += 1;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") {
        i += 1;
      }
      out += "\n";
    } else if (char === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        i += 1;
      }
      i += 1;
    } else {
      out += char;
    }
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
