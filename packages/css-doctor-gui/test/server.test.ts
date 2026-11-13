import assert from "node:assert/strict";
import { createServer, get as httpGet } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createGuiHttpServer,
  listenGuiServer,
  PREFERRED_PORT,
} from "../server/index";

async function occupyPort(host: string, port: number) {
  const blocker = createServer((_req, res) => {
    res.end("busy");
  });
  await new Promise<void>((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(port, host, () => resolve());
  });
  return blocker;
}

test("listens on preferred port when free", async () => {
  const server = createGuiHttpServer({ apiOnly: true });
  const listened = await listenGuiServer(server, {
    port: PREFERRED_PORT,
    strictPort: true,
    open: false,
  });
  assert.equal(listened.port, PREFERRED_PORT);
  assert.equal(listened.host, "127.0.0.1");
  assert.match(listened.url, /http:\/\/127\.0\.0\.1:4193\//);

  const health = await fetch(`${listened.url}api/health`);
  assert.equal(health.status, 200);
  const body = (await health.json()) as { ok: boolean; service: string };
  assert.equal(body.ok, true);
  assert.equal(body.service, "css-doctor-gui");

  await listened.close();
});

test("falls back when preferred port is busy and port is not custom", async () => {
  const blocker = await occupyPort("127.0.0.1", PREFERRED_PORT);
  const server = createGuiHttpServer({ apiOnly: true });
  try {
    const listened = await listenGuiServer(server, {
      open: false,
    });
    assert.ok(listened.port > PREFERRED_PORT);
    assert.ok(listened.port <= 4293);
    await listened.close();
  } finally {
    await new Promise<void>((resolve, reject) => {
      blocker.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("custom port does not fall back on conflict", async () => {
  const customPort = 4211;
  const blocker = await occupyPort("127.0.0.1", customPort);
  const server = createGuiHttpServer({ apiOnly: true });
  try {
    await assert.rejects(
      () =>
        listenGuiServer(server, {
          port: customPort,
          open: false,
        }),
      /already in use/i,
    );
  } finally {
    server.close();
    await new Promise<void>((resolve, reject) => {
      blocker.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("strict port fails instead of falling back", async () => {
  const blocker = await occupyPort("127.0.0.1", PREFERRED_PORT);
  const server = createGuiHttpServer({ apiOnly: true });
  try {
    await assert.rejects(
      () =>
        listenGuiServer(server, {
          strictPort: true,
          open: false,
        }),
      /Strict port mode/i,
    );
  } finally {
    server.close();
    await new Promise<void>((resolve, reject) => {
      blocker.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("serves static assets and rejects path traversal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cssd-gui-"));
  await writeFile(join(dir, "index.html"), "<!doctype html><title>ok</title>");
  await writeFile(join(dir, "app.js"), "console.log(1)");

  const server = createGuiHttpServer({ staticDir: dir });
  const listened = await listenGuiServer(server, {
    port: 4260,
    open: false,
  });

  try {
    const index = await fetch(listened.url);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /ok/);

    const asset = await fetch(`${listened.url}app.js`);
    assert.equal(asset.status, 200);

    // Use raw HTTP so the path is not normalized by fetch()/URL.
    const traversalStatus = await new Promise<number>((resolve, reject) => {
      httpGet(
        {
          host: listened.host,
          port: listened.port,
          path: "/../../etc/passwd",
          headers: { host: "127.0.0.1" },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      ).on("error", reject);
    });
    assert.ok(
      traversalStatus === 400 || traversalStatus === 404,
      `unexpected status ${traversalStatus}`,
    );
  } finally {
    await listened.close();
  }
});

test("runtime endpoint reports phase-6 capabilities", async () => {
  const server = createGuiHttpServer({ apiOnly: true });
  const listened = await listenGuiServer(server, {
    port: 4261,
    open: false,
  });
  try {
    const response = await fetch(`${listened.url}api/runtime`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      phase: number;
      capabilities: {
        loadReport: boolean;
        generateCheck: boolean;
        settings: boolean;
        uploadReport: boolean;
        desktopSidecar: boolean;
      };
    };
    assert.equal(body.phase, 6);
    assert.equal(body.capabilities.loadReport, true);
    assert.equal(body.capabilities.generateCheck, true);
    assert.equal(body.capabilities.settings, true);
    assert.equal(body.capabilities.uploadReport, true);
    assert.equal(body.capabilities.desktopSidecar, true);
  } finally {
    await listened.close();
  }
});

test("graceful close rejects later requests", async () => {
  const server = createGuiHttpServer({ apiOnly: true });
  const listened = await listenGuiServer(server, {
    port: 4262,
    open: false,
  });
  const url = `${listened.url}api/health`;
  assert.equal((await fetch(url)).status, 200);
  await listened.close();
  await assert.rejects(() => fetch(url));
});
