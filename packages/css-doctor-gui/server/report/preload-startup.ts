import { basename } from "node:path";

import { discoverProjectReports, type DiscoveredReport } from "./discover";
import { loadReportFromFile } from "./load-file";
import { setCurrentReport } from "./session";
import { guiLog, redactPath } from "../services/log";

export type StartupPreloadOptions = {
  /** Explicit report path (CLI `--report`). */
  reportPath?: string;
  /** Project cwd for discovery (default process.cwd()). */
  cwd?: string;
};

export type StartupPreloadResult =
  | { ok: true; path: string; mode: "explicit" | "discovered" }
  | { ok: true; path: null; mode: "none" }
  | { ok: false; mode: "explicit"; message: string };

/**
 * Prefer an explicit report path; otherwise discover `.css-doctor/reports`
 * and load the preferred latest envelope. Does not run CSS analysis.
 */
export async function preloadStartupReport(
  options: StartupPreloadOptions = {},
): Promise<StartupPreloadResult> {
  const explicit = options.reportPath?.trim();
  if (explicit) {
    const loaded = await loadReportFromFile({ path: explicit });
    if (!loaded.ok) {
      return { ok: false, mode: "explicit", message: loaded.message };
    }
    setCurrentReport(loaded.report, {
      kind: "file",
      path: loaded.report.source.path,
      label: loaded.report.source.path
        ? basename(loaded.report.source.path)
        : basename(explicit),
      reloadable: true,
    });
    return { ok: true, path: explicit, mode: "explicit" };
  }

  const discovered = await discoverProjectReports({ cwd: options.cwd });
  if (!discovered.ok) {
    guiLog("warn", "startup discover failed", { message: discovered.message });
    return { ok: true, path: null, mode: "none" };
  }

  const preferred = pickPreferredReport(discovered.reports);
  if (!preferred) {
    return { ok: true, path: null, mode: "none" };
  }

  const loaded = await loadReportFromFile({ path: preferred.path });
  if (!loaded.ok) {
    guiLog("warn", "startup report load failed", {
      path: redactPath(preferred.path),
      message: loaded.message,
    });
    return { ok: true, path: null, mode: "none" };
  }

  setCurrentReport(loaded.report, {
    kind: "file",
    path: loaded.report.source.path,
    label: loaded.report.source.path
      ? basename(loaded.report.source.path)
      : basename(preferred.path),
    reloadable: true,
  });

  guiLog("info", "startup report loaded", {
    path: redactPath(preferred.path),
    command: loaded.report.source.command,
  });

  return { ok: true, path: preferred.path, mode: "discovered" };
}

/**
 * Prefer check-latest, then other *-latest, then newest JSON by mtime.
 */
export function pickPreferredReport(
  reports: DiscoveredReport[],
): DiscoveredReport | null {
  if (reports.length === 0) {
    return null;
  }

  const checkLatest = reports.find(
    (item) => item.kind === "latest" && item.command === "check",
  );
  if (checkLatest) {
    return checkLatest;
  }

  const anyLatest = reports.find((item) => item.kind === "latest");
  if (anyLatest) {
    return anyLatest;
  }

  return reports[0] ?? null;
}
