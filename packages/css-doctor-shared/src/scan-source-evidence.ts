/**
 * One-pass source evidence extraction for selector usage matching.
 *
 * Produces per-element records (for compound / combinator matching in Core)
 * and flat symbol bags (for back-compat reports). Framework syntax is handled
 * conservatively: static literals are confirmed; unresolved expressions are
 * recorded separately and never invented.
 */

import {
  extractClassLiterals,
  extractFrameworkClassBinding,
} from "./extract-class-literals";

export type SourceElementEvidence = {
  /** Lowercased native HTML tag, or null for PascalCase components. */
  tag: string | null;
  /** Lowercased id when statically known. */
  id: string | null;
  /** Confirmed static class tokens on this element. */
  classes: string[];
  /** Class tokens named in dynamic bindings (not confirmed usage). */
  dynamicClasses: string[];
  /**
   * Attribute evidence: values are lowercased literals.
   * Empty array means presence-only (boolean / dynamic value).
   */
  attributes: Record<string, string[]>;
  /** Attribute names whose values could not be resolved. */
  dynamicAttributes: string[];
  parentIndex: number | null;
  depth: number;
  /** 1-based line of the opening `<`, when computable. */
  line: number | null;
  column: number | null;
};

export type SourceFileEvidence = {
  elements: SourceElementEvidence[];
  /** Confirmed flat occurrence counts (legacy / symbol reports). */
  confirmed: {
    classes: Map<string, number>;
    ids: Map<string, number>;
    tags: Map<string, number>;
    attributes: Map<string, number>;
  };
  /** Unresolved but named tokens (not confirmed usage). */
  unresolved: {
    classes: Map<string, number>;
    ids: Map<string, number>;
    attributes: Map<string, number>;
  };
};

const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

type TagEvent =
  | {
      kind: "open";
      offset: number;
      rawName: string;
      attrSource: string;
      selfClosing: boolean;
    }
  | { kind: "close"; offset: number; name: string };

/**
 * Scans one source file once and returns element + symbol evidence.
 */
export function scanSourceEvidence(source: string): SourceFileEvidence {
  const cleaned = stripScanNoise(source);
  const evidence = emptyEvidence();
  const lineStarts = buildLineStarts(cleaned);
  const events = collectTagEvents(cleaned);
  const stack: number[] = [];

  for (const event of events) {
    if (event.kind === "close") {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }

    const lower = event.rawName.toLowerCase();
    if (lower === "script" || lower === "style") {
      continue;
    }

    const isNative = /^[a-z]/.test(event.rawName);
    const parentIndex =
      stack.length > 0 ? (stack[stack.length - 1] ?? null) : null;
    const depth = stack.length;
    const { line, column } = offsetToLineColumn(lineStarts, event.offset);
    const parsed = parseAttributes(event.attrSource);

    const uniqueClasses = dedupe(parsed.classes);
    const element: SourceElementEvidence = {
      tag: isNative ? lower : null,
      id: parsed.id,
      classes: uniqueClasses,
      dynamicClasses: parsed.dynamicClasses,
      attributes: parsed.attributes,
      dynamicAttributes: parsed.dynamicAttributes,
      parentIndex,
      depth,
      line,
      column,
    };
    const index = evidence.elements.length;
    evidence.elements.push(element);

    if (isNative) {
      bump(evidence.confirmed.tags, lower, 1);
    }
    if (parsed.id) {
      bump(evidence.confirmed.ids, parsed.id, 1);
    } else if (parsed.hasDynamicId) {
      bump(evidence.unresolved.ids, "*", 1);
    }
    for (const token of parsed.classes) {
      bump(evidence.confirmed.classes, token, 1);
    }
    for (const token of parsed.dynamicClasses) {
      bump(evidence.unresolved.classes, token, 1);
    }
    for (const [name, values] of Object.entries(parsed.attributes)) {
      bump(evidence.confirmed.attributes, name, 1);
      for (const value of values) {
        bump(evidence.confirmed.attributes, `${name}=${value}`, 1);
      }
    }
    for (const name of parsed.dynamicAttributes) {
      bump(evidence.unresolved.attributes, name, 1);
      if (!Object.hasOwn(parsed.attributes, name)) {
        bump(evidence.confirmed.attributes, name, 1);
      }
    }

    const voidLike = event.selfClosing || VOID_TAGS.has(lower);
    if (!voidLike) {
      stack.push(index);
    }
  }

  scanLooseClassReferences(cleaned, evidence);
  return evidence;
}

function collectTagEvents(source: string): TagEvent[] {
  const events: TagEvent[] = [];

  const openRe = /<([A-Za-z][\w:-]*)(\s[^>]*?)?(\/?)>/g;
  for (const match of source.matchAll(openRe)) {
    const rawName = match[1];
    if (!rawName) {
      continue;
    }
    events.push({
      kind: "open",
      offset: match.index ?? 0,
      rawName,
      attrSource: match[2] ?? "",
      selfClosing: match[3] === "/",
    });
  }

  const closeRe = /<\/([a-z][a-z0-9:-]*)\s*>/gi;
  for (const match of source.matchAll(closeRe)) {
    events.push({
      kind: "close",
      offset: match.index ?? 0,
      name: (match[1] ?? "").toLowerCase(),
    });
  }

  events.sort((left, right) => left.offset - right.offset);
  return events;
}

type ParsedAttrs = {
  id: string | null;
  hasDynamicId: boolean;
  classes: string[];
  dynamicClasses: string[];
  attributes: Record<string, string[]>;
  dynamicAttributes: string[];
};

function parseAttributes(attrSource: string): ParsedAttrs {
  const result: ParsedAttrs = {
    id: null,
    hasDynamicId: false,
    classes: [],
    dynamicClasses: [],
    attributes: {},
    dynamicAttributes: [],
  };

  if (!attrSource.trim()) {
    return result;
  }

  const attrPattern =
    /([:@]?[A-Za-z_][\w:.-]*|class:[A-Za-z_][\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`|\{([^}]*)\}|([^\s"'`=<>]+)))?/g;

  for (const match of attrSource.matchAll(attrPattern)) {
    const rawName = match[1];
    if (!rawName) {
      continue;
    }
    const double = match[2];
    const single = match[3];
    const template = match[4];
    const brace = match[5];
    const bare = match[6];
    const lower = rawName.toLowerCase();

    if (
      lower === "class" ||
      lower === "classname" ||
      lower === ":class" ||
      lower === "v-bind:class"
    ) {
      const value =
        double ??
        single ??
        (template !== undefined ? `\`${template}\`` : null) ??
        (brace !== undefined ? `{${brace}}` : null) ??
        bare ??
        "";
      const extracted = extractFrameworkClassBinding(rawName, value);
      // Keep occurrence multiplicity for flat counts; dedupe on the element later.
      result.classes.push(...extracted.confirmed);
      result.dynamicClasses.push(...extracted.unresolved);
      continue;
    }

    if (/^class:/i.test(rawName)) {
      const extracted = extractFrameworkClassBinding(
        rawName,
        brace ?? double ?? single ?? "",
      );
      result.dynamicClasses.push(...extracted.unresolved);
      continue;
    }

    if (lower === "id" || lower === ":id" || lower === "v-bind:id") {
      if (double !== undefined || single !== undefined) {
        const value = (double ?? single ?? "").trim();
        if (value && isSimpleIdent(value)) {
          result.id = value.toLowerCase();
        }
      } else if (template !== undefined) {
        if (!/\$\{/.test(template) && isSimpleIdent(template.trim())) {
          result.id = template.trim().toLowerCase();
        } else {
          result.hasDynamicId = true;
        }
      } else {
        result.hasDynamicId = true;
      }
      continue;
    }

    if (lower.startsWith("on") || rawName === "..." || lower.startsWith("@")) {
      continue;
    }

    const attrName = lower.replace(/^:/, "").replace(/^v-bind:/, "");
    if (
      !attrName ||
      attrName === "class" ||
      attrName === "classname" ||
      attrName === "id"
    ) {
      continue;
    }

    if (double !== undefined || single !== undefined) {
      addAttr(
        result.attributes,
        attrName,
        (double ?? single ?? "").toLowerCase(),
      );
    } else if (template !== undefined) {
      if (/\$\{/.test(template)) {
        result.dynamicAttributes.push(attrName);
        addAttr(result.attributes, attrName, "");
      } else {
        addAttr(result.attributes, attrName, template.toLowerCase());
      }
    } else if (brace !== undefined) {
      result.dynamicAttributes.push(attrName);
      addAttr(result.attributes, attrName, "");
    } else if (bare !== undefined) {
      addAttr(result.attributes, attrName, bare.toLowerCase());
    } else {
      addAttr(result.attributes, attrName, "");
    }
  }

  // Flat occurrence list keeps duplicates; element.classes is unique.
  result.dynamicClasses = dedupe(result.dynamicClasses).filter(
    (token) => !result.classes.includes(token),
  );
  result.dynamicAttributes = dedupe(result.dynamicAttributes);
  return result;
}

function scanLooseClassReferences(
  source: string,
  evidence: SourceFileEvidence,
): void {
  const pattern =
    /classList\.(?:add|remove|toggle|contains)\(\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
  for (const match of source.matchAll(pattern)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    const wrapped = match[3] !== undefined ? `\`${value}\`` : `"${value}"`;
    const extracted = extractClassLiterals(wrapped);
    for (const token of extracted.confirmed) {
      bump(evidence.confirmed.classes, token, 1);
    }
  }
}

function addAttr(
  target: Record<string, string[]>,
  name: string,
  value: string,
): void {
  const existing = target[name] ?? [];
  if (value.length > 0 && !existing.includes(value)) {
    existing.push(value);
  }
  target[name] = existing;
}

function emptyEvidence(): SourceFileEvidence {
  return {
    elements: [],
    confirmed: {
      classes: new Map(),
      ids: new Map(),
      tags: new Map(),
      attributes: new Map(),
    },
    unresolved: {
      classes: new Map(),
      ids: new Map(),
      attributes: new Map(),
    },
  };
}

function bump(map: Map<string, number>, key: string, count: number): void {
  map.set(key, (map.get(key) ?? 0) + count);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

function isSimpleIdent(token: string): boolean {
  return (
    Boolean(token) &&
    token.length <= 256 &&
    !/[`${}]/.test(token) &&
    /^[A-Za-z_][\w-]*$/.test(token)
  );
}

function stripScanNoise(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
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

function offsetToLineColumn(
  lineStarts: number[],
  offset: number,
): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = lineStarts[mid] ?? 0;
    const next = lineStarts[mid + 1] ?? Number.POSITIVE_INFINITY;
    if (offset < start) {
      high = mid - 1;
    } else if (offset >= next) {
      low = mid + 1;
    } else {
      return { line: mid + 1, column: offset - start + 1 };
    }
  }
  return { line: 1, column: offset + 1 };
}
