import { defineConfig } from "tsup";

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
    // Bundle internal shared helpers; never leave workspace:* in published dist.
    noExternal: ["@zealakit/css-doctor-shared"],
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
    noExternal: ["@zealakit/css-doctor-shared"],
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
]);
