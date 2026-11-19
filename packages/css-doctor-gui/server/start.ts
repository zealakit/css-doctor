import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createGuiHttpServer } from "./create-server";
import { listenGuiServer } from "./listen";
import { preloadStartupReport } from "./report/preload-startup";
import { guiLog } from "./services/log";
import { openBrowser } from "./services/open-browser";
import type { GuiServerListenResult, GuiServerOptions } from "./types";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export type StartGuiServerOptions = GuiServerOptions & {
  /** Print listen URL to stdout (default true). */
  printUrl?: boolean;
};

/**
 * Starts the local Web runtime: API + optional SPA static assets.
 * Loads an existing/preload report only — CSS analysis is owned by `css-doctor gui`.
 */
export async function startGuiServer(
  options: StartGuiServerOptions = {},
): Promise<GuiServerListenResult> {
  const apiOnly = options.apiOnly === true;
  const staticDir =
    options.staticDir ?? (apiOnly ? undefined : resolveDefaultStaticDir());

  if (!apiOnly && (!staticDir || !existsSync(join(staticDir, "index.html")))) {
    throw new Error(
      "Frontend build not found next to the css-doctor-gui package " +
        `(expected ${join(packageRoot, "dist", "index.html")}). ` +
        "Reinstall @zealakit/css-doctor-gui (packaged installs must include `dist/`), " +
        "or rebuild in the monorepo with `pnpm --filter @zealakit/css-doctor-gui build`.",
    );
  }

  const preload = await preloadStartupReport({
    reportPath: options.reportPath,
    cwd: options.cwd,
  });
  if (!preload.ok) {
    throw new Error(`Failed to preload report: ${preload.message}`);
  }
  if (preload.mode === "none") {
    guiLog("info", "no startup report found", {
      cwd: options.cwd ?? process.cwd(),
    });
  }

  const server = createGuiHttpServer({
    staticDir,
    apiOnly,
  });

  const listened = await listenGuiServer(server, options);
  guiLog("info", "server started", {
    url: listened.url,
    apiOnly: apiOnly ? "true" : "false",
  });

  if (options.printUrl !== false) {
    process.stdout.write(`css-doctor-gui listening on ${listened.url}\n`);
  }

  if (options.open !== false && !apiOnly) {
    const opened = await openBrowser(listened.url);
    if (!opened.ok) {
      guiLog("warn", "browser open failed", { message: opened.error });
      process.stderr.write(
        `css-doctor-gui: could not open browser (${opened.error}). Open ${listened.url} manually.\n`,
      );
    }
  }

  const originalClose = listened.close;
  listened.close = async () => {
    guiLog("info", "server shutting down", { url: listened.url });
    await originalClose();
  };

  return listened;
}

function resolveDefaultStaticDir(): string {
  // dist-server/ is next to dist/ when built with tsup from package root.
  return join(packageRoot, "dist");
}

export type { GuiServerOptions, GuiServerListenResult };
