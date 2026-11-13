/**
 * Static class-token extraction shared by Vite / Next / Rsbuild adapters.
 *
 * Intentionally conservative: only literal `class` / `className` / `classList`
 * string arguments are accepted. Helper-built strings (`cn`, `clsx`) are not
 * resolved here — callers should use explicit `pageUsage` for those.
 */

const CLASS_PATTERNS = [
  /(?:class|className)\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g,
  /(?:^|[,{;\s])(?:class|className)\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g,
  /classList\.(?:add|remove|toggle|contains)\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g,
];

/** Accept Tailwind-style tokens (`md:flex`, `w-1/2`, `w-[10px]`, `!p-2`). */
export function isClassToken(token: string): boolean {
  if (!token || token.length > 256) {
    return false;
  }

  // Reject template/expression leftovers while allowing arbitrary-value brackets.
  if (/[`${}]/.test(token)) {
    return false;
  }

  return /[A-Za-z_]/.test(token);
}

/**
 * Scans source text for literal class tokens and inserts lowercased names into
 * `classes`.
 */
export function scanClasses(source: string, classes: Set<string>): void {
  for (const pattern of CLASS_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const value = match[1] ?? match[2] ?? match[3];

      if (!value) {
        continue;
      }

      for (const token of value.split(/\s+/)) {
        if (isClassToken(token)) {
          classes.add(token.toLowerCase());
        }
      }
    }
  }
}
