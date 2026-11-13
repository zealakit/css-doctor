import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createGuiHttpServer,
  listenGuiServer,
  resolveDesktopApp,
  setCurrentReport,
} from "../server/index";
import {
  isLoopbackWebOrigin,
  rejectDisallowedMutation,
} from "../server/middleware/security";
import { redactPath } from "../server/services/log";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/sample-check-report.json",
);

test("loopback origin helper accepts only local web origins", () => {
  assert.equal(isLoopbackWebOrigin("http://127.0.0.1:4193"), true);
  assert.equal(isLoopbackWebOrigin("http://localhost:4193/"), true);
  assert.equal(isLoopbackWebOrigin("https://example.com"), false);
  assert.equal(isLoopbackWebOrigin("file:///tmp/x"), false);
});

test("path redaction keeps basename only", () => {
  assert.equal(redactPath("/Users/me/project/report.json"), "…/report.json");
  assert.equal(redactPath("report.json"), "report.json");
});

test("mutating API rejects non-loopback Origin", async () => {
  setCurrentReport(null);
  const server = createGuiHttpServer({ apiOnly: true });
  const listened = await listenGuiServer(server, {
    port: 4281,
    open: false,
  });

  try {
    const response = await fetch(`${listened.url}api/report/load`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ path: fixturePath }),
    });
    assert.equal(response.status, 403);
    const body = (await response.json()) as { code?: string };
    assert.equal(body.code, "forbidden");
  } finally {
    await listened.close();
    setCurrentReport(null);
  }
});

test("mutating API still accepts loopback Origin", async () => {
  setCurrentReport(null);
  const server = createGuiHttpServer({ apiOnly: true });
  const listened = await listenGuiServer(server, {
    port: 4282,
    open: false,
  });

  try {
    const response = await fetch(`${listened.url}api/report/load`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:4282",
      },
      body: JSON.stringify({ path: fixturePath }),
    });
    assert.equal(response.status, 200);
  } finally {
    await listened.close();
    setCurrentReport(null);
  }
});

test("desktop resolver fails clearly when app is not built", () => {
  const previous = process.env.CSS_DOCTOR_GUI_DESKTOP;
  process.env.CSS_DOCTOR_GUI_DESKTOP =
    "/tmp/css-doctor-gui-missing-desktop-app.app";
  try {
    const result = resolveDesktopApp();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "not_found");
    }
  } finally {
    if (previous === undefined) {
      delete process.env.CSS_DOCTOR_GUI_DESKTOP;
    } else {
      process.env.CSS_DOCTOR_GUI_DESKTOP = previous;
    }
  }
});

test("rejectDisallowedMutation blocks cross-site fetch metadata", () => {
  const req = {
    method: "POST",
    headers: {
      host: "127.0.0.1:4193",
      "sec-fetch-site": "cross-site",
    },
  };
  const chunks: Buffer[] = [];
  const res = {
    headersSent: false,
    writeHead() {
      return res;
    },
    end(payload: string) {
      chunks.push(Buffer.from(payload));
    },
  };
  const blocked = rejectDisallowedMutation(req as never, res as never);
  assert.equal(blocked, true);
  assert.match(Buffer.concat(chunks).toString("utf8"), /Forbidden/);
});
