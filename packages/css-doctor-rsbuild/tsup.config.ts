import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  platform: "node",
  splitting: false,
  outDir: "dist",
  // Bundle internal shared helpers; keep binding + host bundlers external.
  noExternal: ["@zealakit/css-doctor-shared"],
  external: [
    "@rsbuild/core",
    "@rspack/core",
    "@zealakit/css-doctor-binding",
  ],
});
