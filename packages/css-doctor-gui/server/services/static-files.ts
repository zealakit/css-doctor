import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { ServerResponse } from "node:http";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/**
 * Resolves a URL pathname to a file under `rootDir`, rejecting traversal.
 */
export function resolveSafePath(
  rootDir: string,
  requestPath: string,
): string | null {
  const decoded = decodeURIComponent(requestPath.split("?")[0] ?? "/");
  const relative = decoded.replace(/^\/+/, "");
  const candidate = normalize(join(rootDir, relative));
  const root = resolve(rootDir);

  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return null;
  }

  return candidate;
}

export function sendStaticFile(
  res: ServerResponse,
  absolutePath: string,
): boolean {
  if (!existsSync(absolutePath)) {
    return false;
  }

  const stats = statSync(absolutePath);
  if (!stats.isFile()) {
    return false;
  }

  const type =
    CONTENT_TYPES[extname(absolutePath).toLowerCase()] ??
    "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "content-length": stats.size,
    "cache-control": "no-cache",
    "x-content-type-options": "nosniff",
  });
  createReadStream(absolutePath).pipe(res);
  return true;
}

export function sendSpaFallback(
  res: ServerResponse,
  staticDir: string,
): boolean {
  return sendStaticFile(res, join(staticDir, "index.html"));
}
