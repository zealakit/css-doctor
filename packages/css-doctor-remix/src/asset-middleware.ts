import { createHash } from "node:crypto";

import { optimizeCss } from "@zealakit/css-doctor-binding";
import type { JsChunkOutput } from "@zealakit/css-doctor-binding";

import { CssCacheManager } from "./cache-manager";
import type {
  CssCacheEntry,
  CssDoctorRemixOptions,
  RemixAssetServerLike,
  SizeBudgetOptions,
} from "./types";

const DEFAULT_MAX_CHUNK_SIZE = 60 * 1_024;
const DEFAULT_CACHE_ENTRIES = 100;
const CSS_MODULE_PATTERN = /\.module\.css$/i;

type ResolvedOptions = {
  sizeBudget: Required<SizeBudgetOptions>;
  minify: boolean;
  cacheEnabled: boolean;
  cache: CssCacheManager;
  exclude: Array<string | RegExp>;
};

/**
 * Wraps a Remix 3 AssetServer and optimizes CSS responses lazily.
 *
 * The original server remains the source of truth for every asset. The wrapper
 * only intercepts successful `text/css` GET responses, and falls back to the
 * original Response for every error or unsupported request.
 */
export const withCssDoctorAssets = <T extends RemixAssetServerLike>(
  assetServer: T,
  options: CssDoctorRemixOptions = {},
): T => {
  const resolved = resolveOptions(options);
  const wrappedFetch = async (request: Request): Promise<Response | null> => {
    let pathname: string;

    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return assetServer.fetch(request);
    }

    if (
      request.method !== "GET" ||
      !pathname.toLowerCase().endsWith(".css") ||
      shouldSkipPath(pathname, resolved.exclude)
    ) {
      return assetServer.fetch(request);
    }

    const response = await assetServer.fetch(request);

    if (!response || response.status !== 200) {
      return response;
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.toLowerCase().startsWith("text/css")) {
      return response;
    }

    let originalCss: string;

    try {
      originalCss = await response.clone().text();
    } catch {
      return response;
    }

    const contentHash = hash(originalCss);
    const etag = response.headers.get("etag") ?? "";
    const cacheKey = `${request.url}|${etag}|${contentHash}`;

    if (resolved.cacheEnabled) {
      const cached = resolved.cache.get(cacheKey);

      if (cached) {
        return createResponse(cached, response);
      }
    }

    try {
      const pipeline = optimizeCss({
        cssContent: originalCss,
        pageUsage: {},
        pageCoverage: {
          enabled: false,
          minPageRatio: 0.5,
          forceCommon: [],
        },
        sizeBudget: {
          enabled: resolved.sizeBudget.enabled,
          maxChunkSize: resolved.sizeBudget.maxChunkSize,
          isolateVariables: resolved.sizeBudget.isolateVariables,
        },
        minify: resolved.minify,
      });
      const optimizedCss = pipeline.chunks
        .filter((chunk: JsChunkOutput) => chunk.page === undefined)
        .map((chunk: JsChunkOutput) => chunk.css)
        .join("\n");

      if (optimizedCss.length === 0) {
        return response;
      }

      const optimizedHash = hash(optimizedCss);
      const headers = new Headers(response.headers);

      headers.delete("content-encoding");
      headers.delete("transfer-encoding");
      headers.set("content-type", "text/css; charset=utf-8");
      headers.set(
        "content-length",
        String(Buffer.byteLength(optimizedCss, "utf8")),
      );
      headers.set("etag", `W/"cssd-${optimizedHash.slice(0, 16)}"`);

      const headerEntries: Array<[string, string]> = [];
      headers.forEach((value, key) => {
        headerEntries.push([key, value]);
      });

      const entry: CssCacheEntry = {
        body: optimizedCss,
        etag: headers.get("etag") ?? "",
        headers: headerEntries,
        sizeBytes: Buffer.byteLength(optimizedCss, "utf8"),
      };

      if (resolved.cacheEnabled) {
        resolved.cache.set(cacheKey, entry);
      }

      return createResponse(entry, response);
    } catch (error) {
      console.warn(
        `[css-doctor:remix] failed to optimize ${pathname}; serving the original asset: ${describeError(error)}`,
      );
      return response;
    }
  };

  return new Proxy(assetServer, {
    get(target, property) {
      if (property === "fetch") {
        return wrappedFetch;
      }

      const value = Reflect.get(target, property, target);

      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as T;
};

function resolveOptions(options: CssDoctorRemixOptions): ResolvedOptions {
  const maxChunkSize =
    options.sizeBudget?.maxChunkSize ?? DEFAULT_MAX_CHUNK_SIZE;
  const maxEntries = options.cache?.maxEntries ?? DEFAULT_CACHE_ENTRIES;

  return {
    sizeBudget: {
      enabled: options.sizeBudget?.enabled ?? true,
      maxChunkSize:
        Number.isInteger(maxChunkSize) && maxChunkSize > 0
          ? maxChunkSize
          : DEFAULT_MAX_CHUNK_SIZE,
      isolateVariables: options.sizeBudget?.isolateVariables ?? true,
    },
    minify: options.minify ?? process.env.NODE_ENV === "production",
    cacheEnabled: options.cache?.enabled ?? true,
    cache: new CssCacheManager(
      Number.isInteger(maxEntries) && maxEntries > 0
        ? maxEntries
        : DEFAULT_CACHE_ENTRIES,
    ),
    exclude: options.exclude ?? [],
  };
}

function shouldSkipPath(
  pathname: string,
  exclude: Array<string | RegExp>,
): boolean {
  if (CSS_MODULE_PATTERN.test(pathname)) {
    return true;
  }

  return exclude.some((pattern) =>
    typeof pattern === "string"
      ? pathname.includes(pattern)
      : pattern.test(pathname),
  );
}

function createResponse(entry: CssCacheEntry, original: Response): Response {
  return new Response(entry.body, {
    status: original.status,
    statusText: original.statusText,
    headers: new Headers(entry.headers),
  });
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
