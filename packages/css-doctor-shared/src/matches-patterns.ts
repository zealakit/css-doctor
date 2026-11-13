/**
 * Include/exclude matching used by Webpack/Rspack adapters.
 * String patterns use substring match; RegExp uses `.test`.
 */
export function matchesPatterns(
  value: string,
  patterns: Array<string | RegExp>,
): boolean {
  return patterns.some((pattern) =>
    typeof pattern === "string" ? value.includes(pattern) : pattern.test(value),
  );
}
