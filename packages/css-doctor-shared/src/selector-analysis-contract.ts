/**
 * Canonical selector analysis report contract (Phase 4).
 *
 * Rust Core owns extraction, matching, and per-selector metrics. This module
 * defines the TypeScript shape, metric semantics, and compatibility helpers
 * for CLI / GUI consumers. It does not re-run selector matching.
 */

/** Nested selector-analysis schema (independent of CLI envelope schemaVersion). */
export const SELECTOR_ANALYSIS_SCHEMA_VERSION = 1 as const;

export type SelectorAnalysisSchemaVersion =
  typeof SELECTOR_ANALYSIS_SCHEMA_VERSION;

/**
 * How complete the attached analysis is.
 * - `full`: definitions + Core selectorMatches
 * - `symbols-only`: markup symbol bags without Core match rows
 * - `legacy-class-only`: older reports with only `byClass`
 * - `absent`: no usage section
 */
export type SelectorAnalysisCompleteness =
  | "full"
  | "symbols-only"
  | "legacy-class-only"
  | "absent";

export type SelectorMatchConfidence =
  | "confirmed"
  | "partial"
  | "unresolved"
  | "unsupported"
  | "none";

export type SelectorUsageStatus = "used" | "unused" | "partial" | "unknown";

export type SelectorCategory =
  | "class"
  | "id"
  | "element"
  | "attribute"
  | "universal"
  | "compound"
  | "combinator"
  | "pseudo"
  | "mixed"
  | "other";

export type SelectorFileHit = {
  file: string;
  count: number;
};

export type SelectorDefinitionLocation = {
  file: string;
  line?: number;
  column?: number;
  /** Selector occurrences of this exact text in the definition file. */
  count: number;
};

/**
 * One distinct CSS selector text and its analysis record.
 *
 * Definitions and usages are independent: definition locations never invent
 * usage, and usage never invents definitions.
 */
export type SelectorAnalysisRecord = {
  /** Original selector text from Core (`SelectorInfo.raw`). */
  selector: string;
  category: SelectorCategory;
  definitions: SelectorDefinitionLocation[];
  status: SelectorUsageStatus;
  confidence: SelectorMatchConfidence;
  /**
   * Distinct subject elements with a full structural match.
   * Counting rule: one per matching subject element in scanned markup.
   */
  matchedElements: number;
  /**
   * Confirmed usage occurrences.
   * Phase 3/4: same as `matchedElements` (one occurrence per matching subject).
   * Does not count definitions or partial hits.
   */
  usageOccurrences: number;
  /** Distinct source files with ≥1 confirmed structural match for this selector. */
  usageFiles: number;
  partialElements: number;
  unresolvedElements: number;
  hasUnprovenRuntimeState: boolean;
  hasUnprovenPositional: boolean;
  /** Trust level of the verdict. Absent in reports from older versions. */
  level?: SelectorConfidenceLevel;
  /** Evidence sources behind the verdict. Absent in older reports. */
  sources?: SelectorEvidenceSource[];
  /**
   * Per-file confirmed usage. Empty when Core did not emit file paths
   * (aggregate `usageFiles` remains authoritative).
   */
  usageByFile: SelectorFileHit[];
  notes: string[];
};

export type SelectorConfidenceLevel = "low" | "medium" | "high";
export type SelectorEvidenceSource = "static" | "runtime" | "config";

export type SelectorSymbolBags = {
  byClass: Record<string, SelectorFileHit[]>;
  byId: Record<string, SelectorFileHit[]>;
  byTag: Record<string, SelectorFileHit[]>;
  byAttribute: Record<string, SelectorFileHit[]>;
  unresolvedByClass: Record<string, SelectorFileHit[]>;
  unresolvedById: Record<string, SelectorFileHit[]>;
  unresolvedByAttribute: Record<string, SelectorFileHit[]>;
};

export type SelectorAnalysisMetrics = {
  /** Distinct selector texts in this analysis. */
  totalSelectors: number;
  /** Sum of definition occurrence counts (not usages). */
  totalDefinitions: number;
  /**
   * Sum of `usageOccurrences` for records with `confidence === "confirmed"`.
   * Partial / unresolved / unused contribute 0.
   */
  confirmedUsages: number;
  /**
   * Unique source files with confirmed matches across selectors.
   * `null` when per-file paths are unavailable (use per-selector `usageFiles`).
   */
  distinctUsageFiles: number | null;
  /** Sum of `matchedElements` for confirmed-confidence records. */
  confirmedMatchedElements: number;
  /** Count of selectors with `status === "partial"`. */
  partialMatches: number;
  /** Count of selectors with `status === "unknown"`. */
  unresolvedSelectors: number;
  /** Count of selectors with `status === "unused"`. */
  unusedSelectors: number;
};

export type SelectorAnalysisReport = {
  schemaVersion: SelectorAnalysisSchemaVersion;
  completeness: SelectorAnalysisCompleteness;
  metrics: SelectorAnalysisMetrics;
  selectors: SelectorAnalysisRecord[];
  /** Optional symbol bags for back-compat GUI columns. */
  symbols: SelectorSymbolBags | null;
  scannedFiles: number;
  elementsScanned: number;
  notes: string[];
};

export type ParseSelectorAnalysisResult =
  | { ok: true; report: SelectorAnalysisReport }
  | {
      ok: false;
      code: "absent" | "unsupported_schema" | "invalid";
      message: string;
    };

/**
 * Derive a coarse category from Core `kinds` strings.
 */
export function categorizeSelectorKinds(
  kinds: readonly string[],
  selectorText?: string,
): SelectorCategory {
  if (selectorText && /[\s>+~]/.test(selectorText.trim())) {
    return "combinator";
  }
  const set = new Set(
    kinds.map((kind) => kind.toLowerCase().replace(/_/g, "-")),
  );
  const structural = ["class", "id", "tag", "attribute", "universal"] as const;
  const present = structural.filter((kind) => set.has(kind));
  const hasPseudo =
    set.has("pseudo-class") ||
    set.has("pseudo_class") ||
    set.has("pseudo-element") ||
    set.has("pseudo_element");

  if (present.length === 0 && hasPseudo) {
    return "pseudo";
  }
  if (present.length === 1 && !hasPseudo) {
    const only = present[0];
    if (only === "tag") {
      return "element";
    }
    return only ?? "other";
  }
  if (present.length > 1) {
    return "compound";
  }
  if (hasPseudo) {
    return "mixed";
  }
  return present.length > 0 ? "mixed" : "other";
}

/**
 * Categorize from selector text heuristics when kinds are unavailable.
 */
export function categorizeSelectorText(selector: string): SelectorCategory {
  const text = selector.trim();
  if (!text) {
    return "other";
  }
  if (/[\s>+~]/.test(text)) {
    return "combinator";
  }
  if (text.includes(":") || text.includes("::")) {
    const withoutPseudo = text.replace(/::?[a-z-]+(\([^)]*\))?/gi, "");
    if (/[.#[]/.test(withoutPseudo) || /^[a-z]/i.test(withoutPseudo)) {
      return "mixed";
    }
    return "pseudo";
  }
  if (/^[a-z][\w-]*$/i.test(text)) {
    return "element";
  }
  if (text.startsWith(".")) {
    return text.includes(".") && text.indexOf(".", 1) !== -1
      ? "compound"
      : "class";
  }
  if (text.startsWith("#")) {
    return "id";
  }
  if (text.startsWith("[")) {
    return "attribute";
  }
  if (text === "*") {
    return "universal";
  }
  if (/[.#[]/.test(text)) {
    return "compound";
  }
  return "other";
}

export function emptySymbolBags(): SelectorSymbolBags {
  return {
    byClass: {},
    byId: {},
    byTag: {},
    byAttribute: {},
    unresolvedByClass: {},
    unresolvedById: {},
    unresolvedByAttribute: {},
  };
}

export function aggregateSelectorMetrics(
  selectors: readonly SelectorAnalysisRecord[],
): SelectorAnalysisMetrics {
  let totalDefinitions = 0;
  let confirmedUsages = 0;
  let confirmedMatchedElements = 0;
  let partialMatches = 0;
  let unresolvedSelectors = 0;
  let unusedSelectors = 0;
  const usageFileSet = new Set<string>();
  let sawUsagePaths = false;

  for (const row of selectors) {
    for (const definition of row.definitions) {
      totalDefinitions += definition.count;
    }
    if (row.confidence === "confirmed") {
      confirmedUsages += row.usageOccurrences;
      confirmedMatchedElements += row.matchedElements;
    }
    if (row.status === "partial") {
      partialMatches += 1;
    } else if (row.status === "unknown") {
      unresolvedSelectors += 1;
    } else if (row.status === "unused") {
      unusedSelectors += 1;
    }
    if (row.usageByFile.length > 0) {
      sawUsagePaths = true;
      for (const hit of row.usageByFile) {
        usageFileSet.add(hit.file);
      }
    }
  }

  return {
    totalSelectors: selectors.length,
    totalDefinitions,
    confirmedUsages,
    distinctUsageFiles: sawUsagePaths ? usageFileSet.size : null,
    confirmedMatchedElements,
    partialMatches,
    unresolvedSelectors,
    unusedSelectors,
  };
}

/**
 * Parse a `selectorAnalysis` object from a check JSON envelope.
 * Missing section → `{ ok: false, code: "absent" }` (not an error for legacy reports).
 */
export function parseSelectorAnalysis(
  value: unknown,
): ParseSelectorAnalysisResult {
  if (value === undefined || value === null) {
    return {
      ok: false,
      code: "absent",
      message: "selectorAnalysis is absent (legacy or symbols-only report).",
    };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      code: "invalid",
      message: "selectorAnalysis must be an object when present.",
    };
  }
  const record = value as Record<string, unknown>;
  const schemaVersion = record.schemaVersion;
  if (typeof schemaVersion !== "number") {
    return {
      ok: false,
      code: "invalid",
      message: "selectorAnalysis.schemaVersion must be a number.",
    };
  }
  if (schemaVersion !== SELECTOR_ANALYSIS_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "unsupported_schema",
      message: `Unsupported selectorAnalysis.schemaVersion: ${schemaVersion}. Supported: ${SELECTOR_ANALYSIS_SCHEMA_VERSION}.`,
    };
  }

  const completeness = normalizeCompleteness(record.completeness);
  const selectors = Array.isArray(record.selectors)
    ? record.selectors
        .map((item) => normalizeRecord(item))
        .filter((item): item is SelectorAnalysisRecord => item !== null)
    : [];

  const metrics = isRecord(record.metrics)
    ? normalizeMetrics(record.metrics, selectors)
    : aggregateSelectorMetrics(selectors);

  const symbols =
    record.symbols === null
      ? null
      : isRecord(record.symbols)
        ? normalizeSymbols(record.symbols)
        : null;

  return {
    ok: true,
    report: {
      schemaVersion: SELECTOR_ANALYSIS_SCHEMA_VERSION,
      completeness,
      metrics,
      selectors,
      symbols,
      scannedFiles: nonNegInt(record.scannedFiles, 0),
      elementsScanned: nonNegInt(record.elementsScanned, 0),
      notes: stringArray(record.notes),
    },
  };
}

/**
 * Build a legacy-compatible projection note for GUI when only classUsage exists.
 */
export function legacyClassOnlyAnalysis(input: {
  byClass: Record<string, SelectorFileHit[]>;
  scannedFiles: number;
  notes?: string[];
}): SelectorAnalysisReport {
  const symbols = emptySymbolBags();
  symbols.byClass = input.byClass;
  return {
    schemaVersion: SELECTOR_ANALYSIS_SCHEMA_VERSION,
    completeness: "legacy-class-only",
    metrics: {
      totalSelectors: 0,
      totalDefinitions: 0,
      confirmedUsages: 0,
      distinctUsageFiles: null,
      confirmedMatchedElements: 0,
      partialMatches: 0,
      unresolvedSelectors: 0,
      unusedSelectors: 0,
    },
    selectors: [],
    symbols,
    scannedFiles: input.scannedFiles,
    elementsScanned: 0,
    notes: [
      ...(input.notes ?? []),
      "Legacy class-only report: not interpreted as complete selector analysis.",
    ],
  };
}

function normalizeCompleteness(value: unknown): SelectorAnalysisCompleteness {
  switch (value) {
    case "full":
    case "symbols-only":
    case "legacy-class-only":
    case "absent":
      return value;
    default:
      return "symbols-only";
  }
}

function normalizeRecord(value: unknown): SelectorAnalysisRecord | null {
  if (
    !isRecord(value) ||
    typeof value.selector !== "string" ||
    !value.selector.trim()
  ) {
    return null;
  }
  const confidence = normalizeConfidence(value.confidence);
  const status = normalizeStatus(value.status);
  return {
    selector: value.selector.trim(),
    category: normalizeCategory(value.category, value.selector),
    definitions: normalizeDefinitions(value.definitions),
    status,
    confidence,
    matchedElements: nonNegInt(value.matchedElements ?? value.matchCount, 0),
    usageOccurrences: nonNegInt(
      value.usageOccurrences ?? value.matchedElements ?? value.matchCount,
      0,
    ),
    usageFiles: nonNegInt(value.usageFiles, 0),
    partialElements: nonNegInt(value.partialElements, 0),
    unresolvedElements: nonNegInt(value.unresolvedElements, 0),
    hasUnprovenRuntimeState: value.hasUnprovenRuntimeState === true,
    hasUnprovenPositional: value.hasUnprovenPositional === true,
    ...normalizeLevelAndSources(value.level, value.sources),
    usageByFile: normalizeFileHits(value.usageByFile),
    notes: stringArray(value.notes),
  };
}

function normalizeMetrics(
  value: Record<string, unknown>,
  selectors: SelectorAnalysisRecord[],
): SelectorAnalysisMetrics {
  const fallback = aggregateSelectorMetrics(selectors);
  return {
    totalSelectors: nonNegInt(value.totalSelectors, fallback.totalSelectors),
    totalDefinitions: nonNegInt(
      value.totalDefinitions,
      fallback.totalDefinitions,
    ),
    confirmedUsages: nonNegInt(value.confirmedUsages, fallback.confirmedUsages),
    distinctUsageFiles:
      value.distinctUsageFiles === null
        ? null
        : typeof value.distinctUsageFiles === "number"
          ? Math.max(0, Math.trunc(value.distinctUsageFiles))
          : fallback.distinctUsageFiles,
    confirmedMatchedElements: nonNegInt(
      value.confirmedMatchedElements,
      fallback.confirmedMatchedElements,
    ),
    partialMatches: nonNegInt(value.partialMatches, fallback.partialMatches),
    unresolvedSelectors: nonNegInt(
      value.unresolvedSelectors,
      fallback.unresolvedSelectors,
    ),
    unusedSelectors: nonNegInt(value.unusedSelectors, fallback.unusedSelectors),
  };
}

function normalizeSymbols(value: Record<string, unknown>): SelectorSymbolBags {
  return {
    byClass: normalizeHitRecord(value.byClass),
    byId: normalizeHitRecord(value.byId),
    byTag: normalizeHitRecord(value.byTag),
    byAttribute: normalizeHitRecord(value.byAttribute),
    unresolvedByClass: normalizeHitRecord(value.unresolvedByClass),
    unresolvedById: normalizeHitRecord(value.unresolvedById),
    unresolvedByAttribute: normalizeHitRecord(value.unresolvedByAttribute),
  };
}

function normalizeHitRecord(value: unknown): Record<string, SelectorFileHit[]> {
  if (!isRecord(value)) {
    return {};
  }
  const out: Record<string, SelectorFileHit[]> = {};
  for (const [key, hits] of Object.entries(value)) {
    const normalized = normalizeFileHits(hits);
    if (normalized.length > 0) {
      out[key] = normalized;
    }
  }
  return out;
}

function normalizeDefinitions(value: unknown): SelectorDefinitionLocation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: SelectorDefinitionLocation[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.file !== "string" || !item.file.trim()) {
      continue;
    }
    out.push({
      file: item.file.trim(),
      line: typeof item.line === "number" ? item.line : undefined,
      column: typeof item.column === "number" ? item.column : undefined,
      count: nonNegInt(item.count, 1),
    });
  }
  return out;
}

function normalizeFileHits(value: unknown): SelectorFileHit[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: SelectorFileHit[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.file !== "string" || !item.file.trim()) {
      continue;
    }
    const count = nonNegInt(item.count, 0);
    if (count <= 0) {
      continue;
    }
    out.push({ file: item.file.trim(), count });
  }
  return out;
}

function normalizeConfidence(value: unknown): SelectorMatchConfidence {
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

function normalizeStatus(value: unknown): SelectorUsageStatus {
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

function normalizeCategory(value: unknown, selector: string): SelectorCategory {
  switch (value) {
    case "class":
    case "id":
    case "element":
    case "attribute":
    case "universal":
    case "compound":
    case "combinator":
    case "pseudo":
    case "mixed":
    case "other":
      return value;
    default:
      return categorizeSelectorText(selector);
  }
}

function nonNegInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.trunc(value));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validates optional confidence fields; invalid values are dropped. */
export function normalizeLevelAndSources(
  level: unknown,
  sources: unknown,
): { level?: SelectorConfidenceLevel; sources?: SelectorEvidenceSource[] } {
  const out: {
    level?: SelectorConfidenceLevel;
    sources?: SelectorEvidenceSource[];
  } = {};
  if (level === "low" || level === "medium" || level === "high") {
    out.level = level;
  }
  if (Array.isArray(sources)) {
    const valid = sources.filter(
      (item): item is SelectorEvidenceSource =>
        item === "static" || item === "runtime" || item === "config",
    );
    if (valid.length > 0) {
      out.sources = [...new Set(valid)];
    }
  }
  return out;
}
