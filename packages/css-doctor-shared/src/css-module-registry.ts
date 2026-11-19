/**
 * Maps CSS Modules usage in JS source to the *emitted* (hashed) class names.
 *
 * Bundler adapters register `file -> { local: emitted }` maps (Vite via
 * `css.modules.getJSON`, webpack/Rspack from the css-loader module source),
 * then ask which emitted classes a JS module uses. Anything that cannot be
 * resolved statically keeps the module's classes alive instead of dropping
 * them. Modules no scanned chunk imports are reported so adapters can keep
 * their CSS in the common chunk.
 */

import { basename } from "node:path";

import { scanCssModuleUsage } from "./scan-css-modules";

export type CssModuleLocals = Record<string, string>;

export class CssModuleRegistry {
  private readonly maps = new Map<string, CssModuleLocals>();
  private readonly seen = new Set<string>();

  get size(): number {
    return this.maps.size;
  }

  /** Registers a module's local -> emitted class map (`file` may carry a query). */
  register(file: string, locals: CssModuleLocals): void {
    this.maps.set(stripQuery(file), { ...locals });
  }

  /** Forgets which modules were referenced (call at the start of each build pass). */
  resetSeen(): void {
    this.seen.clear();
  }

  /**
   * Adds the emitted classes used by `code` to `into`.
   *
   * `candidateFiles` narrows which registered modules may match an import
   * (e.g. Rollup's `importedIds`). Without it every registered module whose
   * basename matches is a candidate, which is a safe superset.
   */
  addUsedClasses(
    code: string,
    into: Set<string>,
    candidateFiles?: readonly string[],
  ): void {
    if (this.maps.size === 0 || !/\.module\./.test(code)) {
      return;
    }
    const candidates = candidateFiles
      ? candidateFiles.map(stripQuery).filter((id) => this.maps.has(id))
      : [...this.maps.keys()];

    for (const usage of scanCssModuleUsage(code)) {
      const name = basename(stripQuery(usage.specifier));
      for (const file of candidates) {
        if (basename(file) !== name) {
          continue;
        }
        const map = this.maps.get(file);
        if (!map) {
          continue;
        }
        this.seen.add(file);
        for (const local of usage.dynamic ? Object.keys(map) : usage.locals) {
          for (const token of (map[local] ?? "").split(/\s+/)) {
            if (token) {
              into.add(token.toLowerCase());
            }
          }
        }
      }
    }
  }

  /** Emitted classes of registered modules no scanned module imports. */
  unseenClasses(): string[] {
    const out: string[] = [];
    for (const [file, map] of this.maps) {
      if (!this.seen.has(file)) {
        for (const emitted of Object.values(map)) {
          out.push(...emitted.split(/\s+/).filter(Boolean));
        }
      }
    }
    return out;
  }

  /**
   * True when every scoped-looking class in `css` is a registered emitted
   * class, i.e. the asset can be analysed instead of skipped.
   * `scopedPattern` finds candidate scoped classes (bundler specific) and the
   * optional `isScoped` predicate filters out look-alikes (e.g. `.nav-active`).
   */
  coversAsset(
    css: string,
    scopedPattern: RegExp,
    isScoped: (className: string) => boolean = () => true,
  ): boolean {
    if (this.maps.size === 0) {
      return false;
    }
    const known = new Set<string>();
    for (const map of this.maps.values()) {
      for (const emitted of Object.values(map)) {
        for (const token of emitted.split(/\s+/)) {
          known.add(token);
        }
      }
    }
    const pattern = new RegExp(
      scopedPattern.source,
      scopedPattern.flags.includes("g")
        ? scopedPattern.flags
        : `${scopedPattern.flags}g`,
    );
    for (const match of css.matchAll(pattern)) {
      if (match[1] && isScoped(match[1]) && !known.has(match[1])) {
        return false;
      }
    }
    return true;
  }
}

/**
 * Extracts the `local -> emitted` map from css-loader generated JS, e.g.
 * `___CSS_LOADER_EXPORT___.locals = {"card":"a_card__x"}`,
 * `module.exports = {...}`, or `export default {...}`.
 * Returns null when no JSON object literal can be found.
 */
export function extractCssModuleLocals(source: string): CssModuleLocals | null {
  const anchors = [
    /\.locals\s*=\s*/,
    /module\.exports\s*=\s*/,
    /export\s+default\s+/,
    /exports\.locals\s*=\s*/,
  ];
  for (const anchor of anchors) {
    const match = anchor.exec(source);
    if (!match) {
      continue;
    }
    const start = source.indexOf("{", match.index + match[0].length - 1);
    if (start < 0 || start - (match.index + match[0].length) > 2) {
      continue;
    }
    const end = matchBrace(source, start);
    if (end < 0) {
      continue;
    }
    try {
      const parsed = JSON.parse(source.slice(start, end + 1)) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        Object.values(parsed).every((value) => typeof value === "string")
      ) {
        return parsed as CssModuleLocals;
      }
    } catch {
      // not plain JSON; try the next anchor
    }
  }
  return null;
}

function matchBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      for (i += 1; i < source.length && source[i] !== '"'; i += 1) {
        if (source[i] === "\\") {
          i += 1;
        }
      }
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function stripQuery(id: string): string {
  const index = id.indexOf("?");
  return index < 0 ? id : id.slice(0, index);
}
