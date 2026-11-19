import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { parseReportJsonText } from "../../shared/parse-report-json";
import type { GuiReportLoadResult } from "../../shared/report-model";

export type LoadReportFileOptions = {
  /** Absolute or relative path to a JSON report. */
  path: string;
  /** Base directory for relative paths (defaults to process.cwd()). */
  cwd?: string;
};

export async function loadReportFromFile(
  options: LoadReportFileOptions,
): Promise<GuiReportLoadResult> {
  const cwd = options.cwd ?? process.cwd();
  const rawPath = options.path.trim();
  if (!rawPath) {
    return {
      ok: false,
      code: "validation_error",
      message: "Report path is required.",
    };
  }

  const absolutePath = isAbsolute(rawPath)
    ? resolve(rawPath)
    : resolve(cwd, rawPath);

  if (!absolutePath.toLowerCase().endsWith(".json")) {
    return {
      ok: false,
      code: "unsupported_format",
      message: "Only .json report files are supported.",
    };
  }

  try {
    await access(absolutePath, constants.R_OK);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "ENOENT") {
      return {
        ok: false,
        code: "not_found",
        message: `Report file not found: ${absolutePath}`,
      };
    }
    if (code === "EACCES") {
      return {
        ok: false,
        code: "permission_denied",
        message: `Permission denied reading: ${absolutePath}`,
      };
    }
    return {
      ok: false,
      code: "read_failure",
      message: `Unable to access report file: ${absolutePath}`,
    };
  }

  let text: string;
  try {
    text = await readFile(absolutePath, "utf8");
  } catch {
    return {
      ok: false,
      code: "read_failure",
      message: `Failed to read report file: ${absolutePath}`,
    };
  }

  return parseReportJsonText(text, { path: absolutePath });
}
