import type { IncomingMessage, ServerResponse } from "node:http";

import { getCurrentReport, getReportSessionSource } from "../report/session";
import { sendJson } from "../services/http-json";

export function handleGetReport(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  const report = getCurrentReport();
  if (!report) {
    sendJson(res, 404, {
      ok: false,
      code: "no_report",
      message:
        "No report loaded. Launch via `css-doctor gui` so the CLI can run check once and preload this run's report.",
    });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    report,
    source: getReportSessionSource(),
  });
}
