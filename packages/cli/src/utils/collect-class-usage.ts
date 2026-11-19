import { readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type { JsMarkupFileEvidence } from "@zealakit/css-doctor-binding";
import type { UnknownEvidence } from "@zealakit/css-doctor-shared";
import {
  normalizeLevelAndSources,
  scanCssModuleUsage,
  scanSourceEvidence,
} from "@zealakit/css-doctor-shared";
import fastGlob from "fast-glob";

import { normalizeSelector } from "../runtime-coverage/coverage-store";
import type { RuntimeVerdict } from "../runtime-coverage/coverage-store";
import { loadBinding } from "./binding";
import { describeError } from "./file";

/** Per-file occurrence hit for a usage symbol. */
export type ClassUsageHit = {
  file: string;
  count: number;
};

/** Core-backed selector match row (confidence/status are authoritative). */
export type SelectorUsageMatchHit = {
  selector: string;
  confidence: "confirmed" | "partial" | "unresolved" | "unsupported" | "none";
  status: "used" | "unused" | "partial" | "unknown";
  matchCount: number;
  matchedElements: number;
  usageOccurrences: number;
  usageFiles: number;
  usageByFile: ClassUsageHit[];
  partialElements: number;
  unresolvedElements: number;
  hasUnprovenRuntimeState: boolean;
  hasUnprovenPositional: boolean;
  level?: "low" | "medium" | "high";
  sources?: Array<"static" | "runtime" | "config">;
  notes: string[];
};

/**
 * Source usage keyed by symbol kind.
 *
 * Symbol bags remain back-compat for GUI class/id/tag/attr columns.
 * `selectorMatches` carries Core matching metrics and unused classification.
 */
export type CheckClassUsage = {
  byClass: Record<string, ClassUsageHit[]>;
  byId: Record<string, ClassUsageHit[]>;
  byTag: Record<string, ClassUsageHit[]>;
  byAttribute: Record<string, ClassUsageHit[]>;
  unresolvedByClass: Record<string, ClassUsageHit[]>;
  unresolvedById: Record<string, ClassUsageHit[]>;
  unresolvedByAttribute: Record<string, ClassUsageHit[]>;
  selectorMatches: SelectorUsageMatchHit[];
  scannedFiles: number;
  elementsScanned: number;
  /** Class-helper arguments that could not be resolved, per file (blind spots). */
  unknownEvidenceByFile: Record<string, UnknownEvidence[]>;
  unknownEvidenceCount: number;
  /** Compound selectors whose classes all appear in source but never on one element. */
  compoundNeverMatch: CompoundNeverMatch[];
  notes: string[];
};

export type CompoundNeverMatch = {
  selector: string;
  /** Classes the selector requires (each used somewhere in source). */
  classes: string[];
  /** Files using each class, to show where the classes live apart. */
  filesByClass: Record<string, string[]>;
};

export type CollectClassUsageOptions = {
  /** When provided, Core matches these selectors against collected evidence. */
  selectors?: string[];
  /** Class helper names to resolve. Omit for defaults; `[]` disables. */
  classHelpers?: readonly string[];
  /** Runtime coverage verdicts (normalized selector -> verdict). */
  runtimeVerdicts?: ReadonlyMap<string, RuntimeVerdict>;
};

const SOURCE_GLOBS = [
  "**/*.{tsx,ts,jsx,js,mjs,cjs,html,vue,svelte,astro}",
] as const;

const SOURCE_IGNORES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/dist-server/**",
  "**/.next/**",
  "**/build/**",
  "**/coverage/**",
  "**/target/**",
  "**/.turbo/**",
  "**/storybook-static/**",
];

/**
 * Scans project source once for element + symbol evidence.
 * Matches CSS selectors per-file via Core (combinators never cross files).
 */
export async function collectProjectClassUsage(
  cwd: string,
  options: CollectClassUsageOptions = {},
): Promise<CheckClassUsage> {
  const root = resolve(cwd);
  const notes = [
    "Confirmed usage comes from static class/id/tag/attribute literals.",
    "Unresolved tokens are listed separately and are not confirmed usage.",
    "Compound/combinator matching uses Rust Core; partial matches are not confirmed.",
    "Runtime states (:hover/:focus) and positional pseudos never yield confirmed confidence.",
    "Parent/sibling combinators are matched within a single source file only.",
    "PascalCase components are not counted as native HTML elements.",
    "Class helper calls (cn/clsx/cva/...) resolve literals; unresolvable arguments are reported as unknown evidence.",
  ];

  let paths: string[] = [];
  try {
    paths = await fastGlob([...SOURCE_GLOBS], {
      cwd: root,
      absolute: true,
      onlyFiles: true,
      unique: true,
      dot: false,
      followSymbolicLinks: true,
      ignore: SOURCE_IGNORES,
    });
  } catch (error) {
    return emptyUsage([
      ...notes,
      `Source scan failed: ${describeError(error)}`,
    ]);
  }

  const byClass = new Map<string, Map<string, number>>();
  const byId = new Map<string, Map<string, number>>();
  const byTag = new Map<string, Map<string, number>>();
  const byAttribute = new Map<string, Map<string, number>>();
  const unresolvedByClass = new Map<string, Map<string, number>>();
  const unresolvedById = new Map<string, Map<string, number>>();
  const unresolvedByAttribute = new Map<string, Map<string, number>>();
  const files: JsMarkupFileEvidence[] = [];
  const unknownEvidenceByFile: Record<string, UnknownEvidence[]> = {};
  let unknownEvidenceCount = 0;
  let elementsScanned = 0;

  for (const absolute of paths) {
    let source: string;
    try {
      source = await readFile(absolute, "utf8");
    } catch {
      continue;
    }

    const evidence = scanSourceEvidence(
      source,
      options.classHelpers ? { classHelpers: options.classHelpers } : {},
    );
    const displayPath = toProjectPath(absolute, root);
    applyCssModuleUsage(source, evidence);
    if (evidence.unknown.length > 0) {
      unknownEvidenceByFile[displayPath] = evidence.unknown;
      unknownEvidenceCount += evidence.unknown.length;
    }
    elementsScanned += evidence.elements.length;

    files.push({
      path: displayPath,
      elements: evidence.elements.map((element) => ({
        tag: element.tag ?? undefined,
        id: element.id ?? undefined,
        classes: element.classes,
        dynamicClasses: element.dynamicClasses,
        attributes: element.attributes,
        dynamicAttributes: element.dynamicAttributes,
        parentIndex:
          element.parentIndex === null ? undefined : element.parentIndex,
        depth: element.depth,
      })),
    });

    mergeFileHits(byClass, evidence.confirmed.classes, displayPath);
    mergeFileHits(byId, evidence.confirmed.ids, displayPath);
    mergeFileHits(byTag, evidence.confirmed.tags, displayPath);
    mergeFileHits(byAttribute, evidence.confirmed.attributes, displayPath);
    mergeFileHits(unresolvedByClass, evidence.unresolved.classes, displayPath);
    mergeFileHits(unresolvedById, evidence.unresolved.ids, displayPath);
    mergeFileHits(
      unresolvedByAttribute,
      evidence.unresolved.attributes,
      displayPath,
    );
  }

  let selectorMatches: SelectorUsageMatchHit[] = [];
  const selectors = dedupeSelectors(options.selectors ?? []);
  if (selectors.length > 0 && files.length > 0) {
    try {
      const binding = loadBinding();
      const matches = binding.matchSelectorsAgainstMarkup(selectors, {
        elements: [],
        files,
      });
      selectorMatches = matches.map((item) =>
        applyRuntimeVerdict(
          binding,
          {
            selector: item.selector,
            confidence: normalizeConfidence(String(item.confidence)),
            status: normalizeStatus(String(item.status)),
            matchCount: item.matchCount,
            matchedElements: item.matchedElements,
            usageOccurrences: item.usageOccurrences,
            usageFiles: item.usageFiles,
            usageByFile: Array.isArray(item.usageByFile)
              ? item.usageByFile
                  .filter(
                    (hit) =>
                      hit &&
                      typeof hit.file === "string" &&
                      hit.file.trim() &&
                      typeof hit.count === "number" &&
                      hit.count > 0,
                  )
                  .map((hit) => ({
                    file: hit.file.trim(),
                    count: Math.trunc(hit.count),
                  }))
              : [],
            partialElements: item.partialElements,
            unresolvedElements: item.unresolvedElements,
            hasUnprovenRuntimeState: item.hasUnprovenRuntimeState,
            hasUnprovenPositional: item.hasUnprovenPositional,
            ...normalizeLevelAndSources(item.level, item.sources),
            notes: item.notes,
          },
          options.runtimeVerdicts,
        ),
      );
    } catch (error) {
      notes.push(`Selector matching skipped: ${describeError(error)}`);
    }
  }

  return {
    byClass: toSortedRecord(byClass),
    byId: toSortedRecord(byId),
    byTag: toSortedRecord(byTag),
    byAttribute: toSortedRecord(byAttribute),
    unresolvedByClass: toSortedRecord(unresolvedByClass),
    unresolvedById: toSortedRecord(unresolvedById),
    unresolvedByAttribute: toSortedRecord(unresolvedByAttribute),
    selectorMatches,
    scannedFiles: paths.length,
    elementsScanned,
    unknownEvidenceByFile,
    unknownEvidenceCount,
    compoundNeverMatch: findCompoundNeverMatch(selectorMatches, byClass),
    notes,
  };
}

/**
 * "Compound selector never matches together": `.a.b` (or `.a .b`) is unused
 * although every class it needs exists in source, just never on one element.
 */
function findCompoundNeverMatch(
  matches: SelectorUsageMatchHit[],
  byClass: Map<string, Map<string, number>>,
): CompoundNeverMatch[] {
  const out: CompoundNeverMatch[] = [];
  for (const match of matches) {
    // Unused, or only partially matched (classes seen on different elements),
    // with no confirmed element, no dynamic/unresolved evidence, and no
    // runtime/positional pseudo that could explain the miss.
    const neverTogether =
      (match.status === "unused" || match.status === "partial") &&
      match.matchedElements === 0 &&
      match.unresolvedElements === 0 &&
      !match.hasUnprovenRuntimeState &&
      !match.hasUnprovenPositional;
    if (!neverTogether) {
      continue;
    }
    const classes = requiredClasses(match.selector);
    if (classes.length < 2) {
      continue;
    }
    const filesByClass: Record<string, string[]> = {};
    let allPresent = true;
    for (const name of classes) {
      const files = byClass.get(name);
      if (!files || files.size === 0) {
        allPresent = false;
        break;
      }
      filesByClass[name] = [...files.keys()].sort().slice(0, 5);
    }
    if (allPresent) {
      out.push({ selector: match.selector, classes, filesByClass });
    }
  }
  return out;
}

/** Lowercased classes outside `:not(...)` / `:is(...)` / `:where(...)` / `:has(...)`. */
function requiredClasses(selector: string): string[] {
  let stripped = selector;
  let previous: string;
  do {
    previous = stripped;
    stripped = stripped.replace(/:(?:not|is|where|has|any)\([^()]*\)/gi, " ");
  } while (stripped !== previous);
  const found = new Set<string>();
  for (const match of stripped.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    if (match[1]) {
      found.add(match[1].toLowerCase());
    }
  }
  return [...found];
}

/**
 * CSS Modules: the analyzed CSS keeps local names, so `styles.foo` is usage of
 * `.foo`. Dynamic access cannot be resolved and is reported as unknown evidence.
 */
function applyCssModuleUsage(
  source: string,
  evidence: ReturnType<typeof scanSourceEvidence>,
): void {
  for (const usage of scanCssModuleUsage(source)) {
    if (usage.locals.length > 0) {
      evidence.elements.push({
        tag: null,
        id: null,
        classes: usage.locals.map((name) => name.toLowerCase()),
        dynamicClasses: [],
        attributes: {},
        dynamicAttributes: [],
        parentIndex: null,
        depth: 0,
        line: null,
        column: null,
      });
      for (const name of usage.locals) {
        const token = name.toLowerCase();
        evidence.confirmed.classes.set(
          token,
          (evidence.confirmed.classes.get(token) ?? 0) + 1,
        );
      }
    }
    if (usage.dynamic) {
      evidence.unknown.push({
        helper: "css-modules",
        line: 1,
        excerpt: `dynamic access to ${usage.specifier}`,
      });
    }
  }
}

/**
 * Combines a static match with runtime coverage via Core's verdict rules
 * (`deriveUsageVerdict`). Without runtime evidence the match is unchanged.
 */
function applyRuntimeVerdict(
  binding: ReturnType<typeof loadBinding>,
  match: SelectorUsageMatchHit,
  verdicts: ReadonlyMap<string, RuntimeVerdict> | undefined,
): SelectorUsageMatchHit {
  const runtime = verdicts?.get(normalizeSelector(match.selector));
  if (!runtime) {
    return match;
  }
  const verdict = binding.deriveUsageVerdict(
    match.confidence,
    match.status,
    runtime,
    false,
  );
  const extra = normalizeLevelAndSources(verdict.level, verdict.sources);
  return {
    ...match,
    status: normalizeStatus(verdict.status),
    ...extra,
    notes: [
      ...match.notes,
      runtime === "hit"
        ? "Runtime coverage: selector matched in a browser run."
        : "Runtime coverage: covered routes never matched this selector.",
    ],
  };
}

function emptyUsage(notes: string[]): CheckClassUsage {
  return {
    byClass: {},
    byId: {},
    byTag: {},
    byAttribute: {},
    unresolvedByClass: {},
    unresolvedById: {},
    unresolvedByAttribute: {},
    selectorMatches: [],
    scannedFiles: 0,
    elementsScanned: 0,
    unknownEvidenceByFile: {},
    unknownEvidenceCount: 0,
    compoundNeverMatch: [],
    notes,
  };
}

function mergeFileHits(
  target: Map<string, Map<string, number>>,
  fileCounts: Map<string, number>,
  displayPath: string,
): void {
  for (const [token, count] of fileCounts) {
    let fileMap = target.get(token);
    if (!fileMap) {
      fileMap = new Map();
      target.set(token, fileMap);
    }
    fileMap.set(displayPath, (fileMap.get(displayPath) ?? 0) + count);
  }
}

function toSortedRecord(
  map: Map<string, Map<string, number>>,
): Record<string, ClassUsageHit[]> {
  const record: Record<string, ClassUsageHit[]> = {};
  for (const [token, fileMap] of map) {
    const hits = [...fileMap.entries()]
      .map(([file, count]) => ({ file, count }))
      .sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.file.localeCompare(right.file);
      });
    record[token] = hits;
  }
  return record;
}

function toProjectPath(absolutePath: string, cwd: string): string {
  const relativePath = relative(cwd, absolutePath);
  const display = relativePath.length > 0 ? relativePath : absolutePath;
  return display.split(sep).join("/");
}

function dedupeSelectors(selectors: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of selectors) {
    const selector = raw.trim();
    if (!selector || seen.has(selector)) {
      continue;
    }
    seen.add(selector);
    out.push(selector);
  }
  return out;
}

function normalizeConfidence(
  value: string,
): SelectorUsageMatchHit["confidence"] {
  switch (value) {
    case "confirmed":
    case "partial":
    case "unresolved":
    case "unsupported":
    case "none":
      return value;
    default:
      return "none";
  }
}

function normalizeStatus(value: string): SelectorUsageMatchHit["status"] {
  switch (value) {
    case "used":
    case "unused":
    case "partial":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}
