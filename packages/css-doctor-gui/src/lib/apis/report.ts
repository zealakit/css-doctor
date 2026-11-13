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

export async function fetchReport(): Promise<
  ReportApiSuccess | ReportApiError
> {
  const response = await fetch("/api/report", {
    headers: { accept: "application/json" },
  });
  return parseReportResponse(response);
}

export async function loadReportFile(input: {
  path: string;
  cwd?: string;
}): Promise<ReportApiSuccess | ReportApiError> {
  const response = await fetch("/api/report/load", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return parseReportResponse(response);
}

export async function uploadReportDocument(input: {
  report: unknown;
  label?: string;
}): Promise<ReportApiSuccess | ReportApiError> {
  const response = await fetch("/api/report/upload", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return parseReportResponse(response);
}

export async function generateReport(input: {
  patterns: string[];
  cwd?: string;
  threshold?: number;
}): Promise<ReportApiSuccess | ReportApiError> {
  const response = await fetch("/api/report/generate", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return parseReportResponse(response);
}

export async function reloadReport(): Promise<
  ReportApiSuccess | ReportApiError
> {
  const response = await fetch("/api/report/reload", {
    method: "POST",
    headers: { accept: "application/json" },
  });
  return parseReportResponse(response);
}

export async function clearReport(): Promise<{ ok: true } | ReportApiError> {
  const response = await fetch("/api/report/clear", {
    method: "POST",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    return {
      ok: false,
      code: `http_${response.status}`,
      message: `Clear failed (${response.status})`,
    };
  }
  return { ok: true };
}
