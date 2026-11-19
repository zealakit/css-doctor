import assert from "node:assert/strict";
import test from "node:test";

installMemoryLocalStorage();

import {
  createGuiHttpServer,
  listenGuiServer,
  setCurrentReport,
} from "../server/index";
import {
  DEFAULT_GUI_SETTINGS,
  loadGuiSettings,
  saveGuiSettings,
} from "../shared/gui-settings";

test("runtime exposes read-only viewer capabilities", async () => {
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
        generateCheck: boolean;
        loadReport: boolean;
      };
    };
    assert.ok(body.phase >= 8);
    assert.equal(body.capabilities.settings, true);
    assert.equal(body.capabilities.uploadReport, false);
    assert.equal(body.capabilities.recentReports, false);
    assert.equal(body.capabilities.generateCheck, false);
    assert.equal(body.capabilities.loadReport, false);
  } finally {
    await listened.close();
  }
});

test("gui settings round-trip through storage helpers", () => {
  saveGuiSettings(DEFAULT_GUI_SETTINGS);
  const loaded = loadGuiSettings();
  assert.equal(loaded.theme, "dark");
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
