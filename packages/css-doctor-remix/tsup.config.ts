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
  external: ["@zealakit/css-doctor-binding"],
});
