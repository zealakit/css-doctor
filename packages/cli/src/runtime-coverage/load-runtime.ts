import { resolve } from "node:path";

import {
  DEFAULT_COVERAGE_PATH,
  readCoverageFile,
  runtimeEvidenceFrom,
} from "./coverage-store";
import type {
  LoadEvidenceOptions,
  RuntimeEvidenceResult,
} from "./coverage-store";

/**
 * Loads runtime evidence for the `coverage` config setting
 * (`true` = default path, string = custom path, `false`/undefined = off).
 * Never throws: failures come back as warnings.
 */
export async function loadRuntimeEvidence(
  cwd: string,
  setting: boolean | string | null | undefined,
  options: LoadEvidenceOptions = {},
): Promise<RuntimeEvidenceResult | null> {
  if (setting === undefined || setting === null || setting === false) {
    return null;
  }
  const path = resolve(
    cwd,
    typeof setting === "string" ? setting : DEFAULT_COVERAGE_PATH,
  );
  try {
    const file = await readCoverageFile(path);
    const result = runtimeEvidenceFrom(file, options);
    if (file.entries.length === 0) {
      result.warnings.push(
        `Coverage enabled but ${path} has no entries; run \`css-doctor coverage import\` first.`,
      );
    }
    return result;
  } catch (error) {
    return {
      verdicts: new Map(),
      routes: [],
      warnings: [`Cannot read coverage ${path}: ${(error as Error).message}`],
    };
  }
}
