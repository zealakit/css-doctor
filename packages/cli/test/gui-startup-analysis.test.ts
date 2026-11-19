import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  GUI_STARTUP_REPORT_NAME,
  runGuiStartupAnalysis,
} from "../src/utils/gui-startup-analysis";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureCss = join(packageRoot, "test", "fixtures", "basic.css");
const issuesCss = join(packageRoot, "test", "fixtures", "issues.css");

async function withTempDir<T>(run: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), "cssd-gui-startup-"));
  try {
    return await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test("runGuiStartupAnalysis reuses runCheck and writes startup + latest reports", async () => {
  await withTempDir(async (cwd) => {
    await writeFile(join(cwd, "styles.css"), await readFile(fixtureCss));
    const first = await runGuiStartupAnalysis({
      patterns: ["styles.css"],
      cwd,
    });
    assert.equal(first.exitCode, 0);
    assert.equal(first.report.success, true);
    assert.equal(first.report.command, "check");
    assert.ok(first.reportPath.endsWith(GUI_STARTUP_REPORT_NAME));
    assert.ok(first.latestPath);
    assert.ok(first.report.classUsage);
    assert.ok(first.report.selectorAnalysis);
    assert.equal(first.report.selectorAnalysis.schemaVersion, 1);
    assert.ok(
      first.report.selectorAnalysis.completeness === "full" ||
        first.report.selectorAnalysis.completeness === "symbols-only",
    );
    assert.ok(first.report.selectorAnalysis.metrics.totalSelectors >= 1);

    const startupBody = JSON.parse(
      await readFile(first.reportPath, "utf8"),
    ) as {
      generatedAt: string;
      success: boolean;
      selectorAnalysis?: {
        schemaVersion: number;
        metrics: { totalSelectors: number };
      };
    };
    assert.equal(startupBody.success, true);
    assert.equal(startupBody.selectorAnalysis?.schemaVersion, 1);
    assert.ok((startupBody.selectorAnalysis?.metrics.totalSelectors ?? 0) >= 1);
    const generatedAt = startupBody.generatedAt;

    const second = await runGuiStartupAnalysis({
      patterns: ["styles.css"],
      cwd,
    });
    assert.notEqual(second.report.generatedAt, generatedAt);
    assert.equal(second.report.files.length, first.report.files.length);
  });
});

test("CSS diagnostics keep success and still produce a displayable report", async () => {
  await withTempDir(async (cwd) => {
    await writeFile(join(cwd, "issues.css"), await readFile(issuesCss));
    const result = await runGuiStartupAnalysis({
      patterns: ["issues.css"],
      cwd,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.report.success, true);
    assert.ok(result.report.summary.issues > 0);
    assert.ok(result.latestPath);
    const body = JSON.parse(await readFile(result.reportPath, "utf8")) as {
      summary: { issues: number };
    };
    assert.ok(body.summary.issues > 0);
  });
});

test("execution failure writes startup report but preserves prior check-latest", async () => {
  await withTempDir(async (cwd) => {
    await writeFile(join(cwd, "styles.css"), await readFile(fixtureCss));
    const ok = await runGuiStartupAnalysis({
      patterns: ["styles.css"],
      cwd,
    });
    assert.ok(ok.latestPath);
    const priorLatest = await readFile(ok.latestPath, "utf8");
    assert.match(priorLatest, /"success": true/);

    const failed = await runGuiStartupAnalysis({
      patterns: ["missing-*.css"],
      cwd,
    });
    assert.equal(failed.exitCode, 1);
    assert.equal(failed.report.success, false);
    assert.equal(failed.latestPath, null);
    assert.ok(failed.report.errors.length > 0);

    const startup = JSON.parse(await readFile(failed.reportPath, "utf8")) as {
      success: boolean;
      errors: string[];
    };
    assert.equal(startup.success, false);
    assert.ok(startup.errors.length > 0);

    assert.equal(await readFile(ok.latestPath, "utf8"), priorLatest);
  });
});

test("falls back to config.patterns when CLI patterns are omitted", async () => {
  await withTempDir(async (cwd) => {
    await writeFile(join(cwd, "app.css"), await readFile(fixtureCss));
    await mkdir(join(cwd, ".css-doctor"), { recursive: true });
    await writeFile(
      join(cwd, ".css-doctor/config.json"),
      JSON.stringify({ patterns: ["app.css"] }, null, 2),
    );

    const result = await runGuiStartupAnalysis({ cwd });
    assert.equal(result.exitCode, 0);
    assert.equal(result.patternSource, "config");
    assert.deepEqual(result.report.patterns, ["app.css"]);
  });
});

test("auto-discovers CSS when no patterns or config are provided", async () => {
  await withTempDir(async (cwd) => {
    await mkdir(join(cwd, "src"), { recursive: true });
    await writeFile(join(cwd, "src/app.css"), await readFile(fixtureCss));
    const result = await runGuiStartupAnalysis({ cwd });
    assert.equal(result.exitCode, 0);
    assert.equal(result.patternSource, "default");
    assert.deepEqual(result.report.patterns, ["src/**/*.css"]);
    assert.equal(result.report.success, true);
  });
});

test("empty projects still get actionable guidance", async () => {
  await withTempDir(async (cwd) => {
    const result = await runGuiStartupAnalysis({ cwd });
    assert.equal(result.exitCode, 1);
    assert.equal(result.patternSource, "none");
    assert.equal(result.report.success, false);
    assert.match(result.report.errors.join(" "), /config\.json/i);
    assert.match(result.report.errors.join(" "), /css-doctor gui/);
    assert.deepEqual(result.report.patterns, []);
  });
});
