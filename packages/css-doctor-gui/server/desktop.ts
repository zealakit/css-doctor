import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";

export type DesktopLaunchResult =
  | { ok: true; command: string; args: string[]; path: string }
  | { ok: false; code: "not_installed" | "not_found"; message: string };

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Resolves a built CSS Doctor desktop binary/app without starting Web mode.
 * Desktop requires a prior `pnpm --filter @zealakit/css-doctor-gui desktop:build`.
 */
export function resolveDesktopApp(): DesktopLaunchResult {
  const override = process.env.CSS_DOCTOR_GUI_DESKTOP?.trim();
  if (override) {
    if (!existsSync(override)) {
      return {
        ok: false,
        code: "not_found",
        message: `CSS_DOCTOR_GUI_DESKTOP points to a missing path: ${override}`,
      };
    }
    return launchSpecForPath(override);
  }

  const candidates = desktopCandidates();
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return launchSpecForPath(candidate);
    }
  }

  return {
    ok: false,
    code: "not_installed",
    message:
      "Desktop app is not installed or built for this machine.\n" +
      "Build it with: pnpm --filter @zealakit/css-doctor-gui desktop:build\n" +
      "Or set CSS_DOCTOR_GUI_DESKTOP to the app/binary path.\n" +
      "Web mode does not need Tauri/Rust: css-doctor gui  (omit --desktop)",
  };
}

export async function launchDesktopApp(): Promise<DesktopLaunchResult> {
  const resolved = resolveDesktopApp();
  if (!resolved.ok) {
    return resolved;
  }

  const child = spawn(resolved.command, resolved.args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return resolved;
}

function desktopCandidates(): string[] {
  const release = join(packageRoot, "src-tauri/target/release");
  const bundle = join(release, "bundle");
  const os = platform();

  if (os === "darwin") {
    return [
      join(bundle, "macos/CSS Doctor.app"),
      join(release, "@zealakit/css-doctor-gui"),
    ];
  }
  if (os === "win32") {
    return [
      join(bundle, "msi/CSS Doctor.msi"),
      join(bundle, "nsis/CSS Doctor.exe"),
      join(release, "css-doctor-gui.exe"),
    ];
  }
  return [
    join(bundle, "appimage/css-doctor-gui.AppImage"),
    join(release, "@zealakit/css-doctor-gui"),
  ];
}

function launchSpecForPath(path: string): DesktopLaunchResult {
  if (platform() === "darwin" && path.endsWith(".app")) {
    return {
      ok: true,
      path,
      command: "open",
      args: ["-n", path],
    };
  }
  if (platform() === "win32" && path.toLowerCase().endsWith(".msi")) {
    return {
      ok: false,
      code: "not_installed",
      message:
        "Found an MSI artifact, but it is an installer — install it first, then set CSS_DOCTOR_GUI_DESKTOP to the installed app.",
    };
  }
  return {
    ok: true,
    path,
    command: path,
    args: [],
  };
}
