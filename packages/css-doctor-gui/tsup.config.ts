import { defineConfig } from "tsup";

const external = [
  "@zealakit/css-doctor-binding",
  "fast-glob",
];

export default defineConfig([
  {
    entry: {
      index: "server/index.ts",
    },
    format: ["esm"],
    platform: "node",
    target: "node18",
    dts: true,
    tsconfig: "tsconfig.server.json",
    sourcemap: true,
    clean: true,
    outDir: "dist-server",
    splitting: false,
    external,
  },
  {
    entry: {
      cli: "server/cli.ts",
    },
    format: ["esm"],
    platform: "node",
    target: "node18",
    dts: false,
    tsconfig: "tsconfig.server.json",
    sourcemap: true,
    clean: false,
    outDir: "dist-server",
    splitting: false,
    external,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
