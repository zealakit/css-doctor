import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  clearReportSession,
  getCurrentReport,
  getReportSessionSource,
  pickPreferredReport,
  preloadStartupReport,
  startGuiServer,
  type DiscoveredReport,
} from "../server/index";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

async function withTempProject(
  run: (cwd: string) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "cssd-preload-"));
  try {
    clearReportSession();
    await run(cwd);
  } finally {
    clearReportSession();
    await rm(cwd, { recursive: true, force: true });
  }
}

async function seedLatestReport(
  cwd: string,
  name: string,
  sourceFixture = "sample-check-report.json",
): Promise<string> {
  const reportsDir = join(cwd, ".css-doctor/reports");
  await mkdir(reportsDir, { recursive: true });
  const raw = await readFile(join(fixtures, sourceFixture), "utf8");
  const path = join(reportsDir, name);
  await writeFile(path, raw, "utf8");
  return path;
}

test("pickPreferredReport prefers check-latest over other latest files", () => {
  const reports: DiscoveredReport[] = [
    {
      path: "/tmp/health-latest.json",
      command: "health",
      kind: "latest",
      mtimeMs: 200,
      sizeBytes: 10,
    },
    {
      path: "/tmp/check-latest.json",
      command: "check",
      kind: "latest",
      mtimeMs: 100,
      sizeBytes: 10,
    },
  ];
  assert.equal(pickPreferredReport(reports)?.path, "/tmp/check-latest.json");
});

test("preloadStartupReport loads discovered check-latest without analysis", async () => {
  await withTempProject(async (cwd) => {
    const path = await seedLatestReport(cwd, "check-latest.json");
    const result = await preloadStartupReport({ cwd });
    assert.deepEqual(result, {
      ok: true,
      path,
      mode: "discovered",
    });
    const report = getCurrentReport();
    assert.ok(report);
    assert.equal(report.source.command, "check");
    assert.ok(report.cssAnalysis);
    assert.equal(getReportSessionSource()?.reloadable, true);
  });
});

test("preloadStartupReport returns none when no reports exist", async () => {
  await withTempProject(async (cwd) => {
    const result = await preloadStartupReport({ cwd });
    assert.deepEqual(result, { ok: true, path: null, mode: "none" });
    assert.equal(getCurrentReport(), null);
  });
});

test("preloadStartupReport fails closed on explicit invalid report", async () => {
  await withTempProject(async (cwd) => {
    const badPath = join(cwd, "broken.json");
    await writeFile(badPath, "{not-json", "utf8");
    const result = await preloadStartupReport({ reportPath: badPath, cwd });
    assert.equal(result.ok, false);
    if (result.ok) {
      assert.fail("expected failure");
    }
    assert.equal(result.mode, "explicit");
    assert.match(result.message, /json|invalid|parse/i);
    assert.equal(getCurrentReport(), null);
  });
});

test("startGuiServer auto-loads discovered report into session", async () => {
  await withTempProject(async (cwd) => {
    await seedLatestReport(cwd, "check-latest.json");
    const listened = await startGuiServer({
      cwd,
      apiOnly: true,
      open: false,
      printUrl: false,
    });
    try {
      const response = await fetch(`${listened.url}api/report`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        ok: boolean;
        report: { source: { command: string } } | null;
      };
      assert.equal(body.ok, true);
      assert.equal(body.report?.source.command, "check");
    } finally {
      await listened.close();
    }
  });
});

test("startGuiServer with empty project exposes no_report without analyzing", async () => {
  await withTempProject(async (cwd) => {
    const listened = await startGuiServer({
      cwd,
      apiOnly: true,
      open: false,
      printUrl: false,
    });
    try {
      const response = await fetch(`${listened.url}api/report`);
      assert.equal(response.status, 404);
      const body = (await response.json()) as {
        ok: boolean;
        code?: string;
      };
      assert.equal(body.ok, false);
      assert.equal(body.code, "no_report");
    } finally {
      await listened.close();
    }
  });
});
