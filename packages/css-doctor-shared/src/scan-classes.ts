/**
 * Static class-token extraction shared by Vite / Next / Rsbuild adapters.
 *
 * Intentionally conservative: literal `class` / `className` / `classList`
 * strings plus statically identifiable tokens inside simple expressions
 * (ternary string branches, template static segments). Helper calls
 * (`cn`, `clsx`, `cva`, ...) are resolved via `scanClassHelpers`; interpolated
 * or identifier arguments stay unknown (use `pageUsage` for those).
 */

import { extractClassLiterals } from "./extract-class-literals";
import { normalizeClassHelpers, scanClassHelpers } from "./scan-class-helpers";

let activeClassHelpers: readonly string[] | undefined;

/**
 * Sets the helper list used by `scanClasses` / `scanClassOccurrences` when no
 * explicit list is passed. Adapters call this once per build from their
 * validated `classHelpers` option (`undefined` restores the defaults).
 */
export function setActiveClassHelpers(
  helpers: readonly string[] | undefined,
): void {
  activeClassHelpers = helpers ? normalizeOrEmpty(helpers) : undefined;
}

function normalizeOrEmpty(helpers: readonly string[]): readonly string[] {
  // An explicit empty list disables helper resolution.
  return helpers.length === 0 ? [] : normalizeClassHelpers([...helpers]);
}

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
export function scanClasses(
  source: string,
  classes: Set<string>,
  classHelpers?: readonly string[],
): void {
  for (const [token, count] of collectClassOccurrences(source, classHelpers)) {
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
  classHelpers?: readonly string[],
): void {
  for (const [token, count] of collectClassOccurrences(source, classHelpers)) {
    counts.set(token, (counts.get(token) ?? 0) + count);
  }
}

function collectClassOccurrences(
  source: string,
  classHelpers?: readonly string[],
): Map<string, number> {
  const counts = new Map<string, number>();
  classHelpers = classHelpers ?? activeClassHelpers;

  // Helper calls (`cn`, `clsx`, `cva`, ...). Conditional object keys count as
  // possible usage so they are never reported dead. `[]` disables.
  if (!classHelpers || classHelpers.length > 0) {
    const scan = classHelpers
      ? scanClassHelpers(source, classHelpers)
      : scanClassHelpers(source);
    for (const call of scan.calls) {
      for (const token of [...call.confirmed, ...call.unresolved]) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
  }

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
