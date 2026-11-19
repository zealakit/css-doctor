import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { createModuleResolver } from "../src/index";

function project(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "cssd-resolve-")));
  for (const [name, content] of Object.entries(files)) {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}

test("relative, index and extension probing", () => {
  const root = project({
    "src/a.tsx": "",
    "src/lib/index.ts": "",
    "src/s.module.css": "",
  });
  const resolver = createModuleResolver();
  const importer = join(root, "src/a.tsx");
  assert.deepEqual(resolver.resolve("./lib", importer), {
    kind: "file",
    path: join(root, "src/lib/index.ts"),
  });
  assert.equal(resolver.resolve("./s.module.css", importer).kind, "style");
  assert.equal(resolver.resolve("./missing", importer).kind, "unresolved");
  rmSync(root, { recursive: true, force: true });
});

test("tsconfig paths with comments, baseUrl and extends chain", () => {
  const root = project({
    "tsconfig.base.json": `{
      // shared
      "compilerOptions": { "baseUrl": ".", "paths": { "~/*": ["src/*",], "@ui/*": ["packages/ui/src/*"] } },
    }`,
    "tsconfig.json": `{ "extends": "./tsconfig.base.json" }`,
    "src/app/page.tsx": "",
    "src/components/card.tsx": "",
    "packages/ui/src/button.tsx": "",
  });
  const resolver = createModuleResolver();
  const importer = join(root, "src/app/page.tsx");
  assert.equal(
    (resolver.resolve("~/components/card", importer) as { path: string }).path,
    join(root, "src/components/card.tsx"),
  );
  assert.equal(
    (resolver.resolve("@ui/button", importer) as { path: string }).path,
    join(root, "packages/ui/src/button.tsx"),
  );
  assert.equal(resolver.resolve("@ui/nope", importer).kind, "unresolved");
  rmSync(root, { recursive: true, force: true });
});

test("workspace package via exports, external packages skipped", () => {
  const root = project({
    "packages/ui/package.json": JSON.stringify({
      name: "@acme/ui",
      exports: {
        ".": { import: "./dist/index.js" },
        "./button": "./dist/button.js",
      },
    }),
    "packages/ui/src/index.ts": "",
    "packages/ui/src/button.tsx": "",
    "app/src/main.tsx": "",
    "node_modules/react/package.json": `{"name":"react","main":"index.js"}`,
    "node_modules/react/index.js": "",
  });
  mkdirSync(join(root, "app/node_modules/@acme"), { recursive: true });
  symlinkSync(
    join(root, "packages/ui"),
    join(root, "app/node_modules/@acme/ui"),
  );
  const resolver = createModuleResolver();
  const importer = join(root, "app/src/main.tsx");
  assert.equal(
    (resolver.resolve("@acme/ui", importer) as { path: string }).path,
    join(root, "packages/ui/src/index.ts"),
  );
  assert.equal(
    (resolver.resolve("@acme/ui/button", importer) as { path: string }).path,
    join(root, "packages/ui/src/button.tsx"),
  );
  assert.equal(resolver.resolve("react", importer).kind, "external");
  rmSync(root, { recursive: true, force: true });
});

test("fallback roots serve the legacy @/ alias", () => {
  const root = project({ "src/x.tsx": "", "src/lib/y.ts": "" });
  const resolver = createModuleResolver({ fallbackRoots: [join(root, "src")] });
  assert.equal(
    (resolver.resolve("@/lib/y", join(root, "src/x.tsx")) as { path: string })
      .path,
    join(root, "src/lib/y.ts"),
  );
  rmSync(root, { recursive: true, force: true });
});
