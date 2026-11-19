/**
 * Presentation projection for the Selector Explorer dashboard.
 * Authoritative metrics and match rows come from Phase 4 `selectorAnalysis`.
 * Legacy class-only reports fall back to the symbol bag view without inventing
 * selector match data.
 */

import { buildClassUsageView, type ClassUsageRow } from "./class-usage";
import type { GuiReport, GuiSelectorAnalysis } from "./report-model";

export type SelectorExplorerCategory =
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

export type SelectorExplorerStatus = "used" | "unused" | "partial" | "unknown";

export type SelectorExplorerFileHit = {
  file: string;
  count: number;
  line?: number;
  column?: number;
};

export type SelectorExplorerRow = {
  id: string;
  selector: string;
  category: SelectorExplorerCategory;
  status: SelectorExplorerStatus;
  /** Confirmed usage occurrences; null when usage scan is unavailable. */
  usageCount: number | null;
  /** Distinct usage files; null when unavailable. */
  fileCount: number | null;
  definitions: SelectorExplorerFileHit[];
  /** null = usage section absent; [] = scanned with no confirmed hits. */
  usages: SelectorExplorerFileHit[] | null;
  partialElements: number;
  unresolvedElements: number;
  hasUnprovenRuntimeState: boolean;
  hasUnprovenPositional: boolean;
  /** Trust level of the verdict; absent for legacy rows / older reports. */
  level?: "low" | "medium" | "high";
  /** Evidence sources behind the verdict (static / runtime / config). */
  sources?: Array<"static" | "runtime" | "config">;
  notes: string[];
  /** True when row is projected from legacy symbol bags, not Core match rows. */
  legacyProjection: boolean;
};

export type SelectorExplorerOverview = {
  available: boolean;
  /** True when confirmed usage metrics are meaningful. */
  usageAvailable: boolean;
  completeness:
    | "full"
    | "symbols-only"
    | "legacy-class-only"
    | "absent"
    | "none";
  totalSelectors: number | null;
  totalDefinitions: number | null;
  confirmedUsages: number | null;
  distinctUsageFiles: number | null;
  unusedSelectors: number | null;
  /** partialMatches + unresolvedSelectors from canonical metrics. */
  partialOrUnresolved: number | null;
  note?: string;
};

export type SelectorExplorerView = {
  overview: SelectorExplorerOverview;
  rows: SelectorExplorerRow[];
};

export type SelectorExplorerSortKey = "usages" | "selector" | "status" | "type";
export type SelectorExplorerSortDir = "asc" | "desc";

export type SelectorExplorerFilterOptions = {
  query?: string;
  category?: SelectorExplorerCategory | "all";
  status?: SelectorExplorerStatus | "all";
  sortKey?: SelectorExplorerSortKey;
  sortDir?: SelectorExplorerSortDir;
};

const CATEGORY_LABELS: Record<SelectorExplorerCategory, string> = {
  class: "Class",
  id: "ID",
  element: "Element",
  attribute: "Attribute",
  universal: "Universal",
  compound: "Compound",
  combinator: "Combinator",
  pseudo: "Pseudo",
  mixed: "Mixed",
  other: "Other",
};

const STATUS_LABELS: Record<SelectorExplorerStatus, string> = {
  used: "Used",
  unused: "Unused",
  partial: "Partial",
  unknown: "Unknown",
};

export function categoryLabel(category: SelectorExplorerCategory): string {
  return CATEGORY_LABELS[category];
}

export function statusLabel(status: SelectorExplorerStatus): string {
  return STATUS_LABELS[status];
}

/**
 * Build the explorer view from a normalized GuiReport.
 * Prefer canonical selectorAnalysis rows when present and non-legacy.
 */
export function buildSelectorExplorerView(
  report: GuiReport,
): SelectorExplorerView {
  const analysis = report.cssAnalysis?.selectorAnalysis ?? null;

  if (
    analysis &&
    (analysis.completeness === "full" ||
      (analysis.selectors.length > 0 &&
        analysis.completeness !== "legacy-class-only"))
  ) {
    return buildFromSelectorAnalysis(analysis);
  }

  // Legacy / symbols-only / absent: project symbol bags without inventing
  // full selector match semantics.
  const legacy = buildClassUsageView(report);
  return projectLegacySymbolView(legacy, analysis);
}

export function filterSelectorExplorerRows(
  rows: readonly SelectorExplorerRow[],
  options: SelectorExplorerFilterOptions = {},
): SelectorExplorerRow[] {
  const category = options.category ?? "all";
  const status = options.status ?? "all";
  const needle = (options.query ?? "").trim().toLowerCase();
  const sortKey = options.sortKey ?? "usages";
  const sortDir = options.sortDir ?? "desc";

  let filtered = rows.filter((row) => {
    if (category !== "all" && row.category !== category) {
      return false;
    }
    if (status !== "all" && row.status !== status) {
      return false;
    }
    if (!needle) {
      return true;
    }
    if (row.selector.toLowerCase().includes(needle)) {
      return true;
    }
    if (
      row.category.includes(needle) ||
      categoryLabel(row.category).toLowerCase().includes(needle)
    ) {
      return true;
    }
    if (
      row.status.includes(needle) ||
      statusLabel(row.status).toLowerCase().includes(needle)
    ) {
      return true;
    }
    if (
      row.definitions.some((item) => item.file.toLowerCase().includes(needle))
    ) {
      return true;
    }
    return (row.usages ?? []).some((item) =>
      item.file.toLowerCase().includes(needle),
    );
  });

  filtered = [...filtered].sort((left, right) =>
    compareRows(left, right, sortKey, sortDir),
  );
  return filtered;
}

function buildFromSelectorAnalysis(
  analysis: GuiSelectorAnalysis,
): SelectorExplorerView {
  const metrics = analysis.metrics;
  const usageAvailable =
    analysis.completeness === "full" ||
    analysis.selectors.some(
      (row) =>
        row.status !== "unknown" ||
        row.usageOccurrences > 0 ||
        row.usageByFile.length > 0,
    );

  const rows: SelectorExplorerRow[] = analysis.selectors.map((row, index) => {
    const category = normalizeCategory(row.category);
    const status = normalizeStatus(row.status);
    const definitions = row.definitions.map((item) => ({
      file: item.file,
      count: item.count,
      line: item.line,
      column: item.column,
    }));
    definitions.sort(compareFileHits);

    const usageAvailableForRow = usageAvailable;
    let usages: SelectorExplorerFileHit[] | null = null;
    let usageCount: number | null = null;
    let fileCount: number | null = null;

    if (usageAvailableForRow) {
      // Only confirmed usageByFile entries; never treat definitions as usages.
      usages = row.usageByFile.map((item) => ({
        file: item.file,
        count: item.count,
      }));
      usages.sort(compareFileHits);
      usageCount = row.usageOccurrences;
      // Files column = distinct usage files (canonical usageFiles, else paths).
      fileCount =
        typeof row.usageFiles === "number" && row.usageFiles > 0
          ? row.usageFiles
          : usages.length;
      // When paths are missing but Core reported usageFiles, keep that count.
      if (usages.length === 0 && fileCount === 0 && usageCount === 0) {
        fileCount = 0;
      }
    }

    return {
      id: `sel:${index}:${row.selector}`,
      selector: row.selector,
      category,
      status,
      usageCount,
      fileCount,
      definitions,
      usages,
      partialElements: row.partialElements,
      unresolvedElements: row.unresolvedElements,
      hasUnprovenRuntimeState: row.hasUnprovenRuntimeState,
      hasUnprovenPositional: row.hasUnprovenPositional,
      ...(row.level ? { level: row.level } : {}),
      ...(row.sources ? { sources: [...row.sources] } : {}),
      notes: [...row.notes],
      legacyProjection: false,
    };
  });

  rows.sort((left, right) => compareRows(left, right, "usages", "desc"));

  return {
    overview: {
      available: true,
      usageAvailable,
      completeness: analysis.completeness,
      totalSelectors: metrics.totalSelectors,
      totalDefinitions: metrics.totalDefinitions,
      confirmedUsages: usageAvailable ? metrics.confirmedUsages : null,
      distinctUsageFiles: usageAvailable ? metrics.distinctUsageFiles : null,
      unusedSelectors: usageAvailable ? metrics.unusedSelectors : null,
      partialOrUnresolved: usageAvailable
        ? metrics.partialMatches + metrics.unresolvedSelectors
        : null,
      note: overviewNote(analysis),
    },
    rows,
  };
}

function projectLegacySymbolView(
  legacy: ReturnType<typeof buildClassUsageView>,
  analysis: GuiSelectorAnalysis | null,
): SelectorExplorerView {
  const completeness =
    analysis?.completeness ??
    (legacy.overview.available ? "legacy-class-only" : "none");

  const rows: SelectorExplorerRow[] = legacy.rows.map((row, index) =>
    mapLegacyRow(row, index),
  );

  return {
    overview: {
      available: legacy.overview.available,
      usageAvailable: legacy.overview.usageAvailable,
      completeness,
      totalSelectors: legacy.overview.totalSelectors,
      totalDefinitions: null,
      confirmedUsages: legacy.overview.totalUsages,
      distinctUsageFiles: null,
      unusedSelectors: legacy.overview.deadSelectorCount,
      partialOrUnresolved: null,
      note:
        analysis?.notes[0] ??
        legacy.overview.note ??
        (completeness === "legacy-class-only"
          ? "Legacy class-only report — limited selector coverage."
          : undefined),
    },
    rows,
  };
}

function mapLegacyRow(row: ClassUsageRow, index: number): SelectorExplorerRow {
  const category = mapLegacyKind(row.kind);
  const status = mapLegacyConfidence(row.confidence, row.usageCount);
  return {
    id: `legacy:${row.kind}:${row.token}:${index}`,
    selector: row.selector,
    category,
    status,
    usageCount: row.usageCount,
    fileCount: row.fileCount,
    definitions: row.definitions.map((item) => ({
      file: item.file,
      count: item.count,
    })),
    usages:
      row.usages === null
        ? null
        : row.usages.map((item) => ({ file: item.file, count: item.count })),
    partialElements: 0,
    unresolvedElements: 0,
    hasUnprovenRuntimeState: false,
    hasUnprovenPositional: false,
    notes:
      row.confidence === "unknown"
        ? ["Legacy symbol projection; not a full Core selector match row."]
        : [],
    legacyProjection: true,
  };
}

function mapLegacyKind(kind: ClassUsageRow["kind"]): SelectorExplorerCategory {
  switch (kind) {
    case "class":
      return "class";
    case "id":
      return "id";
    case "tag":
      return "element";
    case "attribute":
      return "attribute";
    default:
      return "other";
  }
}

function mapLegacyConfidence(
  confidence: ClassUsageRow["confidence"],
  usageCount: number | null,
): SelectorExplorerStatus {
  switch (confidence) {
    case "confirmed":
      return "used";
    case "unused":
      return "unused";
    case "partial":
      return "partial";
    case "unsupported":
      return "unknown";
    default:
      return usageCount === null
        ? "unknown"
        : usageCount > 0
          ? "used"
          : "unused";
  }
}

function normalizeCategory(value: string): SelectorExplorerCategory {
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
    case "tag":
      return "element";
    case "pseudo-class":
    case "pseudo-element":
    case "pseudo_class":
    case "pseudo_element":
      return "pseudo";
    default:
      return "other";
  }
}

function normalizeStatus(value: string): SelectorExplorerStatus {
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

function overviewNote(analysis: GuiSelectorAnalysis): string {
  switch (analysis.completeness) {
    case "full":
      return `Core selector analysis: ${analysis.metrics.confirmedUsages} confirmed, ${analysis.metrics.partialMatches} partial, ${analysis.metrics.unresolvedSelectors} unresolved, ${analysis.metrics.unusedSelectors} unused. Created In and Used In are independent.`;
    case "symbols-only":
      return "Symbol bags without complete Core match rows — not full selector analysis.";
    case "legacy-class-only":
      return "Legacy class-only report — limited selector coverage.";
    case "absent":
      return (
        analysis.notes[0] ??
        "Selector analysis unavailable or unsupported schema."
      );
    default:
      return analysis.notes[0] ?? "";
  }
}

function compareFileHits(
  left: SelectorExplorerFileHit,
  right: SelectorExplorerFileHit,
): number {
  if (right.count !== left.count) {
    return right.count - left.count;
  }
  return left.file.localeCompare(right.file);
}

function compareRows(
  left: SelectorExplorerRow,
  right: SelectorExplorerRow,
  sortKey: SelectorExplorerSortKey,
  sortDir: SelectorExplorerSortDir,
): number {
  const dir = sortDir === "asc" ? 1 : -1;
  let primary = 0;

  switch (sortKey) {
    case "usages": {
      const leftUsage = left.usageCount ?? -1;
      const rightUsage = right.usageCount ?? -1;
      primary = leftUsage - rightUsage;
      break;
    }
    case "selector":
      primary = left.selector.localeCompare(right.selector);
      break;
    case "status":
      primary = statusOrder(left.status) - statusOrder(right.status);
      break;
    case "type":
      primary = categoryOrder(left.category) - categoryOrder(right.category);
      break;
    default:
      primary = 0;
  }

  if (primary !== 0) {
    return primary * dir;
  }

  // Stable tie-break: selector text, then id.
  const bySelector = left.selector.localeCompare(right.selector);
  if (bySelector !== 0) {
    return bySelector;
  }
  return left.id.localeCompare(right.id);
}

function statusOrder(status: SelectorExplorerStatus): number {
  switch (status) {
    case "used":
      return 0;
    case "partial":
      return 1;
    case "unused":
      return 2;
    case "unknown":
      return 3;
    default:
      return 9;
  }
}

function categoryOrder(category: SelectorExplorerCategory): number {
  switch (category) {
    case "class":
      return 0;
    case "id":
      return 1;
    case "element":
      return 2;
    case "attribute":
      return 3;
    case "universal":
      return 4;
    case "compound":
      return 5;
    case "combinator":
      return 6;
    case "pseudo":
      return 7;
    case "mixed":
      return 8;
    default:
      return 9;
  }
}
