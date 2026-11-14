import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";

import { discoverProjectReports } from "../server/index";

test("discover lists CLI --save latest envelopes without parsing bodies", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cssd-discover-"));
  try {
    const reportsDir = join(cwd, ".css-doctor/reports");
    await mkdir(reportsDir, { recursive: true });
    await writeFile(
      join(reportsDir, "check-latest.json"),
      JSON.stringify({ schemaVersion: 1, command: "check", success: true }),
      "utf8",
    );
    await writeFile(join(reportsDir, "notes.txt"), "ignore", "utf8");

    const discovered = await discoverProjectReports({ cwd });
    assert.equal(discovered.ok, true);
    if (!discovered.ok) {
      return;
    }
    assert.equal(discovered.reports.length, 1);
    assert.equal(discovered.reports[0]?.command, "check");
    assert.equal(discovered.reports[0]?.kind, "latest");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("discover returns empty list when reports dir is missing", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "cssd-discover-missing-"));
  try {
    const discovered = await discoverProjectReports({ cwd });
    assert.equal(discovered.ok, true);
    if (!discovered.ok) {
      return;
    }
    assert.deepEqual(discovered.reports, []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
