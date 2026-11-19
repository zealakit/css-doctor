import type { GuiReport } from "@shared/report-model";

export type ReportSessionSource = {
  kind: "file" | "upload" | "generate";
  path?: string;
  label: string;
  reloadable: boolean;
};

export type ReportApiError = {
  ok: false;
  code: string;
  message: string;
};

export type ReportApiSuccess = {
  ok: true;
  report: GuiReport;
  source?: ReportSessionSource | null;
};

async function parseReportResponse(
  response: Response,
): Promise<ReportApiSuccess | ReportApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      message: `Unexpected response (${response.status})`,
    };
  }

  if (
    body &&
    typeof body === "object" &&
    "ok" in body &&
    (body as { ok: unknown }).ok === true &&
    "report" in body
  ) {
    return body as ReportApiSuccess;
  }

  const record =
    body && typeof body === "object" ? (body as ReportApiError) : null;
  return {
    ok: false,
    code: record?.code ?? `http_${response.status}`,
    message: record?.message ?? `Request failed (${response.status})`,
  };
}

/** Read the report already loaded into the GUI session (no analysis). */
export async function fetchReport(): Promise<
  ReportApiSuccess | ReportApiError
> {
  const response = await fetch("/api/report", {
    headers: { accept: "application/json" },
  });
  return parseReportResponse(response);
}
