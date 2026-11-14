import type { Command } from "commander";

import { formatCompactHealthSummary } from "../formatters/health-terminal";
import { formatTerminalReport } from "../formatters/terminal";
import { runGuiStartupAnalysis } from "../utils/gui-startup-analysis";
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
  /** Skip auto-check and preload this JSON report instead. */
  report?: string;
  threshold?: number;
  failUnder?: number;
};

export function registerGuiCommand(program: Command): void {
  program
    .command("gui")
    .description(
      "Run CSS check once, then open the local report viewer (Web by default; --desktop for Tauri)",
    )
    .argument(
      "[patterns...]",
      "CSS files or glob patterns (falls back to config.patterns)",
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
      "Skip auto-check and preload this JSON report (Web mode)",
    )
    .option(
      "--threshold <number>",
      "Warn when a file contains more than <number> selectors",
      (value) => {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 0) {
          throw new Error("threshold must be a non-negative integer");
        }
        return parsed;
      },
    )
    .option(
      "--fail-under <number>",
      "Treat overall health below <number> as a failed check (0-100)",
      (value) => {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
          throw new Error("fail-under must be an integer between 0 and 100");
        }
        return parsed;
      },
    )
    .option(
      "--desktop",
      "Launch the packaged/built Desktop app (does not fall back to Web)",
    )
    .action(async (patterns: string[], options: GuiCliOptions) => {
      if (options.desktop === true) {
        await runDesktopMode(patterns ?? [], options);
        return;
      }

      await runWebMode(patterns ?? [], options);
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

/**
 * Shared once-per-startup check. Skipped only when `--report` is provided.
 */
async function prepareStartupReport(
  patterns: string[],
  options: GuiCliOptions,
): Promise<{ reportPath: string; skippedCheck: boolean }> {
  const explicit = options.report?.trim();
  if (explicit) {
    process.stdout.write(
      "css-doctor gui: using --report (auto-check skipped)\n",
    );
    return { reportPath: explicit, skippedCheck: true };
  }

  process.stdout.write("css-doctor gui: running check…\n");
  const startup = await runGuiStartupAnalysis({
    patterns,
    cwd: process.cwd(),
    threshold: options.threshold,
    failUnder: options.failUnder,
  });

  process.stdout.write(
    `css-doctor gui: patterns from ${startup.patternSource}\n`,
  );
  process.stdout.write(`${formatTerminalReport(startup.report)}\n`);
  if (startup.report.health) {
    process.stdout.write(
      `${formatCompactHealthSummary(startup.report.health)}\n`,
    );
  }
  process.stderr.write(`css-doctor gui: wrote report ${startup.reportPath}\n`);
  if (startup.latestPath) {
    process.stderr.write(
      `css-doctor gui: updated latest ${startup.latestPath}\n`,
    );
  } else if (!startup.report.success) {
    process.stderr.write(
      "css-doctor gui: check did not succeed — previous check-latest.json (if any) was left unchanged\n",
    );
  }

  process.exitCode = startup.exitCode;
  return { reportPath: startup.reportPath, skippedCheck: false };
}

async function runDesktopMode(
  patterns: string[],
  options: GuiCliOptions,
): Promise<void> {
  // Same analysis workflow as Web; Desktop shell must not run a second check.
  await prepareStartupReport(patterns, options);

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
      "Uses the report from this startup check (sidecar loads project reports; no second analysis).",
      "",
    ].join("\n"),
  );
}

async function runWebMode(
  patterns: string[],
  options: GuiCliOptions,
): Promise<void> {
  const { reportPath } = await prepareStartupReport(patterns, options);

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
      reportPath,
      cwd: process.cwd(),
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
      `Report: ${reportPath}`,
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
      process.exit(process.exitCode ?? 0);
    }
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}
