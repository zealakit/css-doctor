import { resolve } from "node:path";

import {
  loadProjectConfig,
  resolveBaselinePath,
  type LoadedConfig,
} from "./config";
import { readBaselineFile } from "./baseline-io";
import { resolveCssFiles } from "./file";

export type ResolvedCheckPatterns = {
  patterns: string[];
  /** Where patterns came from for logging / diagnostics. */
  source: "cli" | "config" | "baseline" | "default" | "none";
  loaded: LoadedConfig;
};

/**
 * Documented / common project layouts from CLI README and examples.
 * Used only when CLI args, config, and baseline yield no patterns — and only
 * when `resolveCssFiles` finds at least one real stylesheet.
 */
const DISCOVERY_CANDIDATES = [
  "src/**/*.css",
  "styles/**/*.css",
  "*.css",
  "**/*.css",
] as const;

/**
 * Resolves CSS globs the same way other project-aware CLI commands do:
 * CLI args → `.css-doctor/config.json` `patterns` → baseline `config.patterns`.
 *
 * For GUI / project-aware callers, when those are empty, probes documented
 * candidates through existing `resolveCssFiles` (same ignores as `check`) and
 * keeps the first candidate that matches files. Does not invent a successful
 * empty run.
 */
export async function resolveCheckPatterns(
  cliPatterns: string[],
  options: { cwd?: string; configPath?: string; discover?: boolean } = {},
): Promise<ResolvedCheckPatterns> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const loaded = await loadProjectConfig(cwd, options.configPath);
  const discover = options.discover !== false;

  if (cliPatterns.length > 0) {
    return { patterns: cliPatterns, source: "cli", loaded };
  }

  if (loaded.config.patterns.length > 0) {
    return {
      patterns: loaded.config.patterns,
      source: "config",
      loaded,
    };
  }

  const baselinePath = resolveBaselinePath(cwd, loaded.config.baseline);
  const stored = await readBaselineFile(baselinePath);
  if (stored.ok) {
    try {
      const parsed = JSON.parse(stored.json) as {
        config?: { patterns?: unknown };
      };
      const fromBaseline = Array.isArray(parsed.config?.patterns)
        ? parsed.config.patterns.filter(
            (item): item is string =>
              typeof item === "string" && item.trim().length > 0,
          )
        : [];
      if (fromBaseline.length > 0) {
        return { patterns: fromBaseline, source: "baseline", loaded };
      }
    } catch {
      // Ignore malformed baseline; fall through.
    }
  }

  if (discover) {
    const discovered = await discoverCssPatterns(cwd);
    if (discovered) {
      return { patterns: discovered, source: "default", loaded };
    }
  }

  return { patterns: [], source: "none", loaded };
}

/**
 * Probe documented candidates with the same file resolver `check` uses.
 * Returns the first pattern list that matches at least one CSS file.
 */
export async function discoverCssPatterns(
  cwd: string,
): Promise<string[] | null> {
  for (const candidate of DISCOVERY_CANDIDATES) {
    const files = await resolveCssFiles([candidate], cwd);
    if (files.length > 0) {
      return [candidate];
    }
  }
  return null;
}

/** Actionable message when no patterns could be resolved for GUI startup. */
export function missingPatternsGuidance(): string {
  return [
    "No CSS files or glob patterns were provided.",
    'Pass patterns: css-doctor gui "src/**/*.css"',
    "Or set `patterns` in `.css-doctor/config.json`",
    "(same project config used by baseline/diff).",
  ].join(" ");
}
