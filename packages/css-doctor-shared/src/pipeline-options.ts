export const DEFAULT_MIN_PAGE_RATIO = 0.5;
export const DEFAULT_MAX_CHUNK_SIZE = 60 * 1_024;

export type ClampResult<T> = {
  value: T;
  /** Present when the configured value was replaced by a safe default. */
  warning?: string;
};

/**
 * Clamps `minPageRatio` to `[0, 1]`. Invalid values fall back to 0.5.
 * Preserves explicit `0` and `1`.
 */
export function clampMinPageRatio(configured: number): ClampResult<number> {
  if (Number.isFinite(configured) && configured >= 0 && configured <= 1) {
    return { value: configured };
  }

  return {
    value: DEFAULT_MIN_PAGE_RATIO,
    warning: "minPageRatio must be a number between 0 and 1; using 0.5",
  };
}

/**
 * Clamps `maxChunkSize` to a positive integer. Invalid values fall back to 60KiB.
 */
export function clampMaxChunkSize(configured: number): ClampResult<number> {
  if (Number.isInteger(configured) && configured > 0) {
    return { value: configured };
  }

  return {
    value: DEFAULT_MAX_CHUNK_SIZE,
    warning: `maxChunkSize must be a positive integer; using ${DEFAULT_MAX_CHUNK_SIZE}`,
  };
}
