import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createGuiHttpServer,
  listenGuiServer,
  loadReportFromFile,
  setCurrentReport,
} from "../server/index";
import { normalizeUnknownReport } from "../shared/normalize";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/sample-check-report.json",
);

async function seedSession(path: string): Promise<void> {
  const loaded = await loadReportFromFile({ path });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }
  setCurrentReport(loaded.report, {
    kind: "file",
    path: loaded.report.source.path,
    label: "fixture.json",
    reloadable: true,
  });
}

test("GET /api/report exposes the preloaded session report", async () => {
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

    await seedSession(fixturePath);

    const current = await fetch(`${listened.url}api/report`);
    assert.equal(current.status, 200);
    const body = (await current.json()) as {
      ok: boolean;
      report: {
        health: { overall: number };
        diagnosticCounts: { total: number };
      };
    };
    assert.equal(body.ok, true);
    assert.equal(body.report.health.overall, 82);
    assert.equal(body.report.diagnosticCounts.total, 2);
  } finally {
    await listened.close();
    setCurrentReport(null);
  }
});

test("manual mutation report routes are removed", async () => {
  const server = createGuiHttpServer({ apiOnly: true });
  const listened = await listenGuiServer(server, {
    port: 4266,
    open: false,
  });

  try {
    for (const path of [
      "api/report/load",
      "api/report/upload",
      "api/report/generate",
      "api/report/reload",
      "api/report/clear",
      "api/report/discover",
    ]) {
      const response = await fetch(`${listened.url}${path}`, {
        method: path.includes("discover") ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        body: path.includes("discover")
          ? undefined
          : JSON.stringify({ path: fixturePath }),
      });
      assert.equal(response.status, 404, path);
    }
  } finally {
    await listened.close();
  }
});

test("normalize still supports optimize/diff envelopes for CLI-produced files", async () => {
  const optimizeFixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures/sample-optimize-report.json",
  );
  const diffFixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "fixtures/sample-diff-report.json",
  );

  const optimize = normalizeUnknownReport(
    JSON.parse(await readFile(optimizeFixture, "utf8")) as unknown,
    { source: { kind: "optimize-json", command: "optimize" } },
  );
  assert.equal(optimize.optimization?.summary.bytesEliminated, 50);
  assert.equal(optimize.cssAnalysis, null);

  const diff = normalizeUnknownReport(
    JSON.parse(await readFile(diffFixture, "utf8")) as unknown,
    { source: { kind: "diff-json", command: "diff" } },
  );
  assert.equal(diff.regression?.comparisonStatus, "completed");
  assert.ok(diff.regression?.status);
});
