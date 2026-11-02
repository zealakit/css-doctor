import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginTailwindcss } from "@rsbuild/plugin-tailwindcss";
import { pluginCssDoctor } from "@zealakit/css-doctor-rsbuild";

export default defineConfig({
  plugins: [
    pluginReact({
      reactCompiler: true,
    }),
    pluginTailwindcss(),
    pluginCssDoctor({
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
  html: {
    title: "Rsbuild React Tailwind with css-doctor",
  },
});
