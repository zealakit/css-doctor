import type { IncomingMessage, ServerResponse } from "node:http";
import { basename } from "node:path";

import { discoverProjectReports, resolveProjectCwd } from "../report/discover";
import { generateCheckReport } from "../report/generate-check";
import { loadReportFromFile } from "../report/load-file";
import {
  clearReportSession,
  getCurrentReport,
  getReportSessionSource,
  setCurrentReport,
  type GuiReportSessionSource,
} from "../report/session";
import {
  InvalidJsonBodyError,
  PayloadTooLargeError,
  readJsonBody,
  sendJson,
} from "../services/http-json";
import { guiLog, redactPath } from "../services/log";
import { parseReportJson } from "../../shared/parse-report-json";
import type { GuiReportLoadResult } from "../../shared/report-model";

export function handleGetReport(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  const report = getCurrentReport();
  if (!report) {
    sendJson(res, 404, {
      ok: false,
      code: "no_report",
      message: "No report loaded. Load a JSON report or run a check analysis.",
    });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    report,
    source: getReportSessionSource(),
  });
}

export async function handleLoadReport(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const path =
      body && typeof body === "object" && "path" in body
        ? String((body as { path?: unknown }).path ?? "")
        : "";
    const cwd =
      body && typeof body === "object" && "cwd" in body
        ? (body as { cwd?: unknown }).cwd
        : undefined;

    const result = await loadReportFromFile({
      path,
      cwd: typeof cwd === "string" ? cwd : undefined,
    });
    respondLoadResult(res, result, (report) => ({
      kind: "file",
      path: report.source.path,
      label: report.source.path
        ? basename(report.source.path)
        : path.trim() || "report.json",
      reloadable: true,
    }));
  } catch (error) {
    respondBodyError(res, error);
  }
}

export async function handleUploadReport(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    // Report JSON can exceed the default small API body limit.
    const body = await readJsonBody(req, 8 * 1024 * 1024);
    const record =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const label =
      typeof record.label === "string" && record.label.trim()
        ? record.label.trim()
        : "uploaded-report.json";

    if (!("report" in record)) {
      sendJson(res, 400, {
        ok: false,
        code: "validation_error",
        message: 'Upload body must include a "report" JSON document.',
      });
      return;
    }

    const result = parseReportJson(record.report, {
      path: label,
      label,
    });
    respondLoadResult(res, result, () => ({
      kind: "upload",
      label,
      reloadable: false,
    }));
  } catch (error) {
    respondBodyError(res, error);
  }
}

export async function handleGenerateReport(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const body = await readJsonBody(req);
    const record =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const patterns = Array.isArray(record.patterns)
      ? record.patterns.filter(
          (item): item is string => typeof item === "string",
        )
      : typeof record.pattern === "string"
        ? [record.pattern]
        : [];
    const cwd = typeof record.cwd === "string" ? record.cwd : undefined;
    const threshold =
      typeof record.threshold === "number" ? record.threshold : undefined;

    const result = await generateCheckReport({ patterns, cwd, threshold });
    respondLoadResult(res, result, () => ({
      kind: "generate",
      label: patterns.join(", ") || "generated-check",
      path: cwd,
      reloadable: false,
    }));
  } catch (error) {
    respondBodyError(res, error);
  }
}

export async function handleReloadReport(
  _req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const source = getReportSessionSource();
  if (!source) {
    sendJson(res, 404, {
      ok: false,
      code: "no_report",
      message: "No report source to reload.",
    });
    return;
  }
  if (!source.reloadable || source.kind !== "file" || !source.path) {
    sendJson(res, 400, {
      ok: false,
      code: "validation_error",
      message:
        "Current report cannot be reloaded from disk. Re-upload or load a file path instead. Reload does not re-run CSS analysis.",
    });
    return;
  }

  const result = await loadReportFromFile({ path: source.path });
  respondLoadResult(res, result, () => ({
    ...source,
    reloadable: true,
  }));
}

export function handleClearReport(
  _req: IncomingMessage,
  res: ServerResponse,
): void {
  clearReportSession();
  sendJson(res, 200, { ok: true });
}

export async function handleDiscoverReports(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const cwd = resolveProjectCwd(url.searchParams.get("cwd") ?? undefined);
    const discovered = await discoverProjectReports({ cwd });
    if (!discovered.ok) {
      sendJson(res, 500, {
        ok: false,
        code: "read_failure",
        message: discovered.message,
      });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      cwd: discovered.cwd,
      reports: discovered.reports,
      note: "Discovers CLI --save envelopes under .css-doctor/reports. Does not run analysis.",
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      code: "read_failure",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function respondLoadResult(
  res: ServerResponse,
  result: GuiReportLoadResult,
  sourceFor: (
    report: NonNullable<Extract<GuiReportLoadResult, { ok: true }>["report"]>,
  ) => GuiReportSessionSource,
): void {
  if (!result.ok) {
    // Failed load must not clear the existing session report.
    guiLog("warn", "report load failed", {
      code: result.code,
      message: result.message,
    });
    sendJson(res, statusForCode(result.code), {
      ok: false,
      code: result.code,
      message: result.message,
    });
    return;
  }
  const source = sourceFor(result.report);
  setCurrentReport(result.report, source);
  guiLog("info", "report loaded", {
    command: result.report.source.command,
    label: source.label,
    path: source.path ? redactPath(source.path) : undefined,
  });
  sendJson(res, 200, { ok: true, report: result.report, source });
}

function respondBodyError(res: ServerResponse, error: unknown): void {
  if (error instanceof PayloadTooLargeError) {
    sendJson(res, 413, {
      ok: false,
      code: "payload_too_large",
      message: "Request body is too large.",
    });
    return;
  }
  if (error instanceof InvalidJsonBodyError) {
    sendJson(res, 400, {
      ok: false,
      code: "invalid_json",
      message: "Request body must be valid JSON.",
    });
    return;
  }
  sendJson(res, 500, {
    ok: false,
    code: "read_failure",
    message: error instanceof Error ? error.message : String(error),
  });
}

function statusForCode(code: string): number {
  switch (code) {
    case "not_found":
    case "no_report":
      return 404;
    case "permission_denied":
      return 403;
    case "invalid_json":
    case "unsupported_format":
    case "incompatible_schema":
    case "validation_error":
      return 400;
    case "analysis_failure":
    case "read_failure":
      return 500;
    default:
      return 400;
  }
}
