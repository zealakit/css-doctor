/**
 * Assembles a {@link SelectorAnalysisReport} from Core analyzeCss definitions
 * and Core matchSelectorsAgainstMarkup rows. Does not re-match selectors.
 */

import {
  aggregateSelectorMetrics,
  categorizeSelectorKinds,
  categorizeSelectorText,
  emptySymbolBags,
  normalizeLevelAndSources,
  SELECTOR_ANALYSIS_SCHEMA_VERSION,
  type SelectorAnalysisRecord,
  type SelectorAnalysisReport,
  type SelectorDefinitionLocation,
  type SelectorFileHit,
  type SelectorMatchConfidence,
  type SelectorSymbolBags,
  type SelectorUsageStatus,
} from "./selector-analysis-contract";

export type SelectorDefinitionInput = {
  selector: string;
  file: string;
  kinds?: string[];
  line?: number;
  column?: number;
};

export type SelectorMatchInput = {
  selector: string;
  confidence: SelectorMatchConfidence | string;
  status: SelectorUsageStatus | string;
  matchCount?: number;
  matchedElements?: number;
  usageOccurrences?: number;
  usageFiles?: number;
  usageByFile?: SelectorFileHit[];
  partialElements?: number;
  unresolvedElements?: number;
  hasUnprovenRuntimeState?: boolean;
  hasUnprovenPositional?: boolean;
  level?: string;
  sources?: string[];
  notes?: string[];
};

export type BuildSelectorAnalysisInput = {
  definitions: SelectorDefinitionInput[];
  matches?: SelectorMatchInput[];
  symbols?: Partial<SelectorSymbolBags> | null;
  scannedFiles?: number;
  elementsScanned?: number;
  notes?: string[];
};

/**
 * Build the canonical selector analysis section for a check JSON envelope.
 */
export function buildSelectorAnalysisReport(
  input: BuildSelectorAnalysisInput,
): SelectorAnalysisReport {
  const definitionMap = new Map<
    string,
    {
      kinds: string[];
      definitions: Map<string, SelectorDefinitionLocation>;
    }
  >();

  for (const item of input.definitions) {
    const selector = item.selector.trim();
    if (!selector || !item.file.trim()) {
      continue;
    }
    let entry = definitionMap.get(selector);
    if (!entry) {
      entry = { kinds: [], definitions: new Map() };
      definitionMap.set(selector, entry);
    }
    if (item.kinds && item.kinds.length > 0 && entry.kinds.length === 0) {
      entry.kinds = [...item.kinds];
    }
    const file = item.file.trim();
    const existing = entry.definitions.get(file);
    if (existing) {
      existing.count += 1;
      if (existing.line === undefined && item.line !== undefined) {
        existing.line = item.line;
        existing.column = item.column;
      }
    } else {
      entry.definitions.set(file, {
        file,
        line: item.line,
        column: item.column,
        count: 1,
      });
    }
  }

  const matchMap = new Map<string, SelectorMatchInput>();
  for (const match of input.matches ?? []) {
    const selector = match.selector.trim();
    if (!selector) {
      continue;
    }
    matchMap.set(selector, match);
  }

  const keys = new Set<string>([...definitionMap.keys(), ...matchMap.keys()]);
  const selectors: SelectorAnalysisRecord[] = [];

  for (const selector of [...keys].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const definitionEntry = definitionMap.get(selector);
    const match = matchMap.get(selector);
    const definitions = definitionEntry
      ? [...definitionEntry.definitions.values()].sort((left, right) =>
          left.file.localeCompare(right.file),
        )
      : [];
    const category =
      definitionEntry && definitionEntry.kinds.length > 0
        ? categorizeSelectorKinds(definitionEntry.kinds, selector)
        : categorizeSelectorText(selector);

    if (match) {
      const matchedElements = nonNeg(
        match.matchedElements ?? match.matchCount ?? 0,
      );
      selectors.push({
        selector,
        category,
        definitions,
        status: asStatus(match.status),
        confidence: asConfidence(match.confidence),
        matchedElements,
        usageOccurrences: nonNeg(match.usageOccurrences ?? matchedElements),
        usageFiles: nonNeg(match.usageFiles ?? 0),
        partialElements: nonNeg(match.partialElements ?? 0),
        unresolvedElements: nonNeg(match.unresolvedElements ?? 0),
        hasUnprovenRuntimeState: match.hasUnprovenRuntimeState === true,
        hasUnprovenPositional: match.hasUnprovenPositional === true,
        ...normalizeLevelAndSources(match.level, match.sources),
        usageByFile: normalizeMatchUsageByFile(match.usageByFile),
        notes: match.notes ?? [],
      });
      continue;
    }

    // Definition without a Core match row (symbols-only / incomplete scan).
    selectors.push({
      selector,
      category,
      definitions,
      status: "unknown",
      confidence: "none",
      matchedElements: 0,
      usageOccurrences: 0,
      usageFiles: 0,
      partialElements: 0,
      unresolvedElements: 0,
      hasUnprovenRuntimeState: false,
      hasUnprovenPositional: false,
      usageByFile: [],
      notes: [
        "No Core selector match row was attached; usage status is unknown.",
      ],
    });
  }

  const hasMatches = (input.matches?.length ?? 0) > 0;
  const hasDefinitions = definitionMap.size > 0;
  const symbols = normalizeInputSymbols(input.symbols);
  const completeness =
    hasMatches && hasDefinitions
      ? "full"
      : hasDefinitions || symbols !== null
        ? "symbols-only"
        : "absent";

  const notes = [
    ...(input.notes ?? []),
    "Definitions come from analyzeCss; usage metrics come from matchSelectorsAgainstMarkup.",
    "Partial matches and runtime/positional states are not counted as confirmed usages.",
  ];

  return {
    schemaVersion: SELECTOR_ANALYSIS_SCHEMA_VERSION,
    completeness,
    metrics: aggregateSelectorMetrics(selectors),
    selectors,
    symbols,
    scannedFiles: nonNeg(input.scannedFiles ?? 0),
    elementsScanned: nonNeg(input.elementsScanned ?? 0),
    notes,
  };
}

function normalizeInputSymbols(
  value: Partial<SelectorSymbolBags> | null | undefined,
): SelectorSymbolBags | null {
  if (value === undefined) {
    return null;
  }
  if (value === null) {
    return null;
  }
  const empty = emptySymbolBags();
  return {
    byClass: asHitRecord(value.byClass) ?? empty.byClass,
    byId: asHitRecord(value.byId) ?? empty.byId,
    byTag: asHitRecord(value.byTag) ?? empty.byTag,
    byAttribute: asHitRecord(value.byAttribute) ?? empty.byAttribute,
    unresolvedByClass:
      asHitRecord(value.unresolvedByClass) ?? empty.unresolvedByClass,
    unresolvedById: asHitRecord(value.unresolvedById) ?? empty.unresolvedById,
    unresolvedByAttribute:
      asHitRecord(value.unresolvedByAttribute) ?? empty.unresolvedByAttribute,
  };
}

function asHitRecord(
  value: Record<string, SelectorFileHit[]> | undefined,
): Record<string, SelectorFileHit[]> | undefined {
  return value;
}

function normalizeMatchUsageByFile(
  value: SelectorFileHit[] | undefined,
): SelectorFileHit[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: SelectorFileHit[] = [];
  for (const item of value) {
    if (!item || typeof item.file !== "string" || !item.file.trim()) {
      continue;
    }
    const count = nonNeg(item.count);
    if (count <= 0) {
      continue;
    }
    out.push({ file: item.file.trim(), count });
  }
  return out;
}

function asConfidence(value: string): SelectorMatchConfidence {
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

function asStatus(value: string): SelectorUsageStatus {
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

function nonNeg(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}
