import process from "node:process";

type LogFields = Record<string, string | number | boolean | undefined | null>;

/** Local stderr logger — never logs report bodies or secrets. */
export function guiLog(
  level: "info" | "warn" | "error",
  message: string,
  fields: LogFields = {},
): void {
  const parts = [`css-doctor-gui:${level}`, message];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) {
      continue;
    }
    parts.push(`${key}=${sanitizeField(key, value)}`);
  }
  process.stderr.write(`${parts.join(" ")}\n`);
}

function sanitizeField(key: string, value: string | number | boolean): string {
  if (typeof value !== "string") {
    return String(value);
  }
  if (/path|file|cwd|dir/i.test(key)) {
    return redactPath(value);
  }
  if (value.length > 180) {
    return `${value.slice(0, 177)}...`;
  }
  return value;
}

/** Keeps basename for troubleshooting without dumping full home paths. */
export function redactPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  const base = parts[parts.length - 1] ?? trimmed;
  if (parts.length <= 1) {
    return base;
  }
  return `…/${base}`;
}
