/**
 * Normalizes browser CSS coverage exports into one shape.
 *
 * Accepted inputs:
 * - Chrome DevTools "Coverage" export: `[{ url, text, ranges: [{start,end}] }]`
 * - Puppeteer / Playwright `page.coverage.stopCSSCoverage()`: same array shape
 * - css-doctor wrapper (written by the Playwright helper):
 *   `{ format: "css-doctor-coverage", pageUrl, entries: [...] }`
 * - CDP `CSS.takeCoverageDelta` rule usage when stylesheet text is supplied:
 *   `{ coverage: [{ styleSheetId, startOffset, endOffset, used }], styleSheets: { [id]: { url, text } } }`
 */

export type CoverageRange = { start: number; end: number };

export type CoverageInputFormat =
  | "devtools"
  | "puppeteer-playwright"
  | "css-doctor"
  | "cdp";

export type NormalizedCoverageEntry = {
  /** Page URL the coverage was collected on (empty when unknown). */
  pageUrl: string;
  stylesheetUrl: string;
  /** Built CSS text the ranges refer to. */
  text: string;
  usedRanges: CoverageRange[];
};

export type ParsedCoverage = {
  format: CoverageInputFormat;
  entries: NormalizedCoverageEntry[];
};

export function parseCoverageJson(
  raw: unknown,
  options: { pageUrl?: string } = {},
): ParsedCoverage {
  const fallbackPage = options.pageUrl ?? "";

  if (Array.isArray(raw)) {
    const entries = raw.map((item, index) =>
      entryFrom(item, fallbackPage, `entry ${index}`),
    );
    return { format: "puppeteer-playwright", entries };
  }

  if (isRecord(raw)) {
    if (raw.format === "css-doctor-coverage" && Array.isArray(raw.entries)) {
      const pageUrl =
        typeof raw.pageUrl === "string" ? raw.pageUrl : fallbackPage;
      return {
        format: "css-doctor",
        entries: raw.entries.map((item, index) =>
          entryFrom(item, options.pageUrl ?? pageUrl, `entry ${index}`),
        ),
      };
    }
    if (Array.isArray(raw.coverage) && isRecord(raw.styleSheets)) {
      return { format: "cdp", entries: fromCdp(raw, fallbackPage) };
    }
  }

  throw new Error(
    "Unrecognized coverage format. Expected a Chrome/Puppeteer/Playwright CSS coverage array, a css-doctor coverage file, or CDP rule usage with `styleSheets`.",
  );
}

function entryFrom(
  item: unknown,
  pageUrl: string,
  label: string,
): NormalizedCoverageEntry {
  if (!isRecord(item)) {
    throw new Error(`Coverage ${label} is not an object.`);
  }
  if (typeof item.text !== "string") {
    throw new Error(
      `Coverage ${label} has no stylesheet \`text\`; re-export with text included.`,
    );
  }
  if (!Array.isArray(item.ranges)) {
    throw new Error(`Coverage ${label} has no \`ranges\` array.`);
  }
  return {
    pageUrl: typeof item.pageUrl === "string" ? item.pageUrl : pageUrl,
    stylesheetUrl: typeof item.url === "string" ? item.url : "",
    text: item.text,
    usedRanges: normalizeRanges(item.ranges, item.text.length),
  };
}

function fromCdp(
  raw: Record<string, unknown>,
  pageUrl: string,
): NormalizedCoverageEntry[] {
  const sheets = raw.styleSheets as Record<string, unknown>;
  const byId = new Map<string, CoverageRange[]>();
  for (const usage of raw.coverage as unknown[]) {
    if (
      !isRecord(usage) ||
      typeof usage.styleSheetId !== "string" ||
      typeof usage.startOffset !== "number" ||
      typeof usage.endOffset !== "number"
    ) {
      continue;
    }
    if (usage.used === true) {
      const list = byId.get(usage.styleSheetId) ?? [];
      list.push({ start: usage.startOffset, end: usage.endOffset });
      byId.set(usage.styleSheetId, list);
    }
  }
  const entries: NormalizedCoverageEntry[] = [];
  for (const [id, sheet] of Object.entries(sheets)) {
    if (!isRecord(sheet) || typeof sheet.text !== "string") {
      throw new Error(`CDP stylesheet ${id} has no \`text\`.`);
    }
    entries.push({
      pageUrl,
      stylesheetUrl: typeof sheet.url === "string" ? sheet.url : id,
      text: sheet.text,
      usedRanges: normalizeRanges(byId.get(id) ?? [], sheet.text.length),
    });
  }
  return entries;
}

function normalizeRanges(
  value: unknown[],
  textLength: number,
): CoverageRange[] {
  const out: CoverageRange[] = [];
  for (const item of value) {
    if (
      isRecord(item) &&
      typeof item.start === "number" &&
      typeof item.end === "number" &&
      item.end > item.start
    ) {
      out.push({
        start: Math.max(0, item.start),
        end: Math.min(textLength, item.end),
      });
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
