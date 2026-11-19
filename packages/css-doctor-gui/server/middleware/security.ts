import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Applies baseline local-server security headers.
 * Host is 127.0.0.1 by default; CORS is intentionally omitted (no ACAO).
 */
export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("cache-control", "no-store");
  res.setHeader(
    "content-security-policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
}

export function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) {
    return false;
  }
  const host = hostHeader.split(":")[0]?.toLowerCase() ?? "";
  return isLoopbackHostname(host);
}

export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "[::1]" ||
    host === "::1"
  );
}

export function rejectNonLoopback(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (isLoopbackHost(req.headers.host)) {
    return false;
  }
  res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error: "Forbidden host" }));
  return true;
}

/**
 * Blocks cross-site mutating requests that present a non-loopback Origin/Referer.
 * Missing Origin is allowed for same-machine CLI/curl tools on loopback Host.
 */
export function rejectDisallowedMutation(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return false;
  }

  const origin = headerString(req.headers.origin);
  if (origin) {
    if (!isLoopbackWebOrigin(origin)) {
      forbid(res, "Forbidden origin");
      return true;
    }
    return false;
  }

  const referer = headerString(req.headers.referer);
  if (referer && !isLoopbackWebOrigin(referer)) {
    forbid(res, "Forbidden referer");
    return true;
  }

  const fetchSite = headerString(req.headers["sec-fetch-site"]);
  if (fetchSite === "cross-site") {
    forbid(res, "Forbidden cross-site request");
    return true;
  }

  return false;
}

export function isLoopbackWebOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    return isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function headerString(
  value: string | string[] | undefined,
): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

function forbid(res: ServerResponse, message: string): void {
  res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, code: "forbidden", message }));
}
