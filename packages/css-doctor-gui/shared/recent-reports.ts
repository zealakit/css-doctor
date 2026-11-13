import type { GuiReport } from "./report-model";

export type RecentReportEntry = {
  id: string;
  label: string;
  /** Server-accessible path when available; omitted for browser uploads. */
  path?: string;
  command: GuiReport["source"]["command"];
  sourceKind: GuiReport["source"]["kind"] | "upload" | "generate";
  openedAt: string;
};

const STORAGE_KEY = "css-doctor-gui.recent-reports.v1";
const MAX_ENTRIES = 12;

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function storage(): StorageLike | null {
  try {
    const candidate = (globalThis as { localStorage?: StorageLike })
      .localStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

export function loadRecentReports(): RecentReportEntry[] {
  const localStorage = storage();
  if (!localStorage) {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is RecentReportEntry => isRecentEntry(item))
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function saveRecentReports(entries: RecentReportEntry[]): void {
  const localStorage = storage();
  if (!localStorage) {
    return;
  }
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(entries.slice(0, MAX_ENTRIES)),
  );
}

export function rememberReport(
  report: GuiReport,
  options: { enabled: boolean; label?: string; path?: string } = {
    enabled: true,
  },
): RecentReportEntry[] {
  if (!options.enabled) {
    return loadRecentReports();
  }
  const label =
    options.label ??
    basenameLabel(options.path ?? report.source.path) ??
    `${report.source.command}-report.json`;
  const path = options.path ?? report.source.path;
  const entry: RecentReportEntry = {
    id: path ?? `upload:${report.source.command}:${label}`,
    label,
    path,
    command: report.source.command,
    sourceKind: report.source.kind,
    openedAt: new Date().toISOString(),
  };
  const next = [
    entry,
    ...loadRecentReports().filter((item) => item.id !== entry.id),
  ].slice(0, MAX_ENTRIES);
  saveRecentReports(next);
  return next;
}

export function removeRecentReport(id: string): RecentReportEntry[] {
  const next = loadRecentReports().filter((item) => item.id !== id);
  saveRecentReports(next);
  return next;
}

export function clearRecentReports(): RecentReportEntry[] {
  saveRecentReports([]);
  return [];
}

function isRecentEntry(value: unknown): value is RecentReportEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.label === "string" &&
    typeof record.command === "string" &&
    typeof record.sourceKind === "string" &&
    typeof record.openedAt === "string" &&
    (record.path === undefined || typeof record.path === "string")
  );
}

function basenameLabel(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}
