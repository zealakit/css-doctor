import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { persistCliReport } from "../src/utils/report-io";

test("atomic --out writes envelope without requiring success", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cssd-report-"));
  try {
    const out = join(directory, "failed-check.json");
    const result = await persistCliReport(
      {
        schemaVersion: 1,
        command: "check",
        success: false,
        errors: ["boom"],
      },
      { out, cwd: directory },
    );
    assert.equal(result.ok, true);
    const text = await readFile(out, "utf8");
    assert.match(text, /"success": false/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("--save updates latest only on success and preserves prior latest on failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cssd-report-"));
  try {
    const ok = await persistCliReport(
      {
        schemaVersion: 1,
        command: "check",
        success: true,
        marker: "good",
      },
      { save: true, cwd: directory },
    );
    assert.equal(ok.ok, true);
    const latest = join(directory, ".css-doctor/reports/check-latest.json");
    assert.match(await readFile(latest, "utf8"), /"marker": "good"/);

    const failed = await persistCliReport(
      {
        schemaVersion: 1,
        command: "check",
        success: false,
        marker: "bad",
      },
      { save: true, cwd: directory },
    );
    assert.equal(failed.ok, true);
    assert.match(await readFile(latest, "utf8"), /"marker": "good"/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
