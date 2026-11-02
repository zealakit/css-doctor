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
  // Bundle the CLI's JavaScript dependencies so npx works even when optional
  // transitive packages are not installed by the npm client.
  noExternal: [/.*/],
  shims: true,
  // The native binding must remain a dynamic runtime require. It resolves the
  // correct platform package (.node) at execution time.
  external: ["@zealakit/css-doctor-binding"],
  banner: {
    js: [
      "#!/usr/bin/env node",
      'import { createRequire as __cssDoctorCreateRequire } from "node:module";',
      "const require = __cssDoctorCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});
