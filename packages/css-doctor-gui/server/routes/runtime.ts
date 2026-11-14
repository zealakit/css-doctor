import type { IncomingMessage, ServerResponse } from "node:http";

import { getCurrentReport, getReportSessionSource } from "../report/session";

export function handleRuntimeInfo(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  const body = {
    ok: true as const,
    runtime: "web" as const,
    capabilities: {
      loadReport: false,
      uploadReport: false,
      reloadReport: false,
      generateCheck: false,
      discoverReports: false,
      selectProject: false,
      openExternal: false,
      settings: true,
      recentReports: false,
      desktopSidecar: true,
    },
    phase: 8,
    hasReport: getCurrentReport() !== null,
    source: getReportSessionSource(),
    note: "GUI is a read-only viewer. `css-doctor gui` runs check once in the CLI and preloads that report.",
  };
  const payload = JSON.stringify(body);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
