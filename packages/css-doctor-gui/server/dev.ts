import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createServer as createViteServer } from "vite";

import { createGuiHttpServer } from "./create-server";
import { listenGuiServer } from "./listen";
import { openBrowser } from "./services/open-browser";

/**
 * Development entry: API server on PREFERRED_PORT (+ fallback) and Vite on 5173 with /api proxy.
 */
async function main(): Promise<void> {
  const apiServer = createGuiHttpServer({ apiOnly: true });
  const api = await listenGuiServer(apiServer, {
    // Match vite.config.ts /api proxy target (PREFERRED_PORT).
    strictPort: false,
    open: false,
  });

  process.stdout.write(`css-doctor-gui API (dev) on ${api.url}\n`);

  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const vite = await createViteServer({
    configFile: join(packageRoot, "vite.config.ts"),
    root: packageRoot,
    server: {
      proxy: {
        "/api": {
          target: `http://127.0.0.1:${api.port}`,
          changeOrigin: false,
        },
      },
    },
  });

  await vite.listen();
  const viteUrls = vite.resolvedUrls?.local ?? [];
  const viteUrl = viteUrls[0] ?? "http://127.0.0.1:5173/";
  process.stdout.write(`css-doctor-gui Vite (dev) on ${viteUrl}\n`);

  const opened = await openBrowser(viteUrl);
  if (!opened.ok) {
    process.stderr.write(
      `css-doctor-gui: could not open browser (${opened.error}). Open ${viteUrl} manually.\n`,
    );
  }

  const shutdown = async () => {
    await vite.close();
    await api.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`css-doctor-gui dev: ${message}\n`);
  process.exitCode = 1;
});
