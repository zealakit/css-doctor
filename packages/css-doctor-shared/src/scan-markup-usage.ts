/**
 * Conservative static markup/symbol scanning for selector usage reporting.
 *
 * Builds on {@link scanSourceEvidence}: confirmed class / id / tag / attribute
 * hits stay in the flat maps used by CLI reports. Unresolved dynamic tokens are
 * exposed separately and must not be treated as confirmed usage.
 *
 * Does not resolve `cn`/`clsx`, CSS-in-JS, or runtime states (`:hover`).
 */

import { scanSourceEvidence } from "./scan-source-evidence";

export type MarkupUsageKind = "class" | "id" | "tag" | "attribute";

export type MarkupUsageBucket = {
  classes: Map<string, number>;
  ids: Map<string, number>;
  tags: Map<string, number>;
  /** Keys: attribute name, or `name=value` (lowercased). */
  attributes: Map<string, number>;
  /** Named but unresolved class tokens (not confirmed). */
  unresolvedClasses: Map<string, number>;
  unresolvedIds: Map<string, number>;
  unresolvedAttributes: Map<string, number>;
};

export function createMarkupUsageBucket(): MarkupUsageBucket {
  return {
    classes: new Map(),
    ids: new Map(),
    tags: new Map(),
    attributes: new Map(),
    unresolvedClasses: new Map(),
    unresolvedIds: new Map(),
    unresolvedAttributes: new Map(),
  };
}

/**
 * Scans one source file for literal class / id / tag / attribute evidence.
 */
export function scanMarkupUsage(
  source: string,
  bucket: MarkupUsageBucket = createMarkupUsageBucket(),
): MarkupUsageBucket {
  const evidence = scanSourceEvidence(source);
  mergeMap(bucket.classes, evidence.confirmed.classes);
  mergeMap(bucket.ids, evidence.confirmed.ids);
  mergeMap(bucket.tags, evidence.confirmed.tags);
  mergeMap(bucket.attributes, evidence.confirmed.attributes);
  mergeMap(bucket.unresolvedClasses, evidence.unresolved.classes);
  mergeMap(bucket.unresolvedIds, evidence.unresolved.ids);
  mergeMap(bucket.unresolvedAttributes, evidence.unresolved.attributes);
  return bucket;
}

/** @deprecated Prefer {@link scanMarkupUsage}; kept for focused unit tests. */
export function scanIdOccurrences(
  source: string,
  counts: Map<string, number>,
): void {
  const evidence = scanSourceEvidence(source);
  mergeMap(counts, evidence.confirmed.ids);
}

/** @deprecated Prefer {@link scanMarkupUsage}; kept for focused unit tests. */
export function scanTagOccurrences(
  source: string,
  counts: Map<string, number>,
): void {
  const evidence = scanSourceEvidence(source);
  mergeMap(counts, evidence.confirmed.tags);
}

/** @deprecated Prefer {@link scanMarkupUsage}; kept for focused unit tests. */
export function scanAttributeOccurrences(
  source: string,
  counts: Map<string, number>,
): void {
  const evidence = scanSourceEvidence(source);
  mergeMap(counts, evidence.confirmed.attributes);
}

function mergeMap(
  target: Map<string, number>,
  source: Map<string, number>,
): void {
  for (const [key, count] of source) {
    target.set(key, (target.get(key) ?? 0) + count);
  }
}
