import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

import { atomicWriteFile } from "../utils/atomic-write";
import { extractRules } from "./extract-rules";
import type { NormalizedCoverageEntry } from "./parse-coverage";

export const DEFAULT_COVERAGE_PATH = ".css-doctor/coverage.json";
export const COVERAGE_SCHEMA_VERSION = 1;

/** Runtime verdict for one selector, as consumed by the confidence model. */
export type RuntimeVerdict = "hit" | "coveredUnused";

export type CoverageStoreEntry = {
  route: string;
  /** Explicit build id, or `""` when the import did not supply one. */
  buildId: string;
  stylesheetUrl: string;
  /** Hash of the built CSS the ranges were measured against. */
  cssHash: string;
  /** Selectors whose rule overlapped a used range. */
  used: string[];
  /** Selectors of rules that never overlapped a used range. */
  unused: string[];
  importedAt: string;
};

export type CoverageFile = {
  schemaVersion: typeof COVERAGE_SCHEMA_VERSION;
  entries: CoverageStoreEntry[];
};

/** Route map: URL path pattern -> app route. `*`, `:id` and `[id]` match one segment. */
export type RouteMap = Record<string, string>;

export function emptyCoverageFile(): CoverageFile {
  return { schemaVersion: COVERAGE_SCHEMA_VERSION, entries: [] };
}

export function hashText(text: string): string {
  return createHash("sha1").update(text).digest("hex").slice(0, 16);
}

/** Collapses whitespace so selectors compare across tools. */
export function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, " ").trim();
}

/** Maps a page URL to an app route (`/blog/123` -> `/blog/[id]`). */
export function resolveRoute(pageUrl: string, routeMap: RouteMap = {}): string {
  const path = pathnameOf(pageUrl);
  for (const [pattern, route] of Object.entries(routeMap)) {
    if (patternToRegExp(pattern).test(path)) {
      return route;
    }
  }
  return path;
}

function pathnameOf(pageUrl: string): string {
  if (!pageUrl) {
    return "/";
  }
  let path = pageUrl;
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    path = pageUrl.split(/[?#]/)[0] ?? pageUrl;
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

function patternToRegExp(pattern: string): RegExp {
  const source = pattern
    .split("/")
    .map((segment) => {
      if (segment === "**") {
        return ".*";
      }
      if (
        segment === "*" ||
        /^:[\w-]+$/.test(segment) ||
        /^\[[^\]]+\]$/.test(segment)
      ) {
        return "[^/]+";
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${source}$`);
}

/** Splits one stylesheet's rules into used / unused selectors. */
export function classifySelectors(entry: NormalizedCoverageEntry): {
  used: string[];
  unused: string[];
} {
  const used = new Set<string>();
  const unused = new Set<string>();
  for (const rule of extractRules(entry.text)) {
    const isUsed = entry.usedRanges.some(
      (range) => range.start < rule.end && range.end > rule.start,
    );
    for (const selector of rule.selectors) {
      (isUsed ? used : unused).add(normalizeSelector(selector));
    }
  }
  // A selector used by any rule occurrence is used.
  for (const selector of used) {
    unused.delete(selector);
  }
  return { used: [...used].sort(), unused: [...unused].sort() };
}

export type ImportOptions = {
  routeMap?: RouteMap;
  buildId?: string;
  now?: Date;
};

/** Merges normalized entries into `file` (union of used; unused only if never used). */
export function mergeCoverage(
  file: CoverageFile,
  entries: NormalizedCoverageEntry[],
  options: ImportOptions = {},
): CoverageFile {
  const buildId = options.buildId ?? "";
  const importedAt = (options.now ?? new Date()).toISOString();
  const merged = new Map(
    file.entries.map((entry) => [keyOf(entry), { ...entry }]),
  );

  for (const raw of entries) {
    const route = resolveRoute(raw.pageUrl, options.routeMap);
    const { used, unused } = classifySelectors(raw);
    const cssHash = hashText(raw.text);
    const incoming: CoverageStoreEntry = {
      route,
      buildId,
      stylesheetUrl: raw.stylesheetUrl,
      cssHash,
      used,
      unused,
      importedAt,
    };
    const key = keyOf(incoming);
    const existing = merged.get(key);
    if (existing && existing.cssHash === cssHash) {
      const usedSet = new Set([...existing.used, ...used]);
      const unusedSet = new Set(
        [...existing.unused, ...unused].filter((s) => !usedSet.has(s)),
      );
      merged.set(key, {
        ...incoming,
        used: [...usedSet].sort(),
        unused: [...unusedSet].sort(),
      });
    } else {
      merged.set(key, incoming);
    }
  }

  return {
    schemaVersion: COVERAGE_SCHEMA_VERSION,
    entries: [...merged.values()].sort((a, b) =>
      keyOf(a).localeCompare(keyOf(b)),
    ),
  };
}

function keyOf(entry: CoverageStoreEntry): string {
  return `${entry.route}\u0000${entry.buildId}\u0000${entry.stylesheetUrl}`;
}

export async function readCoverageFile(path: string): Promise<CoverageFile> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyCoverageFile();
    }
    throw error;
  }
  const parsed = JSON.parse(text) as Partial<CoverageFile>;
  if (
    parsed.schemaVersion !== COVERAGE_SCHEMA_VERSION ||
    !Array.isArray(parsed.entries)
  ) {
    throw new Error(
      `Unsupported coverage file ${path}: expected schemaVersion ${COVERAGE_SCHEMA_VERSION}.`,
    );
  }
  return { schemaVersion: COVERAGE_SCHEMA_VERSION, entries: parsed.entries };
}

export async function writeCoverageFile(
  path: string,
  file: CoverageFile,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await atomicWriteFile(path, `${JSON.stringify(file, null, 2)}\n`);
}

export type RuntimeEvidenceResult = {
  /** Normalized selector -> runtime verdict. */
  verdicts: Map<string, RuntimeVerdict>;
  /** Routes whose coverage contributed. */
  routes: string[];
  /** Stale or mismatched entries that were NOT applied. */
  warnings: string[];
};

export type LoadEvidenceOptions = {
  /** Only apply entries imported with this build id. */
  buildId?: string;
  /** Current built CSS hashes by stylesheet URL; mismatching entries are stale. */
  cssHashes?: Record<string, string>;
};

/**
 * Derives per-selector runtime verdicts. Stale entries (different build id or
 * different CSS hash) are reported as warnings and never applied silently.
 */
export function runtimeEvidenceFrom(
  file: CoverageFile,
  options: LoadEvidenceOptions = {},
): RuntimeEvidenceResult {
  const verdicts = new Map<string, RuntimeVerdict>();
  const routes = new Set<string>();
  const warnings: string[] = [];

  for (const entry of file.entries) {
    if (options.buildId !== undefined && entry.buildId !== options.buildId) {
      warnings.push(
        `Skipped stale coverage for ${entry.route} (${entry.stylesheetUrl || "inline"}): build id "${entry.buildId}" does not match "${options.buildId}".`,
      );
      continue;
    }
    const currentHash = options.cssHashes?.[entry.stylesheetUrl];
    if (currentHash !== undefined && currentHash !== entry.cssHash) {
      warnings.push(
        `Skipped stale coverage for ${entry.route} (${entry.stylesheetUrl}): stylesheet changed since import.`,
      );
      continue;
    }
    routes.add(entry.route);
    for (const selector of entry.unused) {
      if (!verdicts.has(selector)) {
        verdicts.set(selector, "coveredUnused");
      }
    }
    for (const selector of entry.used) {
      verdicts.set(selector, "hit");
    }
  }

  return { verdicts, routes: [...routes].sort(), warnings };
}
