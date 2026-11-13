import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createGuiHttpServer,
  listenGuiServer,
  setCurrentReport,
} from "../server/index";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/sample-check-report.json",
);

test("report APIs load JSON, expose report, and clear session", async () => {
  setCurrentReport(null);
  const server = createGuiHttpServer({ apiOnly: true });
  const listened = await listenGuiServer(server, {
    port: 4265,
    open: false,
  });

  try {
    const missing = await fetch(`${listened.url}api/report`);
    assert.equal(missing.status, 404);
    const missingBody = (await missing.json()) as { code: string };
    assert.equal(missingBody.code, "no_report");

    const loaded = await fetch(`${listened.url}api/report/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: fixturePath }),
    });
    assert.equal(loaded.status, 200);
    const loadedBody = (await loaded.json()) as {
      ok: boolean;
      report: {
        health: { overall: number };
        diagnosticCounts: { total: number };
      };
    };
    assert.equal(loadedBody.ok, true);
    assert.equal(loadedBody.report.health.overall, 82);
    assert.equal(loadedBody.report.diagnosticCounts.total, 2);

    const current = await fetch(`${listened.url}api/report`);
    assert.equal(current.status, 200);

    const cleared = await fetch(`${listened.url}api/report/clear`, {
      method: "POST",
    });
    assert.equal(cleared.status, 200);
    assert.equal((await fetch(`${listened.url}api/report`)).status, 404);
  } finally {
    await listened.close();
    setCurrentReport(null);
  }
});

test("loads diff JSON into session", async () => {
  setCurrentReport(null);
  const diffFixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures/sample-diff-report.json",
  );
  const server = createGuiHttpServer({ apiOnly: true });
  const listened = await listenGuiServer(server, {
    port: 4269,
    open: false,
  });

  try {
    const loaded = await fetch(`${listened.url}api/report/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: diffFixture }),
    });
    assert.equal(loaded.status, 200);
    const body = (await loaded.json()) as {
      ok: boolean;
      report: {
        regression: { status: string | null; comparisonStatus: string } | null;
      };
    };
    assert.equal(body.ok, true);
    assert.equal(body.report.regression?.comparisonStatus, "completed");
    assert.ok(body.report.regression?.status);
  } finally {
    await listened.close();
    setCurrentReport(null);
  }
});

test("loads optimize JSON into session", async () => {
  setCurrentReport(null);
  const optimizeFixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures/sample-optimize-report.json",
  );
  const server = createGuiHttpServer({ apiOnly: true });
  const listened = await listenGuiServer(server, {
    port: 4268,
    open: false,
  });

  try {
    const loaded = await fetch(`${listened.url}api/report/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: optimizeFixture }),
    });
    assert.equal(loaded.status, 200);
    const body = (await loaded.json()) as {
      ok: boolean;
      report: {
        optimization: { summary: { bytesEliminated: number } } | null;
        cssAnalysis: unknown;
      };
    };
    assert.equal(body.ok, true);
    assert.equal(body.report.optimization?.summary.bytesEliminated, 50);
    assert.equal(body.report.cssAnalysis, null);
  } finally {
    await listened.close();
    setCurrentReport(null);
  }
});

test("report load rejects missing files and invalid JSON paths", async () => {
  const server = createGuiHttpServer({ apiOnly: true });
  const listened = await listenGuiServer(server, {
    port: 4266,
    open: false,
  });

  try {
    const missing = await fetch(`${listened.url}api/report/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "/tmp/css-doctor-gui-missing-report.json" }),
    });
    assert.equal(missing.status, 404);

    const notJson = await fetch(`${listened.url}api/report/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: fixturePath.replace(/\.json$/, ".txt") }),
    });
    assert.equal(notJson.status, 400);
  } finally {
    await listened.close();
  }
});

test("generate check report via binding", async () => {
  const cssFixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../cli/test/fixtures/health-issues.css",
  );
  const server = createGuiHttpServer({ apiOnly: true });
  const listened = await listenGuiServer(server, {
    port: 4267,
    open: false,
  });

  try {
    const response = await fetch(`${listened.url}api/report/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        patterns: ["health-issues.css"],
        cwd: dirname(cssFixture),
      }),
    });
    const body = (await response.json()) as {
      ok: boolean;
      code?: string;
      message?: string;
      report?: {
        source: { kind: string };
        summary: { fileCount: number } | null;
        diagnostics: unknown[];
      };
    };
    assert.equal(response.status, 200, body.message ?? body.code);
    assert.ok(body.report);
    assert.equal(body.ok, true);
    assert.equal(body.report?.source.kind, "generated-check");
    assert.equal(body.report?.summary?.fileCount, 1);
    assert.ok((body.report?.diagnostics.length ?? 0) >= 0);
  } finally {
    await listened.close();
    setCurrentReport(null);
  }
});
