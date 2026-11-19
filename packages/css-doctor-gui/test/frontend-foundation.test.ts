import assert from "node:assert/strict";
import test from "node:test";

import { resolveSafePath } from "../server/services/static-files";

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
