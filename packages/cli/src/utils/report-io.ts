import { isAbsolute, join, resolve } from "node:path";

import { atomicWriteFile } from "./atomic-write";
import { formatJsonReport } from "../formatters/json";

export const DEFAULT_REPORTS_DIR = ".css-doctor/reports";

export type SaveableCommand =
  | "check"
  | "health"
  | "optimize"
  | "split"
  | "diff";

export type ReportPersistOptions = {
  /** Explicit output path for this run's JSON envelope. */
  out?: string;
  /** When true, also refresh `<command>-latest.json` if `success`. */
  save?: boolean;
  cwd?: string;
};

export type PersistableReport = {
  command: SaveableCommand;
  success: boolean;
};

/**
 * Persists a CLI JSON envelope.
 *
 * - `--out` always writes the envelope (success or failure).
 * - `--save` updates `.css-doctor/reports/<command>-latest.json` only when
 *   `success === true`, so a failed run cannot clobber the last good latest.
 */
export async function persistCliReport(
  report: PersistableReport & Record<string, unknown>,
  options: ReportPersistOptions,
): Promise<{ ok: true; paths: string[] } | { ok: false; error: string }> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const paths: string[] = [];
  const body = `${formatJsonReport(report)}\n`;

  if (options.out) {
    const absolute = isAbsolute(options.out)
      ? options.out
      : resolve(cwd, options.out);
    const written = await atomicWriteFile(absolute, body);
    if (!written.ok) {
      return written;
    }
    paths.push(absolute);
  }

  if (options.save === true) {
    if (report.success !== true) {
      return { ok: true, paths };
    }
    const latest = resolve(
      cwd,
      DEFAULT_REPORTS_DIR,
      `${report.command}-latest.json`,
    );
    const written = await atomicWriteFile(latest, body);
    if (!written.ok) {
      return written;
    }
    paths.push(latest);
  }

  return { ok: true, paths };
}

export function defaultLatestReportPath(
  command: SaveableCommand,
  cwd: string = process.cwd(),
): string {
  return join(resolve(cwd), DEFAULT_REPORTS_DIR, `${command}-latest.json`);
}
