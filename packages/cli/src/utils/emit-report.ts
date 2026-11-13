import { formatJsonReport } from "../formatters/json";
import {
  persistCliReport,
  type PersistableReport,
  type ReportPersistOptions,
} from "./report-io";

export type EmitReportOptions = ReportPersistOptions & {
  json?: boolean;
};

/**
 * Shared CLI emit path: optional JSON stdout + optional atomic disk persist.
 */
export async function emitCliReport(
  report: PersistableReport & Record<string, unknown>,
  options: EmitReportOptions,
  writeTerminal: () => void,
): Promise<void> {
  if (options.json === true) {
    process.stdout.write(`${formatJsonReport(report)}\n`);
  } else {
    writeTerminal();
  }

  if (options.out || options.save === true) {
    const persisted = await persistCliReport(report, options);
    if (!persisted.ok) {
      process.stderr.write(`css-doctor: ${persisted.error}\n`);
      process.exitCode = 1;
      return;
    }
    for (const path of persisted.paths) {
      process.stderr.write(`css-doctor: wrote report ${path}\n`);
    }
  }
}
