/** Formats a CLI report as pretty-printed JSON for CI/CD integration. */
export function formatJsonReport(report: unknown): string {
  return JSON.stringify(report, null, 2);
}
