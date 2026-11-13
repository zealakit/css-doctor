import { launchDesktopApp } from "./desktop";
import { startGuiServer } from "./start";

type ParsedArgs = {
  port?: number;
  host?: string;
  open: boolean;
  strictPort: boolean;
  help: boolean;
  desktop: boolean;
  reportPath?: string;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  if (args.desktop) {
    const result = await launchDesktopApp();
    if (!result.ok) {
      process.stderr.write(`css-doctor-gui --desktop: ${result.message}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(
      `css-doctor-gui: launched desktop app (${result.path})\n`,
    );
    return;
  }

  const listened = await startGuiServer({
    port: args.port,
    host: args.host,
    open: args.open,
    strictPort: args.strictPort,
    reportPath: args.reportPath,
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

function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    open: true,
    strictPort: false,
    help: false,
    desktop: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--no-open") {
      result.open = false;
    } else if (arg === "--strict-port") {
      result.strictPort = true;
    } else if (arg === "--desktop") {
      result.desktop = true;
    } else if (arg === "--report" || arg === "-r") {
      const value = argv[index + 1];
      index += 1;
      if (!value) {
        throw new Error("Missing value for --report");
      }
      result.reportPath = value;
    } else if (arg === "--port" || arg === "-p") {
      const value = argv[index + 1];
      index += 1;
      result.port = Number(value);
      if (!Number.isInteger(result.port)) {
        throw new Error(`Invalid --port value: ${value}`);
      }
    } else if (arg === "--host") {
      const value = argv[index + 1];
      index += 1;
      result.host = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return result;
}

function printHelp(): void {
  process.stdout.write(`Usage: css-doctor-gui [options]

Options:
  -p, --port <number>   Listen port (default 4193 with fallback 4194-4293)
  --host <host>         Bind host (default 127.0.0.1)
  --strict-port         Fail if the preferred/custom port is busy
  --no-open             Do not open a browser
  -r, --report <path>   Preload a check/health/optimize/split/diff JSON report
  --desktop             Launch built Desktop app (no Web fallback)
  -h, --help            Show help
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`css-doctor-gui: ${message}\n`);
  process.exitCode = 1;
});
