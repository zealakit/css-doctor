import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

import {
  applySecurityHeaders,
  rejectDisallowedMutation,
  rejectNonLoopback,
} from "./middleware/security";
import { guiLog } from "./services/log";
import { handleHealth } from "./routes/health";
import {
  handleClearReport,
  handleDiscoverReports,
  handleGenerateReport,
  handleGetReport,
  handleLoadReport,
  handleReloadReport,
  handleUploadReport,
} from "./routes/report";
import { handleRuntimeInfo } from "./routes/runtime";
import {
  resolveSafePath,
  sendSpaFallback,
  sendStaticFile,
} from "./services/static-files";

export type CreateGuiHttpServerOptions = {
  staticDir?: string;
  apiOnly?: boolean;
};

export function createGuiHttpServer(options: CreateGuiHttpServerOptions = {}) {
  const staticDir = options.staticDir;
  const apiOnly = options.apiOnly === true;

  return createHttpServer((req, res) => {
    void handleRequest(req, res, { staticDir, apiOnly });
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: CreateGuiHttpServerOptions,
): Promise<void> {
  try {
    applySecurityHeaders(res);

    if (rejectNonLoopback(req, res)) {
      guiLog("warn", "rejected non-loopback host", {
        host: req.headers.host ?? "",
      });
      return;
    }

    if (rejectDisallowedMutation(req, res)) {
      guiLog("warn", "rejected disallowed mutation", {
        method: req.method ?? "",
        path: rawPathname(req.url),
      });
      return;
    }

    const method = req.method ?? "GET";
    // Prefer the raw request path so ".." segments are not collapsed by URL().
    const pathname = rawPathname(req.url);

    if (method === "GET" && pathname === "/api/health") {
      handleHealth(req, res);
      return;
    }

    if (method === "GET" && pathname === "/api/runtime") {
      handleRuntimeInfo(req, res);
      return;
    }

    if (method === "GET" && pathname === "/api/report") {
      handleGetReport(req, res);
      return;
    }

    if (method === "GET" && pathname === "/api/report/discover") {
      await handleDiscoverReports(req, res);
      return;
    }

    if (method === "POST" && pathname === "/api/report/load") {
      await handleLoadReport(req, res);
      return;
    }

    if (method === "POST" && pathname === "/api/report/upload") {
      await handleUploadReport(req, res);
      return;
    }

    if (method === "POST" && pathname === "/api/report/generate") {
      await handleGenerateReport(req, res);
      return;
    }

    if (method === "POST" && pathname === "/api/report/reload") {
      await handleReloadReport(req, res);
      return;
    }

    if (method === "POST" && pathname === "/api/report/clear") {
      handleClearReport(req, res);
      return;
    }

    if (pathname.startsWith("/api/")) {
      res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: false, error: "Not found" }));
      return;
    }

    if (options.apiOnly || !options.staticDir) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" });
      res.end("Method Not Allowed");
      return;
    }

    const safePath = resolveSafePath(options.staticDir, pathname);
    if (!safePath) {
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      res.end("Bad request");
      return;
    }

    const filePath =
      pathname === "/" ? join(options.staticDir, "index.html") : safePath;

    if (sendStaticFile(res, filePath)) {
      return;
    }

    // SPA fallback only for document navigations (not bare asset probes).
    const accept = req.headers.accept ?? "";
    const wantsHtml =
      accept.includes("text/html") || accept === "" || accept === "*/*";
    if (
      wantsHtml &&
      !pathname.includes(".") &&
      sendSpaFallback(res, options.staticDir)
    ) {
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    guiLog("error", "request handler failure", { message });
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    }
    res.end(JSON.stringify({ ok: false, error: "Internal server error" }));
  }
}

function rawPathname(requestUrl: string | undefined): string {
  const raw = requestUrl ?? "/";
  const pathOnly = raw.split("?")[0] ?? "/";
  return pathOnly.length > 0 ? pathOnly : "/";
}
