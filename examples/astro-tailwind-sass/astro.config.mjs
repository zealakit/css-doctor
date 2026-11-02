import { readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import vue from "@astrojs/vue";
import svelte from "@astrojs/svelte";
import preact from "@astrojs/preact";
import solidJs from "@astrojs/solid-js";
import tailwindcss from "@tailwindcss/vite";
import { cssDoctor } from "@zealakit/css-doctor-vite";

const pageCssManifest = join(process.cwd(), ".css-doctor-page-css.json");

const linkPageCssIntegration = {
  name: "css-doctor-page-css-links",
  hooks: {
    "astro:build:done": async ({ dir }) => {
      let manifest;

      try {
        manifest = JSON.parse(await readFile(pageCssManifest, "utf8"));
      } catch {
        return;
      }

      const pages = manifest.pages ?? {};
      const commonFiles = manifest.common ?? [];
      const distDir = fileURLToPath(dir);
      const commonLinks = commonFiles
        .map(
          (file) =>
            `    <link rel="stylesheet" href="/${file}" data-css-doctor-common>`,
        )
        .join("\n");

      if (commonLinks.length > 0) {
        const htmlFiles = [
          "index.html",
          "page-index/index.html",
          "page-preact/index.html",
          "page-react/index.html",
          "page-solid/index.html",
          "page-svelte/index.html",
          "page-vue/index.html",
        ];

        for (const htmlFile of htmlFiles) {
          const candidate = join(distDir, htmlFile);

          try {
            const html = await readFile(candidate, "utf8");

            if (!html.includes(commonLinks)) {
              await writeFile(
                candidate,
                html.replace("</head>", `${commonLinks}\n  </head>`),
                "utf8",
              );
            }
          } catch {
            // Page may not exist for a custom build.
          }
        }
      }

      for (const [page, files] of Object.entries(pages)) {
        const candidates =
          page === "index"
            ? [join(distDir, "index.html")]
            : [
                join(distDir, `page-${page}`, "index.html"),
                join(distDir, page, "index.html"),
              ];
        const links = files
          .map(
            (file) =>
              `    <link rel="stylesheet" href="/${file}" data-css-doctor-page>`,
          )
          .join("\n");

        for (const candidate of candidates) {
          try {
            const html = await readFile(candidate, "utf8");

            if (!html.includes(links)) {
              await writeFile(
                candidate,
                html.replace("</head>", `${links}\n  </head>`),
                "utf8",
              );
            }
            break;
          } catch {
            // Try the next output shape.
          }
        }
      }

      await rm(pageCssManifest, { force: true });
    },
  },
};

export default defineConfig({
  integrations: [
    linkPageCssIntegration,
    react({ include: ["**/island-react.tsx"] }),
    preact({ include: ["**/island-preact.tsx"] }),
    solidJs({ include: ["**/island-solid.tsx"] }),
    vue(),
    svelte(),
  ],
  vite: {
    plugins: [
      tailwindcss(),
      cssDoctor({
        pageCoverage: {
          enabled: true,
          minPageRatio: 0.5,
        },
        sizeBudget: {
          enabled: true,
          maxChunkSize: 25 * 1024,
          isolateVariables: true,
        },
        minify: true,
        report: true,
        onDiagnostics: async (diagnostics) => {
          const pages = {};
          const common = diagnostics.emittedCssChunks
            .filter((chunk) => !chunk.embedded && chunk.page === undefined)
            .map((chunk) => chunk.fileName);

          for (const chunk of diagnostics.emittedPageChunks) {
            pages[chunk.page] = pages[chunk.page] ?? [];
            pages[chunk.page].push(chunk.fileName);
          }

          if (Object.keys(pages).length > 0 || common.length > 0) {
            await writeFile(
              pageCssManifest,
              JSON.stringify({ common, pages }),
              "utf8",
            );
          }
        },
      }),
    ],
  },
});
