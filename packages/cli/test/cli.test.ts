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

test("baseline create/show/validate/remove round-trip", () => {
  const baselinePath = join(
    "test",
    "tmp-baseline",
    `baseline-${process.pid}.json`,
  );

  const created = runCli([
    "baseline",
    "create",
    "test/fixtures/basic.css",
    "--output",
    baselinePath,
    "--json",
  ]);
  assert.equal(created.status, 0, created.stderr);
  const createReport = JSON.parse(created.stdout) as {
    success: boolean;
    action: string;
    baseline: { schemaVersion: number; health: { overall: number } } | null;
  };
  assert.equal(createReport.success, true);
  assert.equal(createReport.action, "create");
  assert.ok(createReport.baseline);
  assert.equal(createReport.baseline.schemaVersion, 1);

  const shown = runCli([
    "baseline",
    "show",
    "--baseline",
    baselinePath,
    "--json",
  ]);
  assert.equal(shown.status, 0, shown.stderr);

  const validated = runCli([
    "baseline",
    "validate",
    "--baseline",
    baselinePath,
    "--json",
  ]);
  assert.equal(validated.status, 0, validated.stderr);

  const removed = runCli([
    "baseline",
    "remove",
    "--baseline",
    baselinePath,
    "--json",
  ]);
  assert.equal(removed.status, 0, removed.stderr);
});

test("diff reports healthy status against an identical baseline", () => {
  const baselinePath = join(
    "test",
    "tmp-baseline",
    `diff-healthy-${process.pid}.json`,
  );

  const created = runCli([
    "baseline",
    "create",
    "test/fixtures/basic.css",
    "--output",
    baselinePath,
  ]);
  assert.equal(created.status, 0, created.stderr);

  const diff = runCli([
    "diff",
    "test/fixtures/basic.css",
    "--baseline",
    baselinePath,
    "--json",
  ]);
  assert.equal(diff.status, 0, diff.stderr);
  const report = JSON.parse(diff.stdout) as {
    success: boolean;
    regression: {
      status: string;
      schemaVersion: number;
      changes: { score: number };
    } | null;
  };
  assert.equal(report.success, true);
  assert.ok(report.regression);
  assert.equal(report.regression.schemaVersion, 1);
  assert.equal(report.regression.status, "healthy");
  assert.equal(report.regression.changes.score, 0);

  runCli(["baseline", "remove", "--baseline", baselinePath]);
});

test("diff --fail-on-regression exits 1 when CSS quality deteriorates", () => {
  const baselinePath = join(
    "test",
    "tmp-baseline",
    `diff-regress-${process.pid}.json`,
  );

  const created = runCli([
    "baseline",
    "create",
    "test/fixtures/basic.css",
    "--output",
    baselinePath,
  ]);
  assert.equal(created.status, 0, created.stderr);

  const diff = runCli([
    "diff",
    "test/fixtures/health-issues.css",
    "--baseline",
    baselinePath,
    "--fail-on-regression",
    "--json",
  ]);
  assert.equal(diff.status, 1, diff.stderr);
  const report = JSON.parse(diff.stdout) as {
    success: boolean;
    regression: { status: string; qualityGates?: { passed: boolean } } | null;
  };
  assert.equal(report.success, false);
  assert.ok(report.regression);
  assert.match(report.regression.status, /regressed|mixed/);
  assert.equal(report.regression.qualityGates?.passed, false);

  runCli(["baseline", "remove", "--baseline", baselinePath]);
});

test("diff fails clearly when baseline is missing", () => {
  const result = runCli([
    "diff",
    "test/fixtures/basic.css",
    "--baseline",
    "test/tmp-baseline/does-not-exist.json",
    "--json",
  ]);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout) as {
    success: boolean;
    errors: string[];
    regression: null;
  };
  assert.equal(report.success, false);
  assert.equal(report.regression, null);
  assert.ok(report.errors.some((error) => /Baseline not found/i.test(error)));
});

test("check --fail-under fails when score is below the floor", () => {
  const result = runCli([
    "check",
    "test/fixtures/health-issues.css",
    "--json",
    "--fail-under",
    "100",
  ]);

  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout) as {
    success: boolean;
    failUnder: number | null;
    errors: string[];
    health: { overall: number } | null;
  };

  assert.equal(report.success, false);
  assert.equal(report.failUnder, 100);
  assert.ok(report.health);
  assert.ok(report.health.overall < 100);
  assert.ok(report.errors.some((error) => /fail-under/i.test(error)));
});

test("help lists baseline and diff commands", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /baseline/);
  assert.match(result.stdout, /diff/);
});

test("optimize --dry-run emits an optimization report without writing", () => {
  const result = runCli([
    "optimize",
    "test/fixtures/basic.css",
    "--dry-run",
    "--json",
    "--no-page-coverage",
    "--no-size-budget",
  ]);

  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as {
    success: boolean;
    dryRun: boolean;
    files: Array<{
      report: { schemaVersion: number; operations: { minified: boolean } };
    }>;
  };
  assert.equal(report.success, true);
  assert.equal(report.dryRun, true);
  assert.ok(report.files[0]);
  assert.equal(report.files[0].report.schemaVersion, 1);
  assert.equal(report.files[0].report.operations.minified, true);
});

test("optimize rejects --write together with --dry-run", () => {
  const result = runCli([
    "optimize",
    "test/fixtures/basic.css",
    "--write",
    "--dry-run",
    "--out-dir",
    "test/tmp-baseline/out",
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /mutually exclusive/i);
});

test("optimize rejects invalid --page-usage shapes", () => {
  const result = runCli([
    "optimize",
    "test/fixtures/basic.css",
    "--dry-run",
    "--json",
    "--page-usage",
    '{"home":"not-an-array"}',
  ]);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout) as {
    success: boolean;
    errors: string[];
  };
  assert.equal(report.success, false);
  assert.ok(report.errors.some((error) => /page-usage/i.test(error)));
});

test("fix --list shows safe and unsafe rules", () => {
  const result = runCli(["fix", "--list"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /dead\.empty-rule/);
  assert.match(result.stdout, /\[safe\]/);
  assert.match(result.stdout, /\[unsafe\]/);
});

test("fix --dry-run previews empty-rule removal", () => {
  const result = runCli([
    "fix",
    "test/fixtures/health-issues.css",
    "--dry-run",
    "--json",
    "--rule",
    "dead.empty-rule",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout) as {
    success: boolean;
    dryRun: boolean;
    files: Array<{ result: { changed: boolean; dryRun: boolean } }>;
  };
  assert.equal(report.success, true);
  assert.equal(report.dryRun, true);
  assert.ok(report.files.some((file) => file.result.changed));
});

test("help lists optimize and fix commands", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /optimize/);
  assert.match(result.stdout, /split/);
  assert.match(result.stdout, /fix/);
});
