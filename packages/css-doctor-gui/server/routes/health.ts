import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { GuiHealthResponse } from "../types";

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../package.json"),
    join(here, "../../package.json"),
    join(here, "package.json"),
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as {
        name?: string;
        version?: string;
      };
      if (
        pkg.name === "@zealakit/css-doctor-gui" &&
        typeof pkg.version === "string"
      ) {
        return pkg.version;
      }
    } catch {
      // try next
    }
  }

  return "0.0.0";
}

export function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  const body: GuiHealthResponse = {
    ok: true,
    service: "css-doctor-gui",
    mode: "web",
    version: readPackageVersion(),
    now: new Date().toISOString(),
  };
  const payload = JSON.stringify(body);
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}
