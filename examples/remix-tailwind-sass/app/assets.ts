import { readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

import { createAssetServer } from "remix/assets";
import type { AssetServer } from "remix/assets";
import * as sass from "sass";
import { compile } from "tailwindcss";
import { withCssDoctorAssets } from "@zealakit/css-doctor-remix";

const require = createRequire(import.meta.url);
const root = process.cwd();
const appDir = join(root, "app");

async function readStyle(path: string): Promise<string> {
  return readFile(join(appDir, "styles", path), "utf8");
}

async function collectCandidates(directory: string): Promise<string[]> {
  const candidates = new Set<string>();

  async function walk(current: string): Promise<void> {
    let entries: Dirent[];

    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = join(current, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (!/\.(?:tsx?|jsx?|html?|astro|svelte|vue|mdx)$/i.test(entry.name)) {
        continue;
      }

      let source: string;

      try {
        source = await readFile(entryPath, "utf8");
      } catch {
        continue;
      }

      for (const match of source.matchAll(
        /(?:class|className)\s*=\s*["'`]([^"'`]+)["'`]/g,
      )) {
        const value = match[1];

        if (!value) {
          continue;
        }

        for (const token of value.split(/\s+/)) {
          if (token.length > 0 && !token.includes("{")) {
            candidates.add(token);
          }
        }
      }
    }
  }

  await walk(directory);
  return [...candidates];
}

async function loadStylesheet(
  id: string,
  base: string,
): Promise<{ path: string; base: string; content: string }> {
  const specifier = id === "tailwindcss" ? "tailwindcss/index.css" : id;
  const path = specifier.startsWith(".")
    ? resolve(base, specifier)
    : require.resolve(specifier, { paths: [base] });

  return {
    path,
    base: dirname(path),
    content: await readFile(path, "utf8"),
  };
}

const candidates = await collectCandidates(appDir);
const compiler = await compile(await readStyle("app.css"), {
  base: root,
  from: join(appDir, "styles", "app.css"),
  loadStylesheet,
});
const tailwindCss = compiler.build(candidates);
const globalCss = await readStyle("styles-global.css");
const customCss = (
  await sass.compileAsync(join(appDir, "styles", "styles-custom.scss"))
).css;
const dashboardCss = (
  await sass.compileAsync(join(appDir, "styles", "dashboard.module.scss"))
).css;
const settingsCss = await readStyle("settings.module.css");

const styleAssets = new Map<string, string>([
  ["/assets/app/styles/app.css", tailwindCss],
  ["/assets/app/styles/styles-global.css", globalCss],
  ["/assets/app/styles/styles-custom.css", customCss],
  ["/assets/app/styles/styles-custom.scss", customCss],
  ["/assets/app/styles/dashboard.module.css", dashboardCss],
  ["/assets/app/styles/dashboard.module.scss", dashboardCss],
  ["/assets/app/styles/settings.module.css", settingsCss],
]);

const baseAssets: AssetServer = createAssetServer({
  basePath: "/assets",
  rootDir: root,
  allowFiles: ["app/**", "app/**/public/**"],
  allowPackages: ["remix"],
  watch: false,
});

const styleServer = new Proxy(baseAssets, {
  get(target, property) {
    if (property === "fetch") {
      return async (request: Request): Promise<Response | null> => {
        const pathname = new URL(request.url).pathname;
        const css = styleAssets.get(pathname);

        if (css !== undefined) {
          return new Response(css, {
            status: 200,
            headers: {
              "content-type": "text/css; charset=utf-8",
            },
          });
        }

        return target.fetch(request);
      };
    }

    const value = Reflect.get(target, property, target);

    return typeof value === "function" ? value.bind(target) : value;
  },
});

export const assets = withCssDoctorAssets(styleServer, {
  sizeBudget: {
    enabled: true,
    maxChunkSize: 25 * 1024,
    isolateVariables: true,
  },
  minify: process.env.NODE_ENV === "production",
  cache: {
    enabled: true,
    maxEntries: 100,
  },
  exclude: [/\.module\.(css|scss)$/],
});
