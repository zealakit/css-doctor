import type {
  GuiCssUsage,
  GuiReport,
  GuiSelectorAnalysis,
  GuiSelectorRow,
} from "./report-model";

/** Symbol kind mirrored from Core + markup scanners. */
export type SelectorSymbolKind = "class" | "id" | "tag" | "attribute";

/** Where a selector symbol is defined (stylesheet). */
export type ClassDefinitionLocation = {
  file: string;
  /** Extensible source kind; check JSON currently yields `"css"` only. */
  sourceType: "css" | "unknown";
  /** Selector occurrences of this symbol in that definition file. */
  count: number;
};

/** Where a selector symbol is used/referenced with per-file occurrence counts. */
export type ClassUsageLocation = {
  file: string;
  count: number;
};

/**
 * Usage confidence for static analysis.
 * - confirmed: at least one confirmed structural match / literal hit
 * - unused: scan ran and found zero confirmed hits
 * - partial: Core reported partial structural matches only
 * - unsupported: symbol kind cannot be confirmed statically (reserved)
 * - unknown: unresolved / no usage scan in the report
 */
export type SelectorUsageConfidence =
  | "confirmed"
  | "unused"
  | "partial"
  | "unsupported"
  | "unknown";

export type ClassUsageRow = {
  kind: SelectorSymbolKind;
  /** Display selector (`.btn`, `#app`, `button`, `[disabled]`). */
  selector: string;
  /**
   * Back-compat alias for class display name.
   * Prefer `selector` for new UI.
   */
  className: string;
  /** Bare token used for search/sort (no leading `.` / `#`). */
  token: string;
  /** Sum of usage-location counts; null when usage data is unavailable. */
  usageCount: number | null;
  /** Distinct usage files; null when usage data is unavailable. */
  fileCount: number | null;
  confidence: SelectorUsageConfidence;
  definitions: ClassDefinitionLocation[];
  /**
   * Usage locations when the report provides them.
   * `null` means the report does not include usage/pageUsage data.
   */
  usages: ClassUsageLocation[] | null;
};

export type ClassUsageOverview = {
  /** True when at least definition or usage data is present. */
  available: boolean;
  /** True when per-file usage locations are present in the report. */
  usageAvailable: boolean;
  totalClasses: number | null;
  /** All selector symbols (class + id + tag + attribute). */
  totalSelectors: number | null;
  totalUsages: number | null;
  /** Symbols with usage data and zero source hits; null when usage unavailable. */
  deadClassCount: number | null;
  deadSelectorCount: number | null;
  /** Distinct definition files that define at least one symbol. */
  totalCssFiles: number | null;
  note?: string;
};

export type ClassUsageView = {
  overview: ClassUsageOverview;
  rows: ClassUsageRow[];
};

type SymbolKey = `${SelectorSymbolKind}:${string}`;

/**
 * Presentation projection:
 * - Created In ← CSS selector symbols from analyzeCss (definitions)
 * - Used In ← GuiCssAnalysis.usage when present (markup scan)
 *
 * Pseudo-classes / pseudo-elements are not claimed as source usage.
 */
export function buildClassUsageView(report: GuiReport): ClassUsageView {
  const analysis = report.cssAnalysis;
  if (!analysis) {
    return {
      overview: {
        available: false,
        usageAvailable: false,
        totalClasses: null,
        totalSelectors: null,
        totalUsages: null,
        deadClassCount: null,
        deadSelectorCount: null,
        totalCssFiles: null,
        note: "This report has no analyzeCss selector data (load a check JSON report).",
      },
      rows: [],
    };
  }

  const definitionsBySymbol = new Map<
    SymbolKey,
    Map<string, ClassDefinitionLocation>
  >();
  for (const selector of analysis.selectors) {
    accumulateDefinitionSymbols(definitionsBySymbol, selector);
  }

  const usagesBySymbol = readUsageMap(analysis.usage);
  const usageAvailable = usagesBySymbol !== null;

  if (definitionsBySymbol.size === 0 && !usageAvailable) {
    return {
      overview: {
        available: false,
        usageAvailable: false,
        totalClasses: null,
        totalSelectors: null,
        totalUsages: null,
        deadClassCount: null,
        deadSelectorCount: null,
        totalCssFiles: null,
        note: "No class/id/tag/attribute selectors were present in the loaded report.",
      },
      rows: [],
    };
  }

  const keys = new Set<SymbolKey>([
    ...definitionsBySymbol.keys(),
    ...(usagesBySymbol?.keys() ?? []),
  ]);

  const rows: ClassUsageRow[] = [];
  const definitionFiles = new Set<string>();
  let totalUsages = 0;

  for (const key of keys) {
    const { kind, token } = parseSymbolKey(key);
    const definitionMap = definitionsBySymbol.get(key);
    const definitions: ClassDefinitionLocation[] = definitionMap
      ? [...definitionMap.values()]
      : [];
    for (const item of definitions) {
      if (item.file !== "Unavailable") {
        definitionFiles.add(item.file);
      }
    }
    definitions.sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.file.localeCompare(right.file);
    });

    let usages: ClassUsageLocation[] | null = null;
    let usageCount: number | null = null;
    let fileCount: number | null = null;
    let confidence: SelectorUsageConfidence = "unknown";

    if (usageAvailable && usagesBySymbol) {
      const usageMap = usagesBySymbol.get(key) ?? new Map();
      usages = [];
      usageCount = 0;
      for (const [path, count] of usageMap) {
        usageCount += count;
        usages.push({ file: path, count });
      }
      usages.sort((left, right) => {
        if (right.count !== left.count) {
          return right.count - left.count;
        }
        return left.file.localeCompare(right.file);
      });
      fileCount = usages.length;
      totalUsages += usageCount;
      confidence = usageCount > 0 ? "confirmed" : "unused";
    }

    const selector = formatSelector(kind, token);
    rows.push({
      kind,
      token,
      selector,
      className: selector,
      usageCount,
      fileCount,
      confidence,
      definitions,
      usages,
    });
  }

  rows.sort((left, right) => compareSelectorRows(left, right, usageAvailable));

  const deadSelectorCount = usageAvailable
    ? rows.reduce((sum, row) => sum + ((row.usageCount ?? 0) === 0 ? 1 : 0), 0)
    : null;
  const deadClassCount = usageAvailable
    ? rows.reduce(
        (sum, row) =>
          sum + (row.kind === "class" && (row.usageCount ?? 0) === 0 ? 1 : 0),
        0,
      )
    : null;
  const totalClasses = rows.filter((row) => row.kind === "class").length;

  // Prefer Core selectorAnalysis aggregate metrics when completeness is full.
  // Do not invent metrics from React; only project Core/CLI contract fields.
  const selectorAnalysis = analysis.selectorAnalysis;
  const useCoreMetrics = selectorAnalysis?.completeness === "full";
  const overviewNote = buildOverviewNote(selectorAnalysis, usageAvailable);

  return {
    overview: {
      available: true,
      usageAvailable: useCoreMetrics ? true : usageAvailable,
      totalClasses,
      totalSelectors: useCoreMetrics
        ? selectorAnalysis.metrics.totalSelectors
        : rows.length,
      totalUsages: useCoreMetrics
        ? selectorAnalysis.metrics.confirmedUsages
        : usageAvailable
          ? totalUsages
          : null,
      deadClassCount,
      deadSelectorCount: useCoreMetrics
        ? selectorAnalysis.metrics.unusedSelectors
        : deadSelectorCount,
      totalCssFiles: definitionFiles.size,
      note: overviewNote,
    },
    rows,
  };
}

function buildOverviewNote(
  selectorAnalysis: GuiSelectorAnalysis | null,
  usageAvailable: boolean,
): string {
  if (selectorAnalysis) {
    const metrics = selectorAnalysis.metrics;
    switch (selectorAnalysis.completeness) {
      case "full":
        return `Core selector analysis: ${metrics.confirmedUsages} confirmed usages, ${metrics.partialMatches} partial, ${metrics.unresolvedSelectors} unresolved, ${metrics.unusedSelectors} unused. Definitions and usages are independent.`;
      case "symbols-only":
        return "Symbol bags present without full Core selector match rows. Do not treat as complete selector analysis.";
      case "legacy-class-only":
        return "Legacy class-only report — not interpreted as complete selector analysis.";
      case "absent":
        return (
          selectorAnalysis.notes[0] ??
          "Selector analysis unavailable or unsupported schema."
        );
      default:
        break;
    }
  }
  return usageAvailable
    ? "Usages are literal class/id/tag/attribute hits in source. Pseudo-states (:hover/:focus) and cn/clsx are not claimed."
    : "Usages unavailable — report has no classUsage (run `css-doctor gui` for a source scan).";
}

export function filterClassUsageRows(
  rows: ClassUsageRow[],
  query: string,
  kindFilter: SelectorSymbolKind | "all" = "all",
): ClassUsageRow[] {
  const kindFiltered =
    kindFilter === "all" ? rows : rows.filter((row) => row.kind === kindFilter);
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return kindFiltered;
  }
  return kindFiltered.filter((row) => {
    if (
      row.selector.toLowerCase().includes(needle) ||
      row.token.toLowerCase().includes(needle) ||
      row.kind.includes(needle)
    ) {
      return true;
    }
    const inDefinitions = row.definitions.some((item) =>
      item.file.toLowerCase().includes(needle),
    );
    if (inDefinitions) {
      return true;
    }
    return (row.usages ?? []).some((item) =>
      item.file.toLowerCase().includes(needle),
    );
  });
}

function compareSelectorRows(
  left: ClassUsageRow,
  right: ClassUsageRow,
  usageAvailable: boolean,
): number {
  if (usageAvailable) {
    const leftUsage = left.usageCount ?? -1;
    const rightUsage = right.usageCount ?? -1;
    if (rightUsage !== leftUsage) {
      return rightUsage - leftUsage;
    }
  } else {
    const leftDefs = definitionOccurrenceTotal(left);
    const rightDefs = definitionOccurrenceTotal(right);
    if (rightDefs !== leftDefs) {
      return rightDefs - leftDefs;
    }
  }
  if (left.kind !== right.kind) {
    return kindOrder(left.kind) - kindOrder(right.kind);
  }
  return left.token.localeCompare(right.token);
}

function kindOrder(kind: SelectorSymbolKind): number {
  switch (kind) {
    case "class":
      return 0;
    case "id":
      return 1;
    case "tag":
      return 2;
    case "attribute":
      return 3;
    default:
      return 9;
  }
}

function definitionOccurrenceTotal(row: ClassUsageRow): number {
  return row.definitions.reduce((sum, item) => sum + item.count, 0);
}

function accumulateDefinitionSymbols(
  bySymbol: Map<SymbolKey, Map<string, ClassDefinitionLocation>>,
  selector: GuiSelectorRow,
): void {
  const hasPath = Boolean(selector.filePath?.trim());
  const filePath = hasPath ? selector.filePath.trim() : "Unavailable";
  const sourceType = hasPath ? "css" : "unknown";

  for (const raw of selector.classes) {
    bumpDefinition(
      bySymbol,
      "class",
      normalizeToken(raw, "class"),
      filePath,
      sourceType,
    );
  }
  for (const raw of selector.ids) {
    bumpDefinition(
      bySymbol,
      "id",
      normalizeToken(raw, "id"),
      filePath,
      sourceType,
    );
  }
  for (const raw of selector.tags) {
    bumpDefinition(
      bySymbol,
      "tag",
      normalizeToken(raw, "tag"),
      filePath,
      sourceType,
    );
  }
  for (const raw of selector.attributes) {
    bumpDefinition(
      bySymbol,
      "attribute",
      normalizeToken(raw, "attribute"),
      filePath,
      sourceType,
    );
  }
}

function bumpDefinition(
  bySymbol: Map<SymbolKey, Map<string, ClassDefinitionLocation>>,
  kind: SelectorSymbolKind,
  token: string,
  filePath: string,
  sourceType: "css" | "unknown",
): void {
  if (!token) {
    return;
  }
  const key = symbolKey(kind, token);
  let fileMap = bySymbol.get(key);
  if (!fileMap) {
    fileMap = new Map();
    bySymbol.set(key, fileMap);
  }
  const existing = fileMap.get(filePath);
  if (existing) {
    existing.count += 1;
  } else {
    fileMap.set(filePath, { file: filePath, sourceType, count: 1 });
  }
}

function readUsageMap(
  usage: GuiCssUsage | null,
): Map<SymbolKey, Map<string, number>> | null {
  if (!usage) {
    return null;
  }
  const out = new Map<SymbolKey, Map<string, number>>();
  mergeUsageBucket(out, "class", usage.byClass);
  mergeUsageBucket(out, "id", usage.byId ?? {});
  mergeUsageBucket(out, "tag", usage.byTag ?? {});
  mergeUsageBucket(out, "attribute", usage.byAttribute ?? {});
  return out;
}

function mergeUsageBucket(
  out: Map<SymbolKey, Map<string, number>>,
  kind: SelectorSymbolKind,
  record: Record<string, Array<{ file: string; count: number }>>,
): void {
  for (const [rawToken, hits] of Object.entries(record)) {
    const token = normalizeToken(rawToken, kind);
    if (!token || !Array.isArray(hits)) {
      continue;
    }
    const key = symbolKey(kind, token);
    let fileMap = out.get(key);
    if (!fileMap) {
      fileMap = new Map();
      out.set(key, fileMap);
    }
    for (const hit of hits) {
      if (!hit || typeof hit.file !== "string" || !hit.file.trim()) {
        continue;
      }
      const count =
        typeof hit.count === "number" && Number.isFinite(hit.count)
          ? Math.max(0, Math.trunc(hit.count))
          : 0;
      const path = hit.file.trim();
      fileMap.set(path, (fileMap.get(path) ?? 0) + count);
    }
  }
}

function symbolKey(kind: SelectorSymbolKind, token: string): SymbolKey {
  return `${kind}:${token}`;
}

function parseSymbolKey(key: SymbolKey): {
  kind: SelectorSymbolKind;
  token: string;
} {
  const sep = key.indexOf(":");
  const kind = key.slice(0, sep) as SelectorSymbolKind;
  const token = key.slice(sep + 1);
  return { kind, token };
}

function normalizeToken(raw: string, kind: SelectorSymbolKind): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  if (kind === "class") {
    return trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
  }
  if (kind === "id") {
    return trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  }
  if (kind === "attribute") {
    // Core may emit `[name]` or bare name; usage uses `name` or `name=value`.
    return trimmed.replace(/^\[/, "").replace(/\]$/, "").replace(/^@/, "");
  }
  return trimmed;
}

function formatSelector(kind: SelectorSymbolKind, token: string): string {
  switch (kind) {
    case "class":
      return token.startsWith(".") ? token : `.${token}`;
    case "id":
      return token.startsWith("#") ? token : `#${token}`;
    case "attribute":
      if (token.startsWith("[")) {
        return token;
      }
      if (token.includes("=")) {
        const eq = token.indexOf("=");
        const name = token.slice(0, eq);
        const value = token.slice(eq + 1);
        return `[${name}="${value}"]`;
      }
      return `[${token}]`;
    default:
      return token;
  }
}
