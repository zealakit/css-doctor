import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  target: "node18",
  platform: "node",
  splitting: false,
  dts: false,
  outDir: "dist",
  // Bundle CLI JS deps (including internal css-doctor-shared) for npx, but
  // never fold the native binding or the GUI server into this binary
  // (GUI resolves its own dist/ via import.meta.url).
  noExternal: [
    /^(?!@zealakit\/css-doctor-binding$)(?!@zealakit\/css-doctor-gui(?:\/|$)).+$/,
  ],
  shims: true,
  // The native binding must remain a dynamic runtime require. It resolves the
  // correct platform package (.node) at execution time.
  external: [
    "@zealakit/css-doctor-binding",
    "@zealakit/css-doctor-gui",
    "@zealakit/css-doctor-gui/server",
  ],
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __cssDoctorCreateRequire } from "node:module";',
      "const require = __cssDoctorCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
