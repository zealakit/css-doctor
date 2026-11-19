import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { rspack } from "@rspack/core";

import { pluginCssDoctor } from "../dist/index.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const entryPath = join(packageRoot, "test/fixtures/rspack-entry.js");

/**
 * Instantiates the production Rspack plugin the same way Rsbuild users do:
 * through `pluginCssDoctor().setup`, without exporting internal classes.
 */
function captureRspackPlugin(options = {}) {
  /** @type {{ plugin: { apply: (compiler: unknown) => void } }} */
  const captured = { plugin: { apply() {} } };
  const rsbuildPlugin = pluginCssDoctor(options);
  assert.equal(rsbuildPlugin.name, "css-doctor:rsbuild");
  assert.equal(rsbuildPlugin.apply, "build");

  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    rsbuildPlugin.setup({
      context: { bundlerType: "rspack" },
      modifyRspackConfig(callback) {
        const config = { plugins: [] };
        callback(config, { isProd: true });
        const plugin = config.plugins[0];
        assert.ok(plugin, "expected CssDoctorRspackPlugin registration");
        assert.equal(typeof plugin.apply, "function");
        captured.plugin = plugin;
      },
    });
  } finally {
    process.env.NODE_ENV = previous;
  }

  return captured;
}

class CssFixturePlugin {
  /**
   * @param {string} css
   * @param {string} [fileName]
   */
  constructor(css, fileName = "static/css/app.css") {
    this.css = css;
    this.fileName = fileName;
  }

  /** @param {import("@rspack/core").Compiler} compiler */
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("CssFixturePlugin", (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: "CssFixturePlugin",
          stage: compiler.rspack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONS,
        },
        () => {
          compilation.emitAsset(
            this.fileName,
            new compiler.rspack.sources.RawSource(this.css),
          );
        },
      );
    });
  }
}

/**
 * @param {string} css
 * @param {Record<string, unknown>} options
 */
async function runRspack(css, options) {
  const outputPath = await mkdtemp(join(tmpdir(), "cssd-rsbuild-"));
  /** @type {import("../dist/index.js").CssDoctorRsbuildDiagnostics[]} */
  const captured = [];
  const { plugin } = captureRspackPlugin({
    report: false,
    ...options,
    onDiagnostics: (diagnostics) => {
      captured.push(diagnostics);
    },
  });

  const stats = await new Promise((resolve, reject) => {
    const compiler = rspack({
      mode: "production",
      entry: entryPath,
      output: {
        path: outputPath,
        filename: "[name].js",
        clean: true,
      },
      optimization: {
        minimize: false,
      },
      plugins: [new CssFixturePlugin(css), plugin],
      stats: "errors-warnings",
    });
    compiler.run((error, result) => {
      compiler.close(() => undefined);
      if (error) {
        reject(error);
      } else if (!result) {
        reject(new Error("rspack returned no stats"));
      } else {
        resolve(result);
      }
    });
  });

  /** @type {Map<string, string>} */
  const assets = new Map();
  for (const [name, source] of Object.entries(stats.compilation.assets)) {
    assets.set(name, source.source().toString());
  }

  const diagnostics = captured[0];
  assert.ok(diagnostics, "expected onDiagnostics to fire");
  return { stats, diagnostics, assets };
}

test("pluginCssDoctor only registers on production rspack builds", () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const rsbuildPlugin = pluginCssDoctor({ report: false });
    let registered = false;
    rsbuildPlugin.setup({
      context: { bundlerType: "rspack" },
      modifyRspackConfig(callback) {
        const config = { plugins: [] };
        callback(config, { isProd: true });
        registered = (config.plugins?.length ?? 0) > 0;
      },
    });
    assert.equal(registered, false);
  } finally {
    process.env.NODE_ENV = previous;
  }

  captureRspackPlugin({ report: false });
});

test("splits CSS assets inside a real Rspack compilation", async () => {
  const { stats, diagnostics, assets } = await runRspack(
    ".shared{color:red}.home-only{color:blue}.dead{display:none}",
    {
      pageCoverage: { enabled: true, minPageRatio: 1 },
      sizeBudget: { enabled: false },
      pageUsage: {
        home: ["shared", "home-only"],
        about: ["shared"],
      },
    },
  );

  assert.equal(stats.hasErrors(), false);
  assert.equal(diagnostics.splitApplied, true);
  assert.ok(diagnostics.deadCodeSelectorsCount >= 1);
  assert.ok(diagnostics.emittedPageChunks.length >= 1);

  const pageCss = [...assets.entries()]
    .filter(([name]) => name.includes("page-") && name.endsWith(".css"))
    .map(([, css]) => css)
    .join("\n");
  assert.match(pageCss, /shared|home-only/);
  assert.doesNotMatch(pageCss, /\.dead/);

  const appCss = assets.get("static/css/app.css") ?? "";
  assert.doesNotMatch(appCss, /\.dead/);
});

test("skips *.module.css assets", async () => {
  const outputPath = await mkdtemp(join(tmpdir(), "cssd-rsbuild-mod-"));
  /** @type {import("../dist/index.js").CssDoctorRsbuildDiagnostics[]} */
  const captured = [];
  const { plugin } = captureRspackPlugin({
    report: false,
    pageUsage: { home: ["local"] },
    onDiagnostics: (diagnostics) => {
      captured.push(diagnostics);
    },
  });

  const stats = await new Promise((resolve, reject) => {
    const compiler = rspack({
      mode: "production",
      entry: entryPath,
      output: { path: outputPath, filename: "[name].js", clean: true },
      optimization: { minimize: false },
      plugins: [
        new CssFixturePlugin(".local{color:red}", "static/css/Button.module.css"),
        plugin,
      ],
    });
    compiler.run((error, result) => {
      compiler.close(() => undefined);
      if (error || !result) {
        reject(error ?? new Error("no stats"));
      } else {
        resolve(result);
      }
    });
  });

  assert.equal(stats.hasErrors(), false);
  const diagnostics = captured[0];
  assert.ok(diagnostics);
  assert.ok(diagnostics.skippedCssAssets >= 1);
  assert.equal(diagnostics.analyzedCssAssets, 0);
});

test("minify:false completes a production Rspack build without errors", async () => {
  const { stats, diagnostics } = await runRspack(".a{color:red}", {
    report: false,
    minify: false,
    pageCoverage: { enabled: false },
    sizeBudget: { enabled: false },
  });

  assert.equal(stats.hasErrors(), false);
  assert.equal(diagnostics.minify, false);
  assert.equal(diagnostics.failedCssAssets, 0);
});

test("clamps invalid size budget during plugin registration", () => {
  assert.doesNotThrow(() =>
    captureRspackPlugin({ sizeBudget: { maxChunkSize: 0 } }),
  );
});

test("splits CSS Modules by usage from css-loader exports", async () => {
  const moduleRoot = join(packageRoot, "test/fixtures/css-modules");
  const css = [
    ".card_hero__h4sh { color: red; }",
    ".card_is-open__h4sh { color: blue; }",
    ".card_unused__h4sh { color: green; }",
    ".other_a__h4sh { color: black; }",
    ".other_b__h4sh { color: gray; }",
  ].join("\n");

  const run = async (extra) => {
    const outputPath = await mkdtemp(join(tmpdir(), "cssd-rsbuild-cm-"));
    /** @type {import("../dist/index.js").CssDoctorRsbuildDiagnostics[]} */
    const captured = [];
    const { plugin } = captureRspackPlugin({
      report: false,
      minify: false,
      sizeBudget: { enabled: false },
      ...extra,
      onDiagnostics: (diagnostics) => {
        captured.push(diagnostics);
      },
    });
    const stats = await new Promise((resolve, reject) => {
      const compiler = rspack({
        mode: "production",
        entry: { index: join(moduleRoot, "entry.js") },
        output: { path: outputPath, filename: "[name].js", clean: true },
        optimization: { minimize: false },
        module: {
          rules: [
            {
              test: /\.module\.css$/,
              use: join(moduleRoot, "fake-css-loader.cjs"),
              type: "javascript/auto",
            },
          ],
        },
        plugins: [new CssFixturePlugin(css), plugin],
      });
      compiler.run((error, result) => {
        compiler.close(() => undefined);
        if (error || !result) {
          reject(error ?? new Error("no stats"));
        } else {
          resolve(result);
        }
      });
    });
    assert.equal(stats.hasErrors(), false, stats.toString());
    const diagnostics = captured[0];
    assert.ok(diagnostics);
    const { readFile } = await import("node:fs/promises");
    return {
      diagnostics,
      css: await readFile(join(outputPath, "static/css/app.css"), "utf8"),
    };
  };

  const split = await run({});
  assert.equal(split.diagnostics.skippedCssAssets, 0);
  assert.match(split.css, /card_hero__h4sh/);
  assert.match(split.css, /card_is-open__h4sh/);
  assert.doesNotMatch(split.css, /card_unused__h4sh/);
  assert.match(split.css, /other_a__h4sh/);
  assert.match(split.css, /other_b__h4sh/);

  const skipped = await run({ cssModules: false });
  assert.equal(skipped.diagnostics.skippedCssAssets, 1);
  assert.match(skipped.css, /card_unused__h4sh/);
});
