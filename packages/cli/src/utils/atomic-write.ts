import { randomBytes } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { describeError } from "./file";

/**
 * Writes `content` via a sibling temp file then renames into place.
 */
export async function atomicWriteFile(
  absolutePath: string,
  content: string,
  options: { mode?: number; backup?: boolean } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const directory = dirname(absolutePath);
  const tempPath = join(
    directory,
    `.css-doctor-${randomBytes(8).toString("hex")}.tmp`,
  );

  try {
    await mkdir(directory, { recursive: true });

    if (options.backup === true) {
      try {
        await copyFile(absolutePath, `${absolutePath}.bak`);
      } catch {
        // Original may not exist yet.
      }
    }

    await writeFile(tempPath, content, "utf8");
    if (options.mode !== undefined) {
      await chmod(tempPath, options.mode);
    }
    await rename(tempPath, absolutePath);
    return { ok: true };
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // ignore
    }
    return {
      ok: false,
      error: `Failed to write ${absolutePath}: ${describeError(error)}`,
    };
  }
}
