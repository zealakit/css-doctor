/**
 * Source-side CSS Modules usage scan.
 *
 * Finds `import styles from "./x.module.css"` bindings and reports which
 * local class names the file reads: `styles.foo`, `styles["foo"]`,
 * `const { foo, "bar-baz": bar } = styles`, `import { foo } from "./x.module.css"`.
 * Dynamic access (`styles[x]`, `styles` passed around, `...styles`) marks the
 * whole module `dynamic`, so every local of that module must be treated as
 * possible usage rather than dead.
 *
 * Mapping locals to bundler-hashed names is the adapter's job; this module is
 * bundler-agnostic and never evaluates code.
 */

export type CssModuleUsage = {
  /** Import specifier exactly as written (`./button.module.css`). */
  specifier: string;
  /** Local class names read statically. */
  locals: string[];
  /** True when access could not be resolved statically. */
  dynamic: boolean;
};

const MODULE_SPECIFIER =
  /\.module\.(?:css|scss|sass|less|styl|stylus|pcss)(?:\?.*)?$/i;

export function isCssModuleSpecifier(specifier: string): boolean {
  return MODULE_SPECIFIER.test(specifier);
}

export function scanCssModuleUsage(source: string): CssModuleUsage[] {
  const out = new Map<string, { locals: Set<string>; dynamic: boolean }>();
  const entry = (specifier: string) => {
    let value = out.get(specifier);
    if (!value) {
      value = { locals: new Set(), dynamic: false };
      out.set(specifier, value);
    }
    return value;
  };

  const bindings = new Map<string, string>(); // identifier -> specifier

  // import styles from "./a.module.css" / import * as styles / import { foo, bar as b }
  const importRe =
    /import\s+(?:type\s+)?([^'"]*?)\s+from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importRe)) {
    const specifier = match[2];
    const clause = match[1];
    if (
      !specifier ||
      !isCssModuleSpecifier(specifier) ||
      clause === undefined
    ) {
      continue;
    }
    const target = entry(specifier);
    const named = /\{([^}]*)\}/.exec(clause);
    if (named?.[1]) {
      for (const part of named[1].split(",")) {
        const name = part
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (name && name !== "default") {
          target.locals.add(name);
        }
      }
    }
    const withoutNamed = clause.replace(/\{[^}]*\}/, "");
    const ns = /\*\s+as\s+([\w$]+)/.exec(withoutNamed);
    const def = /^\s*([\w$]+)\s*,?/.exec(
      withoutNamed.replace(/\*\s+as\s+[\w$]+/, ""),
    );
    for (const id of [ns?.[1], def?.[1]]) {
      if (id) {
        bindings.set(id, specifier);
      }
    }
    // `import { default as styles }`
    const alias = /default\s+as\s+([\w$]+)/.exec(clause);
    if (alias?.[1]) {
      bindings.set(alias[1], specifier);
    }
  }

  // Dynamic `import("./a.module.css")` cannot be tied to bindings.
  for (const match of source.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (match[1] && isCssModuleSpecifier(match[1])) {
      entry(match[1]).dynamic = true;
    }
  }

  for (const [id, specifier] of bindings) {
    const target = entry(specifier);
    const name = escapeRegExp(id);

    // Destructuring: const { a, "b-c": d, ...rest } = styles
    for (const match of source.matchAll(
      new RegExp(`\\{([^{}]*)\\}\\s*=\\s*${name}(?![\\w$])`, "g"),
    )) {
      for (const part of (match[1] ?? "").split(",")) {
        const piece = part.trim();
        if (!piece) {
          continue;
        }
        if (piece.startsWith("...")) {
          target.dynamic = true;
          continue;
        }
        const key = /^(?:["']([^"']+)["']|([\w$]+))/.exec(piece);
        const local = key?.[1] ?? key?.[2];
        if (local) {
          target.locals.add(local);
        } else {
          target.dynamic = true;
        }
      }
    }

    let accounted = 0;
    // styles.foo
    for (const match of source.matchAll(
      new RegExp(`(?<![\\w$.])${name}\\s*\\??\\.\\s*([\\w$-]+)`, "g"),
    )) {
      if (match[1]) {
        target.locals.add(match[1]);
      }
      accounted += 1;
    }
    // styles["foo"] / styles['foo']
    for (const match of source.matchAll(
      new RegExp(
        `(?<![\\w$.])${name}\\s*\\??\\.?\\[\\s*(['"])([^'"]+)\\1\\s*\\]`,
        "g",
      ),
    )) {
      if (match[2]) {
        target.locals.add(match[2]);
      }
      accounted += 1;
    }
    // styles[expr]
    for (const match of source.matchAll(
      new RegExp(
        `(?<![\\w$.])${name}\\s*\\??\\.?\\[\\s*([^'"\\s\\]][^\\]]*)\\]`,
        "g",
      ),
    )) {
      if (match[1]) {
        target.dynamic = true;
        accounted += 1;
      }
    }

    // Any other mention (passed as prop, spread, aliased) is opaque.
    const total = [
      ...source.matchAll(new RegExp(`(?<![\\w$.])${name}(?![\\w$])`, "g")),
    ].length;
    const declared = 1; // the import binding itself
    const destructured = [
      ...source.matchAll(new RegExp(`\\}\\s*=\\s*${name}(?![\\w$])`, "g")),
    ].length;
    if (total - declared - destructured > accounted) {
      target.dynamic = true;
    }
  }

  return [...out.entries()].map(([specifier, value]) => ({
    specifier,
    locals: [...value.locals].sort(),
    dynamic: value.dynamic,
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
