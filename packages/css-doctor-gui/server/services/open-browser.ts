import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Best-effort browser open. Failures are returned, never thrown.
 */
export async function openBrowser(
  url: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      await execFileAsync("open", [url]);
    } else if (platform === "win32") {
      await execFileAsync("cmd", ["/c", "start", "", url], {
        windowsHide: true,
      });
    } else {
      await execFileAsync("xdg-open", [url]);
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}
