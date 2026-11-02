import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cssDoctor } from "@zealakit/css-doctor-vite";

const stressSelectors = Array.from(
  { length: 260 },
  (_, index) => `.stress-surface-${index + 1}`,
);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cssDoctor({
      pageCoverage: {
        enabled: true,
        minPageRatio: 0.5,
        forceCommon: [
          ".app-shell-header",
          ".nav-pill-item",
          ...stressSelectors,
        ],
      },
      sizeBudget: {
        enabled: true,
        maxChunkSize: 40 * 1024,
        isolateVariables: true,
      },
      minify: true,
      report: true,
    }),
  ],
});
