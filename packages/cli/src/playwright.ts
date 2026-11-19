/**
 * Playwright / Puppeteer helper that records CSS coverage for css-doctor.
 *
 * ```ts
 * import { collectCssCoverage } from "@zealakit/css-doctor-cli/playwright";
 *
 * test("blog page", async ({ page }) => {
 *   await collectCssCoverage(page, async () => {
 *     await page.goto("http://localhost:3000/blog/42");
 *   });
 * });
 * ```
 *
 * Then: `css-doctor coverage import .css-doctor/coverage-raw/*.json`.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

type CssCoverageEntry = {
  url: string;
  text?: string;
  ranges: Array<{ start: number; end: number }>;
};

/** The subset of Playwright's / Puppeteer's `Page` this helper needs. */
export type CoveragePage = {
  url(): string;
  coverage: {
    startCSSCoverage(options?: { resetOnNavigation?: boolean }): Promise<void>;
    stopCSSCoverage(): Promise<CssCoverageEntry[]>;
  };
};

export type CollectCssCoverageOptions = {
  /** Output file. Defaults to `.css-doctor/coverage-raw/<timestamp>.json`. */
  out?: string;
  /** Override the recorded page URL (defaults to `page.url()` after `run`). */
  pageUrl?: string;
  cwd?: string;
};

export type CssDoctorCoverageFile = {
  format: "css-doctor-coverage";
  pageUrl: string;
  entries: CssCoverageEntry[];
};

/**
 * Runs `run` while recording CSS coverage and writes an importable file.
 * Returns the recorded data and the path written.
 */
export async function collectCssCoverage(
  page: CoveragePage,
  run: () => Promise<void>,
  options: CollectCssCoverageOptions = {},
): Promise<{ file: CssDoctorCoverageFile; path: string }> {
  await page.coverage.startCSSCoverage({ resetOnNavigation: false });
  let entries: CssCoverageEntry[];
  try {
    await run();
  } finally {
    entries = await page.coverage.stopCSSCoverage();
  }

  const file: CssDoctorCoverageFile = {
    format: "css-doctor-coverage",
    pageUrl: options.pageUrl ?? page.url(),
    entries: entries.filter((entry) => typeof entry.text === "string"),
  };
  const cwd = resolve(options.cwd ?? process.cwd());
  const path = options.out
    ? resolve(cwd, options.out)
    : join(
        cwd,
        ".css-doctor/coverage-raw",
        `${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random()
          .toString(36)
          .slice(2, 8)}.json`,
      );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(file)}\n`);
  return { file, path };
}
