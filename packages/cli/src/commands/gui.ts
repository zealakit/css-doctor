import type { Command } from "commander";

import {
  loadGuiServerModule,
  type GuiServerModule,
} from "../utils/resolve-gui";

export type GuiCliOptions = {
  port?: number;
  host?: string;
  open?: boolean;
  strictPort?: boolean;
  desktop?: boolean;
  report?: string;
};

export function registerGuiCommand(program: Command): void {
  program
    .command("gui")
    .description(
      "Open the CSS Doctor report viewer (local Web by default; --desktop launches the Tauri app when built)",
    )
    .option("-p, --port <number>", "Listen port", (value) => {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid --port value: ${value}`);
      }
      return port;
    })
    .option("--host <host>", "Bind host (default 127.0.0.1)")
    .option("--no-open", "Do not open a browser after listen")
    .option("--strict-port", "Fail if the requested port is busy")
    .option(
      "-r, --report <path>",
      "Preload a check/health/optimize/split/diff JSON report (Web mode)",
    )
    .option(
      "--desktop",
      "Launch the packaged/built Desktop app (does not fall back to Web)",
    )
    .action(async (options: GuiCliOptions) => {
      if (options.desktop === true) {
        await runDesktopMode();
        return;
      }

      await runWebMode(options);
    });
}

async function loadGuiOrThrow(): Promise<GuiServerModule> {
  const loaded = await loadGuiServerModule({
    cwd: process.cwd(),
    fromModuleUrl: import.meta.url,
  });
  if (!loaded.ok) {
    throw new Error(loaded.message);
  }
  return loaded.module;
}

async function runDesktopMode(): Promise<void> {
  const gui = await loadGuiOrThrow();
  const result = await gui.launchDesktopApp();
  if (!result.ok) {
    process.stderr.write(`css-doctor gui --desktop: ${result.message}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    [
      "css-doctor gui: desktop mode",
      `Launched: ${result.path}`,
      "Uses the same report viewer as Web mode.",
      "",
    ].join("\n"),
  );
}

async function runWebMode(options: GuiCliOptions): Promise<void> {
  const gui = await loadGuiOrThrow();
  const openBrowser = options.open !== false;

  process.stdout.write("css-doctor gui: starting web mode…\n");

  let listened: Awaited<ReturnType<GuiServerModule["startGuiServer"]>>;
  try {
    listened = await gui.startGuiServer({
      port: options.port,
      host: options.host,
      open: openBrowser,
      strictPort: options.strictPort === true,
      reportPath: options.report,
      // CLI owns the user-facing startup banner.
      printUrl: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message);
  }

  process.stdout.write(
    [
      "css-doctor gui: web mode",
      `URL:    ${listened.url}`,
      `Host:   ${listened.host}`,
      `Port:   ${listened.port}`,
      `Browser:${openBrowser ? " launch requested" : " skipped (--no-open)"}`,
      "Press Ctrl+C to stop.",
      "",
    ].join("\n"),
  );

  const shutdown = async () => {
    try {
      process.stdout.write("css-doctor gui: shutting down…\n");
      await listened.close();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}
