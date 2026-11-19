import {
  IncompatibleSchemaError,
  detectSourceCommand,
  normalizeUnknownReport,
} from "./normalize";
import type { GuiReport, GuiReportLoadResult } from "./report-model";

export type ParseReportJsonOptions = {
  /** Absolute path or display label for source metadata. */
  path?: string;
  /** Overrides auto-detected source kind path labeling. */
  label?: string;
};

/** Parses and validates CSS Doctor CLI JSON into a GuiReport. */
export function parseReportJson(
  parsed: unknown,
  options: ParseReportJsonOptions = {},
): GuiReportLoadResult {
  const command = detectSourceCommand(parsed);
  if (!command) {
    return {
      ok: false,
      code: "unsupported_format",
      message:
        "Unsupported report JSON. Expected css-doctor check/health/optimize/split/diff --json output.",
    };
  }

  try {
    const kind =
      command === "check"
        ? "check-json"
        : command === "health"
          ? "health-json"
          : command === "split"
            ? "split-json"
            : command === "diff"
              ? "diff-json"
              : "optimize-json";
    const report = normalizeUnknownReport(parsed, {
      source: {
        kind,
        command,
        path: options.path ?? options.label,
      },
    });
    return { ok: true, report };
  } catch (error) {
    if (error instanceof IncompatibleSchemaError) {
      return {
        ok: false,
        code: "incompatible_schema",
        message: error.message,
      };
    }
    return {
      ok: false,
      code: "validation_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parseReportJsonText(
  text: string,
  options: ParseReportJsonOptions = {},
): GuiReportLoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return {
      ok: false,
      code: "invalid_json",
      message: "Report content is not valid JSON.",
    };
  }
  return parseReportJson(parsed, options);
}

export type { GuiReport };
