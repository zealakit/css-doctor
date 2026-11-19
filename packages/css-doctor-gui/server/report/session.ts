import type { GuiReport } from "../../shared/report-model";

export type GuiReportSourceKind = "file" | "upload" | "generate";

export type GuiReportSessionSource = {
  kind: GuiReportSourceKind;
  /** Absolute path when kind is file; display label otherwise. */
  path?: string;
  label: string;
  reloadable: boolean;
};

type GuiReportSession = {
  report: GuiReport | null;
  source: GuiReportSessionSource | null;
};

let session: GuiReportSession = {
  report: null,
  source: null,
};

export function getCurrentReport(): GuiReport | null {
  return session.report;
}

export function getReportSessionSource(): GuiReportSessionSource | null {
  return session.source;
}

export function getReportSession(): GuiReportSession {
  return session;
}

export function setCurrentReport(
  report: GuiReport | null,
  source?: GuiReportSessionSource | null,
): void {
  if (report === null) {
    session = { report: null, source: null };
    return;
  }
  session = {
    report,
    source:
      source === undefined ? session.source : source === null ? null : source,
  };
}

export function clearReportSession(): void {
  session = { report: null, source: null };
}
