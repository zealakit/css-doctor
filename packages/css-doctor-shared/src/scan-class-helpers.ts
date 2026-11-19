/**
 * Conservative resolution of class-helper calls (`clsx`, `cn`, `cva`, ...).
 *
 * Tokenizer based, no expression evaluation:
 * - string / static template parts / arrays of them -> confirmed
 * - object literal keys (`{ "is-active": cond }`)   -> unresolved (possible usage)
 * - `cva` / `tv` base + every variant value         -> confirmed
 * - identifiers, calls, spreads, interpolated names -> unknown (file + line)
 */

import { isClassToken } from "./scan-classes";

export const DEFAULT_CLASS_HELPERS = [
  "clsx",
  "cn",
  "cx",
  "classnames",
  "classNames",
  "twMerge",
  "twJoin",
  "cva",
  "tv",
] as const;

const VARIANT_HELPERS = new Set(["cva", "tv"]);
const IDENT = /^[A-Za-z_$][\w$]*$/;
const MAX_DEPTH = 24;

export type UnknownEvidence = {
  helper: string;
  /** 1-based line of the unresolvable argument. */
  line: number;
  /** Short source excerpt (trimmed, capped). */
  excerpt: string;
};

export type ClassHelperScan = {
  calls: ClassHelperCall[];
  unknown: UnknownEvidence[];
};

export type ClassHelperCall = {
  helper: string;
  line: number;
  column: number;
  confirmed: string[];
  unresolved: string[];
};

/**
 * Validates a user-supplied helper list; invalid entries are dropped.
 * Returns the defaults when the value is missing or yields nothing usable.
 */
export function normalizeClassHelpers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_CLASS_HELPERS];
  }
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && IDENT.test(item.trim())) {
      out.push(item.trim());
    }
  }
  return out.length > 0 ? [...new Set(out)] : [...DEFAULT_CLASS_HELPERS];
}

type Ctx = {
  source: string;
  helpers: Set<string>;
  pattern: RegExp;
  lineStarts: number[];
  scan: ClassHelperScan;
};

/**
 * Finds outermost helper calls in `source` and resolves their arguments.
 * Nested helper calls are folded into the enclosing call's result.
 */
export function scanClassHelpers(
  source: string,
  helpers: readonly string[] = DEFAULT_CLASS_HELPERS,
): ClassHelperScan {
  const scan: ClassHelperScan = { calls: [], unknown: [] };
  const names = normalizeClassHelpers([...helpers]);
  if (names.length === 0 || source.length === 0) {
    return scan;
  }
  const ctx: Ctx = {
    source,
    helpers: new Set(names),
    pattern: new RegExp(
      `(?<![\\w$])(${names.map(escapeRegExp).join("|")})\\s*\\(`,
      "g",
    ),
    lineStarts: buildLineStarts(source),
    scan,
  };

  let cursor = 0;
  while (cursor < source.length) {
    ctx.pattern.lastIndex = cursor;
    const match = ctx.pattern.exec(source);
    if (!match) {
      break;
    }
    const helper = match[1] ?? "";
    const start = match.index;
    const open = start + match[0].length - 1;
    cursor = open + 1;
    if (
      isDeclaration(source, start) ||
      isInsideLiteralOrComment(source, start)
    ) {
      continue;
    }
    const close = findClose(source, open);
    if (close < 0) {
      continue;
    }
    const call = newCall(ctx, helper, start);
    handleCallArgs(ctx, call, helper, open + 1, close, 0);
    call.confirmed = dedupe(call.confirmed);
    call.unresolved = dedupe(call.unresolved).filter(
      (token) => !call.confirmed.includes(token),
    );
    scan.calls.push(call);
    cursor = close + 1;
  }
  return scan;
}

function newCall(ctx: Ctx, helper: string, offset: number): ClassHelperCall {
  const { line, column } = lineColumn(ctx.lineStarts, offset);
  return { helper, line, column, confirmed: [], unresolved: [] };
}

function handleCallArgs(
  ctx: Ctx,
  call: ClassHelperCall,
  helper: string,
  start: number,
  end: number,
  depth: number,
): void {
  const args = splitTopLevel(ctx.source, start, end);
  const isVariant = VARIANT_HELPERS.has(helper);
  args.forEach((range, index) => {
    if (isVariant) {
      if (index === 0 && !looksLikeObject(ctx.source, range)) {
        analyzeArg(ctx, call, helper, range, depth);
      } else if (looksLikeObject(ctx.source, range)) {
        analyzeVariantConfig(ctx, call, helper, range, depth);
      } else {
        analyzeArg(ctx, call, helper, range, depth);
      }
      return;
    }
    analyzeArg(ctx, call, helper, range, depth);
  });
}

type Range = { start: number; end: number };

function analyzeArg(
  ctx: Ctx,
  call: ClassHelperCall,
  helper: string,
  range: Range,
  depth: number,
): void {
  const { start, end } = trimRange(ctx.source, range);
  if (start >= end) {
    return;
  }
  if (depth > MAX_DEPTH) {
    markUnknown(ctx, helper, start, end);
    return;
  }
  const text = ctx.source.slice(start, end);

  if (text.startsWith("...")) {
    markUnknown(ctx, helper, start, end);
    return;
  }

  if (text.startsWith("[") && findClose(ctx.source, start) === end - 1) {
    for (const item of splitTopLevel(ctx.source, start + 1, end - 1)) {
      analyzeArg(ctx, call, helper, item, depth + 1);
    }
    return;
  }

  if (text.startsWith("{") && findClose(ctx.source, start) === end - 1) {
    analyzeObjectKeys(ctx, call, helper, { start, end }, depth);
    return;
  }

  analyzeExpression(ctx, call, helper, { start, end }, depth);
}

/** Literals, conditionals, nested helper calls, bare identifiers. */
function analyzeExpression(
  ctx: Ctx,
  call: ClassHelperCall,
  helper: string,
  range: Range,
  depth: number,
): void {
  const { source } = ctx;
  let foundLiteral = false;
  let foundNested = false;
  let index = range.start;

  while (index < range.end) {
    const char = source[index] ?? "";
    if (char === '"' || char === "'") {
      const close = findStringEnd(source, index);
      if (close < 0 || close >= range.end) {
        break;
      }
      pushTokens(source.slice(index + 1, close), call.confirmed);
      foundLiteral = true;
      index = close + 1;
      continue;
    }
    if (char === "`") {
      const close = findTemplateEnd(source, index);
      if (close < 0 || close >= range.end) {
        break;
      }
      if (readTemplate(ctx, call, helper, index, close)) {
        foundLiteral = true;
      }
      index = close + 1;
      continue;
    }
    if (
      char === "/" &&
      (source[index + 1] === "/" || source[index + 1] === "*")
    ) {
      index = skipComment(source, index);
      continue;
    }
    if (isIdentStart(char) && !isIdentPart(source[index - 1] ?? "")) {
      let cursor = index + 1;
      while (cursor < range.end && isIdentPart(source[cursor] ?? "")) {
        cursor += 1;
      }
      const name = source.slice(index, cursor);
      let after = cursor;
      while (after < range.end && /\s/.test(source[after] ?? "")) {
        after += 1;
      }
      if (ctx.helpers.has(name) && source[after] === "(") {
        const close = findClose(source, after);
        if (close > 0 && close < range.end) {
          handleCallArgs(ctx, call, name, after + 1, close, depth + 1);
          foundNested = true;
          index = close + 1;
          continue;
        }
      }
      index = cursor;
      continue;
    }
    index += 1;
  }

  if (!foundLiteral && !foundNested) {
    markUnknown(ctx, helper, range.start, range.end);
  }
}

/** Reads a template literal: whole static tokens confirmed, adjacent ones unknown. */
function readTemplate(
  ctx: Ctx,
  call: ClassHelperCall,
  helper: string,
  open: number,
  close: number,
): boolean {
  const inner = ctx.source.slice(open + 1, close);
  let produced = false;
  let sawInterpolation = false;
  const parts: string[] = [];
  let current = "";
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === "$" && inner[i + 1] === "{") {
      const end = findClose(inner, i + 1);
      sawInterpolation = true;
      // Marker keeps "adjacent to interpolation" tokens out of confirmed.
      parts.push(current, "\u0000");
      current = "";
      if (end < 0) {
        break;
      }
      i = end;
      continue;
    }
    current += inner[i];
  }
  parts.push(current);

  const flat = parts.join("");
  for (const token of flat.split(/\s+/)) {
    if (!token || token.includes("\u0000")) {
      continue;
    }
    if (isClassToken(token)) {
      call.confirmed.push(token.toLowerCase());
      produced = true;
    }
  }
  if (sawInterpolation) {
    markUnknown(ctx, helper, open, close + 1);
  }
  return produced || sawInterpolation;
}

function analyzeObjectKeys(
  ctx: Ctx,
  call: ClassHelperCall,
  helper: string,
  range: Range,
  _depth: number,
): void {
  for (const entry of splitTopLevel(
    ctx.source,
    range.start + 1,
    range.end - 1,
  )) {
    const parsed = parseEntry(ctx.source, entry);
    if (!parsed) {
      continue;
    }
    if (parsed.kind === "spread" || parsed.kind === "computed") {
      markUnknown(ctx, helper, entry.start, entry.end);
      continue;
    }
    for (const token of parsed.key.split(/\s+/)) {
      if (isClassToken(token)) {
        call.unresolved.push(token.toLowerCase());
      }
    }
  }
}

/** `cva(base, { variants, compoundVariants })` / `tv({ base, slots, variants })`. */
function analyzeVariantConfig(
  ctx: Ctx,
  call: ClassHelperCall,
  helper: string,
  range: Range,
  depth: number,
): void {
  const { start, end } = trimRange(ctx.source, range);
  if (findClose(ctx.source, start) !== end - 1) {
    analyzeArg(ctx, call, helper, range, depth);
    return;
  }
  for (const entry of splitTopLevel(ctx.source, start + 1, end - 1)) {
    const parsed = parseEntry(ctx.source, entry);
    if (!parsed) {
      continue;
    }
    if (parsed.kind === "spread" || parsed.kind === "computed") {
      markUnknown(ctx, helper, entry.start, entry.end);
      continue;
    }
    if (parsed.kind !== "pair") {
      continue;
    }
    switch (parsed.key) {
      case "base":
      case "class":
      case "className":
        analyzeVariantValue(ctx, call, helper, parsed.value, depth + 1);
        break;
      case "slots":
        analyzeVariantValue(ctx, call, helper, parsed.value, depth + 1);
        break;
      case "variants":
        walkVariants(ctx, call, helper, parsed.value, depth + 1);
        break;
      case "compoundVariants":
      case "compoundSlots":
        walkCompound(ctx, call, helper, parsed.value, depth + 1);
        break;
      default:
        break;
    }
  }
}

/** variants: { size: { sm: "..", lg: ".." }, tone: { a: { slot: ".." } } } */
function walkVariants(
  ctx: Ctx,
  call: ClassHelperCall,
  helper: string,
  value: Range,
  depth: number,
): void {
  const object = asObject(ctx.source, value);
  if (!object) {
    markUnknown(ctx, helper, value.start, value.end);
    return;
  }
  for (const group of splitTopLevel(ctx.source, object.start, object.end)) {
    const parsedGroup = parseEntry(ctx.source, group);
    if (!parsedGroup) {
      continue;
    }
    if (parsedGroup.kind !== "pair") {
      markUnknown(ctx, helper, group.start, group.end);
      continue;
    }
    const options = asObject(ctx.source, parsedGroup.value);
    if (!options) {
      markUnknown(ctx, helper, group.start, group.end);
      continue;
    }
    for (const option of splitTopLevel(
      ctx.source,
      options.start,
      options.end,
    )) {
      const parsedOption = parseEntry(ctx.source, option);
      if (parsedOption?.kind === "pair") {
        analyzeVariantValue(ctx, call, helper, parsedOption.value, depth + 1);
      } else if (parsedOption) {
        markUnknown(ctx, helper, option.start, option.end);
      }
    }
  }
}

function walkCompound(
  ctx: Ctx,
  call: ClassHelperCall,
  helper: string,
  value: Range,
  depth: number,
): void {
  const trimmed = trimRange(ctx.source, value);
  if (ctx.source[trimmed.start] !== "[") {
    markUnknown(ctx, helper, trimmed.start, trimmed.end);
    return;
  }
  for (const item of splitTopLevel(
    ctx.source,
    trimmed.start + 1,
    trimmed.end - 1,
  )) {
    const object = asObject(ctx.source, item);
    if (!object) {
      continue;
    }
    for (const entry of splitTopLevel(ctx.source, object.start, object.end)) {
      const parsed = parseEntry(ctx.source, entry);
      if (
        parsed?.kind === "pair" &&
        (parsed.key === "class" || parsed.key === "className")
      ) {
        analyzeVariantValue(ctx, call, helper, parsed.value, depth + 1);
      }
    }
  }
}

/** A variant value may be a class expression, or a `{ slot: classes }` map. */
function analyzeVariantValue(
  ctx: Ctx,
  call: ClassHelperCall,
  helper: string,
  value: Range,
  depth: number,
): void {
  const object = asObject(ctx.source, value);
  if (!object) {
    analyzeArg(ctx, call, helper, value, depth);
    return;
  }
  for (const entry of splitTopLevel(ctx.source, object.start, object.end)) {
    const parsed = parseEntry(ctx.source, entry);
    if (parsed?.kind === "pair") {
      analyzeVariantValue(ctx, call, helper, parsed.value, depth + 1);
    } else if (parsed) {
      markUnknown(ctx, helper, entry.start, entry.end);
    }
  }
}

type Entry =
  | { kind: "pair"; key: string; value: Range }
  | { kind: "shorthand"; key: string }
  | { kind: "spread" }
  | { kind: "computed" };

function parseEntry(source: string, range: Range): Entry | null {
  const { start, end } = trimRange(source, range);
  if (start >= end) {
    return null;
  }
  const text = source.slice(start, end);
  if (text.startsWith("...")) {
    return { kind: "spread" };
  }
  if (text.startsWith("[")) {
    return { kind: "computed" };
  }

  let keyEnd = start;
  let key: string;
  const first = source[start] ?? "";
  if (first === '"' || first === "'") {
    const close = findStringEnd(source, start);
    if (close < 0) {
      return null;
    }
    key = source.slice(start + 1, close);
    keyEnd = close + 1;
  } else {
    while (keyEnd < end && /[\w$-]/.test(source[keyEnd] ?? "")) {
      keyEnd += 1;
    }
    key = source.slice(start, keyEnd);
    if (!key) {
      return null;
    }
  }

  let cursor = keyEnd;
  while (cursor < end && /\s/.test(source[cursor] ?? "")) {
    cursor += 1;
  }
  if (source[cursor] === ":") {
    return { kind: "pair", key, value: { start: cursor + 1, end } };
  }
  return { kind: "shorthand", key };
}

function asObject(source: string, range: Range): Range | null {
  const { start, end } = trimRange(source, range);
  if (source[start] !== "{" || findClose(source, start) !== end - 1) {
    return null;
  }
  return { start: start + 1, end: end - 1 };
}

function looksLikeObject(source: string, range: Range): boolean {
  const { start, end } = trimRange(source, range);
  return source[start] === "{" && findClose(source, start) === end - 1;
}

function markUnknown(
  ctx: Ctx,
  helper: string,
  start: number,
  end: number,
): void {
  const { line } = lineColumn(ctx.lineStarts, start);
  const excerpt = ctx.source.slice(start, end).replace(/\s+/g, " ").trim();
  ctx.scan.unknown.push({
    helper,
    line,
    excerpt: excerpt.length > 80 ? `${excerpt.slice(0, 77)}...` : excerpt,
  });
}

function pushTokens(value: string, target: string[]): void {
  for (const token of value.split(/\s+/)) {
    if (isClassToken(token)) {
      target.push(token.toLowerCase());
    }
  }
}

function trimRange(source: string, range: Range): Range {
  let { start, end } = range;
  while (start < end && /\s/.test(source[start] ?? "")) {
    start += 1;
  }
  while (end > start && /\s/.test(source[end - 1] ?? "")) {
    end -= 1;
  }
  return { start, end };
}

/** Splits [start,end) on top-level commas. Skips strings, templates, comments. */
function splitTopLevel(source: string, start: number, end: number): Range[] {
  const out: Range[] = [];
  let depth = 0;
  let segment = start;
  let index = start;
  while (index < end) {
    const char = source[index] ?? "";
    if (char === '"' || char === "'") {
      const close = findStringEnd(source, index);
      index = close < 0 ? end : close + 1;
      continue;
    }
    if (char === "`") {
      const close = findTemplateEnd(source, index);
      index = close < 0 ? end : close + 1;
      continue;
    }
    if (
      char === "/" &&
      (source[index + 1] === "/" || source[index + 1] === "*")
    ) {
      index = skipComment(source, index);
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      out.push({ start: segment, end: index });
      segment = index + 1;
    }
    index += 1;
  }
  if (segment < end) {
    out.push({ start: segment, end });
  }
  return out.filter(
    (range) => trimRange(source, range).start < trimRange(source, range).end,
  );
}

/** Index of the bracket matching `source[open]`, or -1. */
function findClose(source: string, open: number): number {
  const openChar = source[open];
  if (openChar !== "(" && openChar !== "[" && openChar !== "{") {
    return -1;
  }
  let depth = 0;
  let index = open;
  while (index < source.length) {
    const char = source[index] ?? "";
    if (char === '"' || char === "'") {
      const close = findStringEnd(source, index);
      if (close < 0) {
        return -1;
      }
      index = close + 1;
      continue;
    }
    if (char === "`") {
      const close = findTemplateEnd(source, index);
      if (close < 0) {
        return -1;
      }
      index = close + 1;
      continue;
    }
    if (
      char === "/" &&
      (source[index + 1] === "/" || source[index + 1] === "*")
    ) {
      index = skipComment(source, index);
      continue;
    }
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
    index += 1;
  }
  return -1;
}

function findStringEnd(source: string, open: number): number {
  const quote = source[open];
  for (let index = open + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
    } else if (char === quote) {
      return index;
    } else if (char === "\n") {
      return -1;
    }
  }
  return -1;
}

function findTemplateEnd(source: string, open: number): number {
  for (let index = open + 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
    } else if (char === "`") {
      return index;
    } else if (char === "$" && source[index + 1] === "{") {
      const close = findClose(source, index + 1);
      if (close < 0) {
        return -1;
      }
      index = close;
    }
  }
  return -1;
}

function skipComment(source: string, index: number): number {
  if (source[index + 1] === "/") {
    const newline = source.indexOf("\n", index);
    return newline < 0 ? source.length : newline + 1;
  }
  const close = source.indexOf("*/", index + 2);
  return close < 0 ? source.length : close + 2;
}

function isDeclaration(source: string, start: number): boolean {
  const before = source.slice(Math.max(0, start - 16), start);
  return /function\*?\s+$/.test(before);
}

/** True when `offset` sits on a `//` line comment (cheap guard). */
function isInsideLiteralOrComment(source: string, offset: number): boolean {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const prefix = source.slice(lineStart, offset);
  return /(^|[^:])\/\//.test(prefix);
}

function isIdentStart(char: string): boolean {
  return /[A-Za-z_$]/.test(char);
}

function isIdentPart(char: string): boolean {
  return /[\w$]/.test(char);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }
  return starts;
}

function lineColumn(
  lineStarts: number[],
  offset: number,
): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return { line: low + 1, column: offset - (lineStarts[low] ?? 0) + 1 };
}
