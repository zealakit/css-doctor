/**
 * Static class-token extraction shared by Vite / Next / Rsbuild adapters.
 *
 * Intentionally conservative: literal `class` / `className` / `classList`
 * strings plus statically identifiable tokens inside simple expressions
 * (ternary string branches, template static segments). Helper-built strings
 * (`cn`, `clsx`) are not resolved — callers should use explicit `pageUsage`.
 */

import { extractClassLiterals } from "./extract-class-literals";

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
  for (const [token, count] of collectClassOccurrences(source)) {
    if (count > 0) {
      classes.add(token);
    }
  }
}

/**
 * Counts literal class-token occurrences in source (per token, case-insensitive).
 * Each confirmed static appearance increments the count by one.
 */
export function scanClassOccurrences(
  source: string,
  counts: Map<string, number>,
): void {
  for (const [token, count] of collectClassOccurrences(source)) {
    counts.set(token, (counts.get(token) ?? 0) + count);
  }
}

function collectClassOccurrences(source: string): Map<string, number> {
  const counts = new Map<string, number>();

  const attrPattern =
    /(?:class|className|:class|v-bind:class)\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|\{([^}]*)\})/g;
  for (const match of source.matchAll(attrPattern)) {
    addConfirmed(counts, valueFromAttrMatch(match));
  }

  const objectPattern =
    /(?:^|[,{;\s])(?:class|className)\s*:\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
  for (const match of source.matchAll(objectPattern)) {
    if (match[3] !== undefined) {
      addConfirmed(counts, `\`${match[3]}\``);
    } else {
      const value = match[1] ?? match[2];
      if (value !== undefined) {
        addConfirmed(counts, value);
      }
    }
  }

  const classListPattern =
    /classList\.(?:add|remove|toggle|contains)\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
  for (const match of source.matchAll(classListPattern)) {
    if (match[3] !== undefined) {
      addConfirmed(counts, `\`${match[3]}\``);
    } else {
      const value = match[1] ?? match[2];
      if (value !== undefined) {
        addConfirmed(counts, value);
      }
    }
  }

  return counts;
}

function valueFromAttrMatch(match: RegExpMatchArray): string {
  // Double / single quoted → plain inner text (static class list).
  if (match[1] !== undefined) {
    return match[1];
  }
  if (match[2] !== undefined) {
    return match[2];
  }
  // Template literal keeps backticks so ${} stripping works.
  if (match[3] !== undefined) {
    return `\`${match[3]}\``;
  }
  // JSX/expression binding.
  if (match[4] !== undefined) {
    return `{${match[4]}}`;
  }
  return "";
}

function addConfirmed(counts: Map<string, number>, raw: string): void {
  if (!raw) {
    return;
  }
  const extracted = extractClassLiterals(raw);
  for (const token of extracted.confirmed) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
}
