import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const GUI_PACKAGE_NAME = "@zealakit/css-doctor-gui";

export type GuiServerModule = {
  startGuiServer: (options?: {
    port?: number;
    host?: string;
    open?: boolean;
    strictPort?: boolean;
    reportPath?: string;
    cwd?: string;
    printUrl?: boolean;
    apiOnly?: boolean;
    staticDir?: string;
  }) => Promise<{
    url: string;
    host: string;
    port: number;
    close: () => Promise<void>;
  }>;
  launchDesktopApp: () => Promise<
    | { ok: true; command: string; args: string[]; path: string }
    | { ok: false; code: string; message: string }
  >;
};

export type ResolveGuiResult =
  | { ok: true; entryPath: string; resolvedFrom: string }
  | { ok: false; message: string };

export type ResolveGuiOptions = {
  /** Project directory to search first (default: process.cwd()). */
  cwd?: string;
  /**
   * Secondary resolve base (CLI package module URL/path). Used when the
   * project does not declare @zealakit/css-doctor-gui but a linked install is
   * visible next to the CLI (monorepo / optional peer hoisting).
   */
  fromModuleUrl?: string | URL;
};

/**
 * Resolves the GUI server entry from the consuming project, then ancestors,
 * then the CLI package location. Uses filesystem `node_modules` walks only
 * (no createRequire) so resolution stays tied to real installs.
 */
export function resolveGuiServerEntry(
  options: ResolveGuiOptions = {},
): ResolveGuiResult {
  const cwd = resolve(options.cwd ?? process.cwd());
  const moduleBase = options.fromModuleUrl
    ? moduleUrlToPath(options.fromModuleUrl)
    : fileURLToPath(import.meta.url);

  const fromProject = findGuiEntryFromDirectory(cwd);
  if (fromProject) {
    return {
      ok: true,
      entryPath: fromProject,
      resolvedFrom: `project:${cwd}`,
    };
  }

  const fromModule = findGuiEntryFromDirectory(dirname(moduleBase));
  if (fromModule) {
    return {
      ok: true,
      entryPath: fromModule,
      resolvedFrom: `module:${moduleBase}`,
    };
  }

  return { ok: false, message: formatMissingGuiMessage(cwd) };
}

export async function loadGuiServerModule(
  options: ResolveGuiOptions = {},
): Promise<
  | { ok: true; module: GuiServerModule; entryPath: string }
  | { ok: false; message: string }
> {
  const resolved = resolveGuiServerEntry(options);
  if (!resolved.ok) {
    return resolved;
  }

  try {
    const imported = (await import(
      pathToFileURL(resolved.entryPath).href
    )) as GuiServerModule;
    if (
      typeof imported.startGuiServer !== "function" ||
      typeof imported.launchDesktopApp !== "function"
    ) {
      return {
        ok: false,
        message:
          `Resolved ${GUI_PACKAGE_NAME} at ${resolved.entryPath}, but it does not export startGuiServer/launchDesktopApp.\n` +
          "Reinstall or rebuild css-doctor-gui.",
      };
    }
    return {
      ok: true,
      module: imported,
      entryPath: resolved.entryPath,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message:
        `Failed to load ${GUI_PACKAGE_NAME} from ${resolved.entryPath}.\n` +
        `${detail}\n` +
        "Ensure the package is built (dist/ + dist-server/) and installed.",
    };
  }
}

export function formatMissingGuiMessage(cwd: string = process.cwd()): string {
  const install = detectInstallCommand(cwd);
  return [
    "CSS Doctor GUI is not installed.",
    "",
    "Install it in your project:",
    "",
    `  ${install}`,
    "",
    "Then run: css-doctor gui",
  ].join("\n");
}

export function detectInstallCommand(cwd: string = process.cwd()): string {
  const agent = process.env.npm_config_user_agent?.toLowerCase() ?? "";
  if (agent.includes("pnpm") || existsSync(join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm add -D @zealakit/css-doctor-gui";
  }
  if (agent.includes("yarn") || existsSync(join(cwd, "yarn.lock"))) {
    return "yarn add -D @zealakit/css-doctor-gui";
  }
  if (agent.includes("bun") || existsSync(join(cwd, "bun.lockb"))) {
    return "bun add -D @zealakit/css-doctor-gui";
  }
  return "npm install -D @zealakit/css-doctor-gui";
}

function findGuiEntryFromDirectory(startDir: string): string | null {
  let directory = resolve(startDir);
  for (;;) {
    const entry = join(
      directory,
      "node_modules",
      "@zealakit",
      "css-doctor-gui",
      "dist-server",
      "index.js",
    );
    if (existsSync(entry)) {
      return entry;
    }

    const parent = dirname(directory);
    if (parent === directory) {
      break;
    }
    directory = parent;
  }
  return null;
}

function moduleUrlToPath(value: string | URL): string {
  if (typeof value !== "string") {
    return fileURLToPath(value);
  }
  if (value.startsWith("file:")) {
    return fileURLToPath(value);
  }
  return resolve(value);
}
