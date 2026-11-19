import assert from "node:assert/strict";
import test from "node:test";

import { withCssDoctorAssets } from "../src/index";
import type { RemixAssetServerLike } from "../src/types";

test("serves optimized CSS and answers 304 for matching If-None-Match", async () => {
  const css = `
    :root { --brand: red; }
    .a { color: var(--brand); }
    .b { color: blue; }
  `;

  const base: RemixAssetServerLike = {
    async fetch(_request: Request) {
      return new Response(css, {
        status: 200,
        headers: {
          "content-type": "text/css; charset=utf-8",
        },
      });
    },
  };

  const server = withCssDoctorAssets(base, {
    minify: true,
    sizeBudget: { enabled: true, maxChunkSize: 16, isolateVariables: true },
    cache: { enabled: true, maxEntries: 8 },
  });

  const first = await server.fetch(
    new Request("https://example.test/assets/app.css"),
  );
  assert.ok(first);
  assert.equal(first.status, 200);
  const etag = first.headers.get("etag");
  assert.ok(etag);
  const body = await first.text();
  assert.ok(body.includes("--brand") || body.includes("color"));

  const second = await server.fetch(
    new Request("https://example.test/assets/app.css", {
      headers: { "if-none-match": etag },
    }),
  );
  assert.ok(second);
  assert.equal(second.status, 304);
  assert.equal(await second.text(), "");
});

test("skips CSS Modules and non-200 responses without rewriting", async () => {
  const moduleCss = ".local_abc__x { color: red; }";
  const base: RemixAssetServerLike = {
    async fetch(request: Request) {
      const path = new URL(request.url).pathname;
      if (path.endsWith(".module.css")) {
        return new Response(moduleCss, {
          status: 200,
          headers: { "content-type": "text/css" },
        });
      }
      return new Response("missing", { status: 404 });
    },
  };

  const server = withCssDoctorAssets(base, {
    minify: true,
    cache: { enabled: false },
  });

  const moduleResponse = await server.fetch(
    new Request("https://example.test/styles.module.css"),
  );
  assert.ok(moduleResponse);
  assert.equal(moduleResponse.status, 200);
  assert.equal(await moduleResponse.text(), moduleCss);

  const missing = await server.fetch(
    new Request("https://example.test/missing.css"),
  );
  assert.ok(missing);
  assert.equal(missing.status, 404);
});

test("clamps invalid maxChunkSize and still returns CSS without crashing", async () => {
  const css = ".ok{color:green}";
  const base: RemixAssetServerLike = {
    async fetch() {
      return new Response(css, {
        status: 200,
        headers: { "content-type": "text/css" },
      });
    },
  };

  const server = withCssDoctorAssets(base, {
    minify: true,
    cache: { enabled: false },
    sizeBudget: { enabled: true, maxChunkSize: Number.NaN },
  });

  const response = await server.fetch(
    new Request("https://example.test/assets/app.css"),
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /ok|green/);
});

test("passes through non-CSS content types unchanged", async () => {
  const body = "not-css";
  const base: RemixAssetServerLike = {
    async fetch() {
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    },
  };

  const server = withCssDoctorAssets(base, { cache: { enabled: false } });
  const response = await server.fetch(
    new Request("https://example.test/assets/app.css"),
  );
  assert.ok(response);
  assert.equal(await response.text(), body);
});
