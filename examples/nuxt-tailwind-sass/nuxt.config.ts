import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const nuxtPackageRoot = resolve(repositoryRoot, "packages/css-doctor-nuxt");
const nuxtSourceEntry = resolve(nuxtPackageRoot, "src/index.ts");
const nuxtDistEntry = resolve(nuxtPackageRoot, "dist/index.js");
const viteSourceEntry = resolve(
  repositoryRoot,
  "packages/css-doctor-vite/src/index.ts",
);
const useNuxtSource =
  process.env.NODE_ENV !== "production" || !existsSync(nuxtDistEntry);
const nuxtModule = useNuxtSource
  ? nuxtSourceEntry
  : "@zealakit/css-doctor-nuxt";

const stressSelectors = Array.from(
  { length: 140 },
  (_, index) => `.stress-surface-${index + 1}`,
);

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: false },

  modules: [nuxtModule],

  alias: useNuxtSource
    ? {
        "@zealakit/css-doctor-nuxt": nuxtSourceEntry,
        "@zealakit/css-doctor-vite": viteSourceEntry,
      }
    : {},

  css: ["~/assets/styles-tailwind.css", "~/assets/styles-custom.scss"],

  cssDoctor: {
    pageCoverage: {
      enabled: true,
      minPageRatio: 0.5,
      forceCommon: [".app-header-shell", ".nav-pill-btn", ...stressSelectors],
    },
    sizeBudget: {
      enabled: true,
      maxChunkSize: 25 * 1024,
      isolateVariables: true,
    },
    minify: true,
    report: true,
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
