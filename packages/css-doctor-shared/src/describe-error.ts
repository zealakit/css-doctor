/** Stable string form for caught unknown errors at adapter/CLI boundaries. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
