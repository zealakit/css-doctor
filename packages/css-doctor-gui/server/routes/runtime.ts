import type { IncomingMessage, ServerResponse } from "node:http";

import { getCurrentReport, getReportSessionSource } from "../report/session";

export function handleRuntimeInfo(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  const source = getReportSessionSource();
  const body = {
    ok: true as const,
    runtime: "web" as const,
    capabilities: {
      loadReport: true,
      uploadReport: true,
      reloadReport: source?.reloadable === true,
      generateCheck: true,
      discoverReports: true,
      selectProject: false,
      openExternal: false,
      settings: true,
      recentReports: true,
      desktopSidecar: true,
    },
    phase: 7,
    hasReport: getCurrentReport() !== null,
    source,
    note: "Phase 7: CLI JSON envelopes are the shared report source; GUI discovers/loads them (generate-check is optional).",
  };
  const payload = JSON.stringify(body);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
