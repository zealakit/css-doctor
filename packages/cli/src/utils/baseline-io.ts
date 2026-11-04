import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import packageJson from "../../package.json";
import { loadBinding } from "./binding";
import {
  describeError,
  isDirectory,
  readCssFile,
  resolveCssFiles,
  toDisplayPath,
} from "./file";
import { readGitMetadata } from "./git-metadata";

export type BaselineDocumentJson = {
  schemaVersion: number;
  toolVersion: string;
  createdAt: string;
  health: {
    overall: number;
    grade: string;
    status: string;
    files: number;
    rules: number;
    selectors: number;
    declarations: number;
    sizeBytes: number;
  };
  files: Array<{ path: string; sizeBytes: number; contentHash: string }>;
  diagnostics: unknown[];
};

export type CreateBaselineSnapshotOptions = {
  cwd: string;
  patterns: string[];
  threshold?: number | null;
  createdAt?: string;
  includeGit?: boolean;
};

export type CreateBaselineSnapshotResult =
  | {
      ok: true;
      json: string;
      document: BaselineDocumentJson;
      files: number;
    }
  | {
      ok: false;
      errors: string[];
    };

/** Builds a baseline JSON document from matched CSS files. */
export async function createBaselineSnapshot(
  options: CreateBaselineSnapshotOptions,
): Promise<CreateBaselineSnapshotResult> {
  const cwd = options.cwd;
  const errors: string[] = [];

  if (options.patterns.length === 0) {
    return {
      ok: false,
      errors: [
        'No CSS files or glob patterns were provided. Example: css-doctor baseline create "src/**/*.css"',
      ],
    };
  }

  if (!(await isDirectory(cwd))) {
    return {
      ok: false,
      errors: [
        `Working directory does not exist or is not a directory: ${cwd}`,
      ],
    };
  }

  let files: string[] = [];
  try {
    files = await resolveCssFiles(options.patterns, cwd);
  } catch (error) {
    return {
      ok: false,
      errors: [`Failed to resolve CSS files: ${describeError(error)}`],
    };
  }

  if (files.length === 0) {
    return {
      ok: false,
      errors: [`No CSS files matched: ${options.patterns.join(", ")}`],
    };
  }

  try {
    const binding = loadBinding();
    const batchFiles = [];

    for (const file of files) {
      const read = await readCssFile(file);
      if (!read.ok) {
        errors.push(`${toDisplayPath(file, cwd)}: ${read.error}`);
        continue;
      }

      batchFiles.push({
        path: toDisplayPath(file, cwd),
        cssContent: read.content,
        sizeBytes: read.sizeBytes,
      });
    }

    if (batchFiles.length === 0) {
      return {
        ok: false,
        errors:
          errors.length > 0
            ? errors
            : ["No CSS files could be read for baseline creation."],
      };
    }

    const git = options.includeGit === false ? undefined : readGitMetadata(cwd);
    const json = binding.createBaseline({
      files: batchFiles,
      toolVersion: packageJson.version,
      createdAt: options.createdAt ?? new Date().toISOString(),
      patterns: options.patterns,
      threshold: options.threshold ?? undefined,
      project: {
        root: ".",
      },
      git,
    });

    const document = JSON.parse(json) as BaselineDocumentJson;
    return {
      ok: true,
      json,
      document,
      files: batchFiles.length,
    };
  } catch (error) {
    return {
      ok: false,
      errors: [...errors, describeError(error)],
    };
  }
}

export async function readBaselineFile(
  absolutePath: string,
): Promise<{ ok: true; json: string } | { ok: false; error: string }> {
  try {
    const json = await readFile(absolutePath, "utf8");
    return { ok: true, json };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return {
        ok: false,
        error: `Baseline not found at ${absolutePath}. Create one with \`css-doctor baseline create\`.`,
      };
    }

    return {
      ok: false,
      error: `Failed to read baseline ${absolutePath}: ${describeError(error)}`,
    };
  }
}

export async function writeBaselineFile(
  absolutePath: string,
  json: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `${json.trimEnd()}\n`, "utf8");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to write baseline ${absolutePath}: ${describeError(error)}`,
    };
  }
}

export async function removeBaselineFile(
  absolutePath: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await unlink(absolutePath);
    return { ok: true };
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    ) {
      return {
        ok: false,
        error: `Baseline not found at ${absolutePath}.`,
      };
    }

    return {
      ok: false,
      error: `Failed to remove baseline ${absolutePath}: ${describeError(error)}`,
    };
  }
}

export function validateBaselineJson(
  json: string,
  toolVersion = packageJson.version,
): { status: string; message?: string | null } {
  const binding = loadBinding();
  return binding.validateBaseline(json, toolVersion);
}
