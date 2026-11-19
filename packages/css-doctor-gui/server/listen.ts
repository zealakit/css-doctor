import type { Server } from "node:http";

import { DEFAULT_HOST, FALLBACK_PORT_MAX, PREFERRED_PORT } from "./constants";
import type { GuiServerListenResult, GuiServerOptions } from "./types";

export async function listenGuiServer(
  server: Server,
  options: GuiServerOptions = {},
): Promise<GuiServerListenResult> {
  const host = options.host ?? DEFAULT_HOST;
  const preferred = options.port ?? PREFERRED_PORT;
  const allowFallback =
    options.port === undefined && options.strictPort !== true;

  validatePort(preferred);

  // Custom --port or --strict-port: bind exactly, fail on EADDRINUSE.
  // Default mode: try preferred, then the next ports up to FALLBACK_PORT_MAX.
  if (!allowFallback) {
    try {
      await bind(server, host, preferred);
      return toResult(server, host, preferred);
    } catch (error) {
      if (isAddressInUse(error)) {
        throw new Error(
          `Port ${preferred} on ${host} is already in use. ` +
            (options.strictPort
              ? "Strict port mode does not fall back."
              : "Choose another --port or omit --port to enable fallback."),
        );
      }
      throw error;
    }
  }

  for (let port = preferred; port <= FALLBACK_PORT_MAX; port += 1) {
    try {
      await bind(server, host, port);
      return toResult(server, host, port);
    } catch (error) {
      if (!isAddressInUse(error)) {
        throw error;
      }
    }
  }

  throw new Error(
    `Unable to bind ${host} in port range ${preferred}-${FALLBACK_PORT_MAX}`,
  );
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }
}

function bind(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function toResult(
  server: Server,
  host: string,
  port: number,
): GuiServerListenResult {
  return {
    host,
    port,
    url: `http://${host}:${port}/`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  };
}

function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "EADDRINUSE"
  );
}

export { PREFERRED_PORT, FALLBACK_PORT_MAX, DEFAULT_HOST };
