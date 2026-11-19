/**
 * Conservative extraction of statically identifiable class tokens from
 * attribute values and framework class bindings.
 *
 * Does not evaluate expressions. Unresolved tokens are returned separately and
 * must not be treated as confirmed usage.
 */

import { isClassToken } from "./scan-classes";

export type ClassLiteralExtraction = {
  /** Tokens proven by static string literals. */
  confirmed: string[];
  /** Tokens named in source but gated by unresolved expressions. */
  unresolved: string[];
};

/**
 * Extracts class tokens from a raw class/className attribute value or binding.
 */
export function extractClassLiterals(raw: string): ClassLiteralExtraction {
  const confirmed: string[] = [];
  const unresolved: string[] = [];
  const trimmed = stripOuterQuotes(raw.trim());
  if (!trimmed) {
    return { confirmed, unresolved };
  }

  // Plain static class string (no braces / expressions).
  // Allow `:` inside tokens (Tailwind variants like `md:flex`).
  if (!/[`{?]/.test(trimmed) && !trimmed.includes("${")) {
    pushTokens(trimmed, confirmed);
    return { confirmed, unresolved };
  }

  // Template literal: keep static segments, ignore ${...}.
  if (raw.trim().startsWith("`") && raw.trim().endsWith("`")) {
    const inner = raw.trim().slice(1, -1);
    const staticParts = inner.split(/\$\{[\s\S]*?\}/g);
    for (const part of staticParts) {
      pushTokens(part, confirmed);
    }
    return { confirmed, unresolved };
  }

  const looksLikeObject =
    trimmed.startsWith("{") &&
    trimmed.endsWith("}") &&
    /[A-Za-z_'"`].*:/.test(trimmed);

  if (looksLikeObject) {
    const keys = collectObjectKeys(trimmed);
    for (const key of keys) {
      if (isClassToken(key)) {
        unresolved.push(key.toLowerCase());
      }
    }
    // Ternary/array string values inside the object/binding still count.
    const keySet = new Set(keys.map((key) => key.toLowerCase()));
    for (const literal of collectStringLiterals(trimmed)) {
      if (keySet.has(literal.value.toLowerCase().trim())) {
        continue;
      }
      if (literal.kind === "template" && literal.hasInterpolation) {
        for (const part of literal.value.split(/\s+/)) {
          if (isClassToken(part)) {
            confirmed.push(part.toLowerCase());
          }
        }
      } else {
        pushTokens(literal.value, confirmed);
      }
    }
    return {
      confirmed: confirmed.slice(),
      unresolved: dedupe(unresolved).filter(
        (token) => !confirmed.includes(token),
      ),
    };
  }

  // General expression: collect string / template literals.
  for (const literal of collectStringLiterals(
    raw.trim().startsWith("{") ? trimmed : raw.trim(),
  )) {
    if (literal.kind === "template" && literal.hasInterpolation) {
      for (const part of literal.value.split(/\s+/)) {
        if (isClassToken(part)) {
          confirmed.push(part.toLowerCase());
        }
      }
    } else {
      pushTokens(literal.value, confirmed);
    }
  }

  for (const name of collectSvelteClassDirectives(trimmed)) {
    if (isClassToken(name)) {
      unresolved.push(name.toLowerCase());
    }
  }

  return {
    confirmed: confirmed.slice(),
    unresolved: dedupe(unresolved).filter(
      (token) => !confirmed.includes(token),
    ),
  };
}

/**
 * Extracts class tokens from a full `class:foo={...}` / `:class="..."` attribute
 * source fragment (name + value).
 */
export function extractFrameworkClassBinding(
  attrName: string,
  attrValue: string | null,
): ClassLiteralExtraction {
  const name = attrName.trim();
  const lower = name.toLowerCase();

  // Svelte: class:active={isActive} or class:active
  const svelte = /^class:([A-Za-z_][\w:-]*)$/i.exec(name);
  if (svelte?.[1]) {
    const token = svelte[1].toLowerCase();
    return { confirmed: [], unresolved: isClassToken(token) ? [token] : [] };
  }

  if (
    lower === "class" ||
    lower === "classname" ||
    lower === ":class" ||
    lower === "v-bind:class"
  ) {
    return extractClassLiterals(attrValue ?? "");
  }

  return { confirmed: [], unresolved: [] };
}

function stripOuterQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function pushTokens(value: string, target: string[]): void {
  for (const token of value.split(/\s+/)) {
    if (!isClassToken(token)) {
      continue;
    }
    target.push(token.toLowerCase());
  }
}

type StringLiteral = {
  value: string;
  kind: "string" | "template";
  hasInterpolation: boolean;
};

function collectStringLiterals(source: string): StringLiteral[] {
  const out: StringLiteral[] = [];
  const pattern = /(["'`])((?:\\.|(?!\1).)*)\1/g;
  for (const match of source.matchAll(pattern)) {
    const quote = match[1];
    const value = (match[2] ?? "").replace(/\\([\\'"`])/g, "$1");
    if (quote === "`") {
      const hasInterpolation = /\$\{/.test(value);
      const staticOnly = value.replace(/\$\{[\s\S]*?\}/g, " ");
      out.push({
        value: staticOnly,
        kind: "template",
        hasInterpolation,
      });
    } else {
      out.push({ value, kind: "string", hasInterpolation: false });
    }
  }
  return out;
}

function collectObjectKeys(source: string): string[] {
  const keys: string[] = [];
  const pattern = /(?:^|[\{,]\s*)(?:["']([^"']+)["']|([A-Za-z_][\w-]*)\s*:)/g;
  for (const match of source.matchAll(pattern)) {
    const key = match[1] ?? match[2];
    if (key) {
      keys.push(key);
    }
  }
  return keys;
}

function collectSvelteClassDirectives(source: string): string[] {
  const names: string[] = [];
  const pattern = /\bclass:([A-Za-z_][\w:-]*)\b/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) {
      names.push(match[1]);
    }
  }
  return names;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
