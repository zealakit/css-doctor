import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { CheckReport } from "../src/commands/check";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(packageRoot, "dist", "index.js");

function runCli(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: packageRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });
}

test("prints a SUCCESS terminal report with file size and top selectors", () => {
  const result = runCli(["check", "test/fixtures/basic.css"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SUCCESS/);
  assert.match(result.stdout, /test\/fixtures\/basic\.css/);
  assert.match(result.stdout, /\d+(?:\.\d+)? (?:B|KB|MB)/);
  assert.match(result.stdout, /Top selectors/);
  assert.match(result.stdout, /#app \.card:hover/);
  assert.match(result.stdout, /analysis .* ms/);
});

test("emits structured JSON with the short -j flag", () => {
  const result = runCli(["check", "test/fixtures/basic.css", "-j"]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as CheckReport;

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.command, "check");
  assert.equal(report.success, true);
  assert.equal(report.threshold, null);
  assert.equal(report.files.length, 1);
  assert.equal(report.files[0]?.ok, true);
  assert.ok((report.files[0]?.sizeBytes ?? 0) > 0);
  assert.ok((report.files[0]?.result?.selectors.length ?? 0) >= 4);
  assert.equal(report.summary.files, 1);
  assert.ok(report.summary.analysisMs >= 0);
});

test("flags files above the selector threshold without failing the run", () => {
  const terminal = runCli([
    "check",
    "test/fixtures/basic.css",
    "--threshold",
    "2",
  ]);

  assert.equal(terminal.status, 0, terminal.stderr);
  assert.match(terminal.stdout, /WARNING/);
  assert.match(terminal.stdout, /threshold/i);

  const json = runCli([
    "check",
    "test/fixtures/basic.css",
    "--json",
    "--threshold",
    "2",
  ]);

  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout) as CheckReport;

  assert.equal(report.threshold, 2);
  assert.equal(report.success, true);
  assert.ok(
    report.files[0]?.issues.some((issue) => issue.kind === "threshold"),
  );
});

test("surfaces syntax warnings and dead-code hints as WARNING", () => {
  const result = runCli(["check", "test/fixtures/issues.css", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as CheckReport;
  const issues = report.files[0]?.issues ?? [];

  assert.equal(report.success, true);
  assert.equal(report.summary.warnings, 1);
  assert.ok(report.summary.hints >= 2);
  assert.ok(issues.some((issue) => issue.kind === "syntax"));
  assert.ok(issues.some((issue) => issue.kind === "empty-rule"));
  assert.ok(issues.some((issue) => issue.kind === "duplicate-selector"));

  const terminal = runCli(["check", "test/fixtures/issues.css"]);
  assert.equal(terminal.status, 0, terminal.stderr);
  assert.match(terminal.stdout, /WARNING/);
  assert.match(terminal.stdout, /Diagnostics/);
});

test("expands glob patterns", () => {
  const result = runCli(["check", "test/fixtures/*.css", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as CheckReport;

  assert.equal(report.success, true);
  assert.ok(report.files.length >= 3);
  assert.ok(report.summary.issues > 0);
});

test("returns exit code 1 and ERROR when no files match", () => {
  const result = runCli([
    "check",
    "test/fixtures/does-not-exist-*.css",
    "--json",
  ]);

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout) as CheckReport;

  assert.equal(report.success, false);
  assert.equal(report.files.length, 0);
  assert.ok(report.errors.length > 0);

  const terminal = runCli(["check", "test/fixtures/does-not-exist-*.css"]);
  assert.equal(terminal.status, 1, terminal.stderr);
  assert.match(terminal.stdout, /ERROR/);
});

test("rejects an invalid threshold", () => {
  const result = runCli([
    "check",
    "test/fixtures/basic.css",
    "--threshold",
    "nope",
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /threshold/i);
});

test("supports --help without loading the native binding", () => {
  const result = runCli(["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /check/);
  assert.match(result.stdout, /health/);
});

test("health command prints overall score and dimension breakdown", () => {
  const result = runCli(["health", "test/fixtures/basic.css"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HEALTH REPORT/);
  assert.match(result.stdout, /Overall Health/);
  assert.match(result.stdout, /\/100/);
  assert.match(result.stdout, /HEALTH BREAKDOWN/);
  assert.match(result.stdout, /Selector Complexity/);
});

test("health --json emits a stable health schema", () => {
  const result = runCli([
    "health",
    "test/fixtures/health-issues.css",
    "--json",
  ]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as {
    schemaVersion: number;
    command: string;
    success: boolean;
    health: {
      schemaVersion: number;
      overall: number;
      grade: string;
      dimensions: Array<{ id: string; score: number | null }>;
      diagnostics: Array<{ code: string }>;
    } | null;
  };

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.command, "health");
  assert.equal(report.success, true);
  assert.ok(report.health);
  assert.equal(report.health.schemaVersion, 1);
  assert.ok(report.health.overall < 100);
  assert.ok(report.health.dimensions.length >= 5);
  assert.ok(
    report.health.diagnostics.some(
      (diagnostic) => diagnostic.code === "dead.empty-rule",
    ),
  );
});

test("health --fail-under fails when score is below the floor", () => {
  const result = runCli([
    "health",
    "test/fixtures/health-issues.css",
    "--json",
    "--fail-under",
    "100",
  ]);

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout) as {
    success: boolean;
    errors: string[];
    health: { overall: number } | null;
  };

  assert.equal(report.success, false);
  assert.ok(report.health);
  assert.ok(report.health.overall < 100);
  assert.ok(report.errors.some((error) => /fail-under/i.test(error)));
});

test("check --json includes an aggregated health report", () => {
  const result = runCli(["check", "test/fixtures/basic.css", "--json"]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as {
    health: { overall: number; grade: string } | null;
  };

  assert.ok(report.health);
  assert.equal(typeof report.health.overall, "number");
  assert.match(report.health.grade, /^[A-F]$/);
});

test("reports the CLI version", () => {
  const result = runCli(["--version"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
});
