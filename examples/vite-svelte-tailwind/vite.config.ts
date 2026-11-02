import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { cssDoctor } from "@zealakit/css-doctor-vite";

export default defineConfig({
  plugins: [
    svelte(),
    tailwindcss(),
    cssDoctor({
      pageCoverage: {
        enabled: true,
        minPageRatio: 0.5,
      },
      sizeBudget: {
        enabled: true,
        maxChunkSize: 30 * 1024,
        isolateVariables: true,
      },
      minify: true,
      report: true,
    }),
  ],
});
