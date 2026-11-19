/**
 * Minimal CSS rule locator used to map browser coverage byte ranges to rules.
 *
 * Only finds style rules and descends into conditional at-rules (`@media`,
 * `@supports`, `@layer`, `@container`, `@scope`, `@starting-style`,
 * `@document`). `@keyframes`, `@font-face`, `@import` and friends are skipped:
 * coverage cannot say anything useful about them per selector.
 */

export type LocatedRule = {
  /** Whitespace-collapsed selectors of the rule's prelude. */
  selectors: string[];
  /** Offset of the first prelude character. */
  start: number;
  /** Offset one past the closing brace. */
  end: number;
};

const CONDITIONAL_AT_RULES = new Set([
  "media",
  "supports",
  "layer",
  "container",
  "scope",
  "starting-style",
  "document",
  "-moz-document",
]);

export function extractRules(css: string): LocatedRule[] {
  const rules: LocatedRule[] = [];
  walk(css, 0, css.length, rules, 0);
  return rules;
}

function walk(
  css: string,
  from: number,
  to: number,
  out: LocatedRule[],
  depth: number,
): void {
  if (depth > 32) {
    return;
  }
  let i = from;
  while (i < to) {
    i = skipTrivia(css, i, to);
    if (i >= to) {
      return;
    }
    const preludeStart = i;
    const stop = scanPrelude(css, i, to);
    if (stop < 0) {
      return;
    }
    if (css[stop] === ";") {
      i = stop + 1;
      continue;
    }
    if (css[stop] === "}") {
      // Stray closer: resync.
      i = stop + 1;
      continue;
    }
    // css[stop] === "{"
    const close = findBlockEnd(css, stop, to);
    const prelude = css.slice(preludeStart, stop).trim();
    if (prelude.startsWith("@")) {
      const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? "";
      if (CONDITIONAL_AT_RULES.has(name)) {
        walk(css, stop + 1, close, out, depth + 1);
      }
    } else if (prelude.length > 0) {
      out.push({
        selectors: splitSelectors(prelude),
        start: preludeStart,
        end: Math.min(close + 1, to),
      });
    }
    i = close + 1;
  }
}

/** Index of `{`, `;` or `}` that ends the prelude, or -1. */
function scanPrelude(css: string, from: number, to: number): number {
  let paren = 0;
  for (let i = from; i < to; i += 1) {
    const char = css[i];
    if (char === '"' || char === "'") {
      i = skipString(css, i, to);
    } else if (char === "/" && css[i + 1] === "*") {
      i = skipComment(css, i, to) - 1;
    } else if (char === "(" || char === "[") {
      paren += 1;
    } else if (char === ")" || char === "]") {
      paren = Math.max(0, paren - 1);
    } else if (paren === 0 && (char === "{" || char === ";" || char === "}")) {
      return i;
    }
  }
  return -1;
}

/** Index of the `}` matching the `{` at `open` (or `to - 1` when unbalanced). */
function findBlockEnd(css: string, open: number, to: number): number {
  let depth = 0;
  for (let i = open; i < to; i += 1) {
    const char = css[i];
    if (char === '"' || char === "'") {
      i = skipString(css, i, to);
    } else if (char === "/" && css[i + 1] === "*") {
      i = skipComment(css, i, to) - 1;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return to - 1;
}

function skipTrivia(css: string, from: number, to: number): number {
  let i = from;
  while (i < to) {
    if (/\s/.test(css[i] ?? "")) {
      i += 1;
    } else if (css[i] === "/" && css[i + 1] === "*") {
      i = skipComment(css, i, to);
    } else {
      break;
    }
  }
  return i;
}

function skipString(css: string, open: number, to: number): number {
  const quote = css[open];
  for (let i = open + 1; i < to; i += 1) {
    if (css[i] === "\\") {
      i += 1;
    } else if (css[i] === quote) {
      return i;
    }
  }
  return to;
}

function skipComment(css: string, open: number, to: number): number {
  const end = css.indexOf("*/", open + 2);
  return end < 0 || end + 2 > to ? to : end + 2;
}

/** Splits a selector list on top-level commas and collapses whitespace. */
export function splitSelectors(prelude: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < prelude.length; i += 1) {
    const char = prelude[i] ?? "";
    if (char === '"' || char === "'") {
      const end = skipString(prelude, i, prelude.length);
      current += prelude.slice(i, end + 1);
      i = end;
      continue;
    }
    if (char === "(" || char === "[") {
      depth += 1;
    } else if (char === ")" || char === "]") {
      depth = Math.max(0, depth - 1);
    }
    if (char === "," && depth === 0) {
      pushSelector(out, current);
      current = "";
    } else {
      current += char;
    }
  }
  pushSelector(out, current);
  return out;
}

function pushSelector(out: string[], raw: string): void {
  const value = raw.replace(/\s+/g, " ").trim();
  if (value) {
    out.push(value);
  }
}
