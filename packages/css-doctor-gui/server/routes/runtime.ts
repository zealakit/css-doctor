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
      selectProject: false,
      openExternal: false,
      settings: true,
      recentReports: true,
      desktopSidecar: true,
    },
    phase: 6,
    hasReport: getCurrentReport() !== null,
    source,
    note: "Phase 6: release readiness — Web production + optional Tauri Node sidecar.",
  };
  const payload = JSON.stringify(body);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
