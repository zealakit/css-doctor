import { spawnSync } from "node:child_process";

export type GitMetadata = {
  commit?: string;
  branch?: string;
  dirty?: boolean;
};

/**
 * Best-effort Git metadata. Missing Git or non-repo checkouts return `{}`.
 */
export function readGitMetadata(cwd: string): GitMetadata {
  try {
    const commit = runGit(cwd, ["rev-parse", "HEAD"]);
    const branch = runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const status = runGit(cwd, ["status", "--porcelain"]);
    if (!commit && !branch) {
      return {};
    }

    return {
      commit: commit || undefined,
      branch: branch || undefined,
      dirty: status === undefined ? undefined : status.length > 0,
    };
  } catch {
    return {};
  }
}

function runGit(cwd: string, args: string[]): string | undefined {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  if (result.status !== 0 || typeof result.stdout !== "string") {
    return undefined;
  }

  return result.stdout.trim();
}
