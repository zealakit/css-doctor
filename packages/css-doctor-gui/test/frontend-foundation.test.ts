import assert from "node:assert/strict";
import test from "node:test";

import { NAV_ITEMS, ROUTES } from "../src/lib/constants/routes";
import { resolveSafePath } from "../server/services/static-files";

test("navigation covers every Phase 1 screen", () => {
  const paths = NAV_ITEMS.map((item) => item.path);
  assert.deepEqual(paths, [
    ROUTES.OVERVIEW,
    ROUTES.DIAGNOSTICS,
    ROUTES.ANALYSIS,
    ROUTES.OPTIMIZATION,
    ROUTES.SPLITTING,
    ROUTES.REGRESSION,
    ROUTES.FILES,
    ROUTES.SETTINGS,
  ]);
  assert.equal(
    new Set(NAV_ITEMS.map((item) => item.id)).size,
    NAV_ITEMS.length,
  );
});

test("resolveSafePath rejects traversal outside the static root", () => {
  const root = "/tmp/css-doctor-gui-static";
  assert.equal(resolveSafePath(root, "/index.html"), `${root}/index.html`);
  assert.equal(
    resolveSafePath(root, "/assets/app.js"),
    `${root}/assets/app.js`,
  );
  assert.equal(resolveSafePath(root, "/../etc/passwd"), null);
  assert.equal(resolveSafePath(root, "/%2e%2e/etc/passwd"), null);
});
