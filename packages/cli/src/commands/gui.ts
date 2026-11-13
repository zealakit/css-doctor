import type { Command } from "commander";

type GuiServerModule = typeof import("css-doctor-gui/server");

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

async function runDesktopMode(): Promise<void> {
  let launchDesktopApp: GuiServerModule["launchDesktopApp"];
  try {
    ({ launchDesktopApp } = (await import(
      "css-doctor-gui/server"
    )) as GuiServerModule);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      "Unable to load css-doctor-gui. Build it with " +
        "`pnpm --filter css-doctor-gui build`.\n" +
        message,
    );
  }

  const result = await launchDesktopApp();
  if (!result.ok) {
    process.stderr.write(`css-doctor gui --desktop: ${result.message}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `css-doctor gui: launched desktop app (${result.path})\n`,
  );
}

async function runWebMode(options: GuiCliOptions): Promise<void> {
  let startGuiServer: GuiServerModule["startGuiServer"];
  try {
    ({ startGuiServer } = (await import(
      "css-doctor-gui/server"
    )) as GuiServerModule);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      "Unable to load css-doctor-gui. Build it with " +
        "`pnpm --filter css-doctor-gui build`.\n" +
        message,
    );
  }

  const listened = await startGuiServer({
    port: options.port,
    host: options.host,
    open: options.open !== false,
    strictPort: options.strictPort === true,
    reportPath: options.report,
  });

  const shutdown = async () => {
    try {
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
