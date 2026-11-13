import { readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";

export type DiscoveredReport = {
  path: string;
  command: string | null;
  kind: "latest" | "other";
  mtimeMs: number | null;
  sizeBytes: number | null;
};

export type DiscoverReportsOptions = {
  cwd?: string;
  reportsDir?: string;
};

const LATEST_RE = /^(check|health|optimize|split|diff)-latest\.json$/i;

/**
 * Lists JSON envelopes under `.css-doctor/reports` (CLI `--save` layout).
 * Does not read or parse report bodies beyond the filename convention.
 */
export async function discoverProjectReports(
  options: DiscoverReportsOptions = {},
): Promise<
  | { ok: true; cwd: string; reports: DiscoveredReport[] }
  | { ok: false; message: string }
> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const reportsDir = resolve(cwd, options.reportsDir ?? ".css-doctor/reports");

  let entries: string[];
  try {
    entries = await readdir(reportsDir);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "ENOENT") {
      return { ok: true, cwd, reports: [] };
    }
    return {
      ok: false,
      message: `Unable to read reports directory: ${reportsDir}`,
    };
  }

  const reports: DiscoveredReport[] = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith(".json")) {
      continue;
    }
    const absolute = join(reportsDir, name);
    let mtimeMs: number | null = null;
    let sizeBytes: number | null = null;
    try {
      const info = await stat(absolute);
      if (!info.isFile()) {
        continue;
      }
      mtimeMs = info.mtimeMs;
      sizeBytes = info.size;
    } catch {
      continue;
    }

    const latestMatch = LATEST_RE.exec(name);
    reports.push({
      path: absolute,
      command: latestMatch?.[1]?.toLowerCase() ?? null,
      kind: latestMatch ? "latest" : "other",
      mtimeMs,
      sizeBytes,
    });
  }

  reports.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "latest" ? -1 : 1;
    }
    return (right.mtimeMs ?? 0) - (left.mtimeMs ?? 0);
  });

  return { ok: true, cwd, reports };
}

export function resolveProjectCwd(raw: string | undefined): string {
  if (!raw?.trim()) {
    return process.cwd();
  }
  return isAbsolute(raw) ? resolve(raw) : resolve(process.cwd(), raw);
}

export function displayReportLabel(path: string): string {
  return basename(path);
}
