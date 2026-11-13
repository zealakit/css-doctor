import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

installMemoryLocalStorage();

import {
  createGuiHttpServer,
  getCurrentReport,
  listenGuiServer,
  setCurrentReport,
} from "../server/index";
import {
  clearRecentReports,
  loadRecentReports,
  rememberReport,
  removeRecentReport,
} from "../shared/recent-reports";
import {
  DEFAULT_GUI_SETTINGS,
  loadGuiSettings,
  saveGuiSettings,
} from "../shared/gui-settings";
import { normalizeUnknownReport } from "../shared/normalize";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const checkFixture = join(fixtureDir, "fixtures/sample-check-report.json");
const splitFixture = join(fixtureDir, "fixtures/sample-split-report.json");

test("upload report JSON without clearing prior session on failure", async () => {
  setCurrentReport(null);
  const server = createGuiHttpServer({ apiOnly: true });
  const listened = await listenGuiServer(server, {
    port: 4271,
    open: false,
  });

  try {
    const checkJson = JSON.parse(await readFile(checkFixture, "utf8"));
    const uploaded = await fetch(`${listened.url}api/report/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report: checkJson, label: "sample-check.json" }),
    });
    assert.equal(uploaded.status, 200);
    assert.ok(getCurrentReport());

    const failed = await fetch(`${listened.url}api/report/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report: { not: "a-report" }, label: "bad.json" }),
    });
    assert.equal(failed.status, 400);
    assert.ok(getCurrentReport());
    assert.equal(getCurrentReport()?.source.command, "check");
  } finally {
    await listened.close();
    setCurrentReport(null);
  }
});

test("reload re-reads file source and rejects non-file sources", async () => {
  setCurrentReport(null);
  const server = createGuiHttpServer({ apiOnly: true });
  const listened = await listenGuiServer(server, {
    port: 4272,
    open: false,
  });

  try {
    const loaded = await fetch(`${listened.url}api/report/load`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: splitFixture }),
    });
    assert.equal(loaded.status, 200);

    const reloaded = await fetch(`${listened.url}api/report/reload`, {
      method: "POST",
    });
    assert.equal(reloaded.status, 200);
    const body = (await reloaded.json()) as {
      ok: boolean;
      source: { reloadable: boolean; kind: string };
    };
    assert.equal(body.ok, true);
    assert.equal(body.source.kind, "file");
    assert.equal(body.source.reloadable, true);

    const checkJson = JSON.parse(await readFile(checkFixture, "utf8"));
    await fetch(`${listened.url}api/report/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ report: checkJson, label: "upload.json" }),
    });

    const blocked = await fetch(`${listened.url}api/report/reload`, {
      method: "POST",
    });
    assert.equal(blocked.status, 400);
    const blockedBody = (await blocked.json()) as { code: string };
    assert.equal(blockedBody.code, "validation_error");
  } finally {
    await listened.close();
    setCurrentReport(null);
  }
});

test("runtime exposes settings and upload capabilities", async () => {
  setCurrentReport(null);
  const server = createGuiHttpServer({ apiOnly: true });
  const listened = await listenGuiServer(server, {
    port: 4273,
    open: false,
  });

  try {
    const response = await fetch(`${listened.url}api/runtime`);
    const body = (await response.json()) as {
      phase: number;
      capabilities: {
        settings: boolean;
        uploadReport: boolean;
        recentReports: boolean;
      };
    };
    assert.ok(body.phase >= 5);
    assert.equal(body.capabilities.settings, true);
    assert.equal(body.capabilities.uploadReport, true);
    assert.equal(body.capabilities.recentReports, true);
  } finally {
    await listened.close();
  }
});

test("recent reports store metadata only and support remove/clear", async () => {
  clearRecentReports();
  const raw = JSON.parse(await readFile(checkFixture, "utf8")) as unknown;
  const report = normalizeUnknownReport(raw, {
    source: {
      kind: "check-json",
      command: "check",
      path: "/tmp/demo-check.json",
    },
  });

  const entries = rememberReport(report, {
    enabled: true,
    path: "/tmp/demo-check.json",
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.label, "demo-check.json");
  assert.equal(entries[0]?.path, "/tmp/demo-check.json");
  assert.ok(!JSON.stringify(entries).includes('"diagnostics"'));

  removeRecentReport(entries[0]?.id ?? "");
  assert.equal(loadRecentReports().length, 0);
  rememberReport(report, { enabled: true, path: "/tmp/demo-check.json" });
  clearRecentReports();
  assert.equal(loadRecentReports().length, 0);
});

test("gui settings round-trip through storage helpers", () => {
  saveGuiSettings(DEFAULT_GUI_SETTINGS);
  const loaded = loadGuiSettings();
  assert.equal(loaded.theme, "dark");
  assert.equal(loaded.recentHistoryEnabled, true);
  saveGuiSettings({
    ...DEFAULT_GUI_SETTINGS,
    theme: "light",
    showFullPaths: true,
  });
  assert.equal(loadGuiSettings().theme, "light");
  assert.equal(loadGuiSettings().showFullPaths, true);
  saveGuiSettings(DEFAULT_GUI_SETTINGS);
});

function installMemoryLocalStorage(): void {
  const store = new Map<string, string>();
  const memory = {
    getItem(key: string) {
      return store.has(key) ? (store.get(key) ?? null) : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: memory,
    configurable: true,
  });
}
