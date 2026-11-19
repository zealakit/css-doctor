import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "vite";

import { cssDoctor } from "../src/index";
import type { CssDoctorDiagnostics, CssDoctorViteOptions } from "../src/types";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const appRoot = join(packageRoot, "test/fixtures/app");

type EmittedAsset = {
  type: "asset";
  name?: string;
  fileName: string;
  source: string | Uint8Array;
};

type PluginContextLike = {
  warn: (message: string) => void;
  getModuleInfo: (id: string) => { code?: string | null } | null;
  emitFile: (asset: {
    type: "asset";
    name?: string;
    source: string | Uint8Array;
  }) => string;
  getFileName: (referenceId: string) => string;
};

type GenerateBundleHook = (
  this: PluginContextLike,
  options: unknown,
  bundle: Record<string, unknown>,
) => Promise<void>;

function hookFor(plugin: ReturnType<typeof cssDoctor>): GenerateBundleHook {
  const hook = plugin.generateBundle;

  if (typeof hook !== "function") {
    throw new Error("generateBundle hook is not a function");
  }

  return hook as unknown as GenerateBundleHook;
}

function asset(fileName: string, source: string): Record<string, unknown> {
  return {
    type: "asset",
    fileName,
    source,
    names: [],
    originalFileNames: [],
  };
}

function directContext(
  emitted: EmittedAsset[],
  warnings: string[] = [],
): PluginContextLike {
  const fileNames = new Map<string, string>();
  let nextReference = 0;

  return {
    warn: (message) => warnings.push(message),
    getModuleInfo: () => null,
    emitFile: (item) => {
      nextReference += 1;
      const referenceId = String(nextReference);
      const name = item.name ?? `asset-${referenceId}.css`;
      const fileName = `assets/${name.replace(/\.css$/, "")}-testhash.css`;
      fileNames.set(referenceId, fileName);
      emitted.push({ ...item, fileName });
      return referenceId;
    },
    getFileName: (referenceId) => {
      const fileName = fileNames.get(referenceId);

      if (!fileName) {
        throw new Error(`Unknown asset reference: ${referenceId}`);
      }

      return fileName;
    },
  };
}

async function buildFixture(
  options: CssDoctorViteOptions = {},
): Promise<CssDoctorDiagnostics> {
  const captured: CssDoctorDiagnostics[] = [];

  await build({
    root: appRoot,
    logLevel: "silent",
    plugins: [
      cssDoctor({
        report: false,
        ...options,
        onDiagnostics: (result) => {
          captured.push(result);
        },
      }),
    ],
    build: {
      write: false,
      rollupOptions: {
        input: {
          pageA: join(appRoot, "page-a.html"),
          pageB: join(appRoot, "page-b.html"),
        },
      },
    },
  });

  const diagnostics = captured[0];
  assert.ok(diagnostics, "onDiagnostics should be called");
  return diagnostics;
}

test("splits CSS assets during a real Vite build", async () => {
  const diagnostics = await buildFixture({ minPageRatio: 0.75 });

  assert.equal(diagnostics.plugin, "vite-plugin-css-doctor");
  assert.equal(diagnostics.totalCssAssets, 2);
  assert.equal(diagnostics.analyzedCssAssets, 2);
  assert.equal(diagnostics.skippedCssAssets, 0);
  assert.equal(diagnostics.failedCssAssets, 0);
  assert.equal(diagnostics.totalSelectors, 4);
  assert.equal(diagnostics.splitApplied, true);
  assert.equal(diagnostics.pages.length, 2);
  assert.ok(
    diagnostics.pages.every((page) => (diagnostics.pageUsage[page] ?? 0) > 0),
  );

  assert.equal(diagnostics.deadCodeCount, 1);
  assert.equal(diagnostics.emittedPageChunks.length, 2);
  assert.ok(
    diagnostics.emittedPageChunks.every(
      (chunk) =>
        chunk.fileName.startsWith("assets/") &&
        /-[^/]+\.css$/.test(chunk.fileName),
    ),
  );
  assert.ok(diagnostics.pageSpecificCssBytes > 0);
  assert.ok(diagnostics.files.every((file) => file.split !== undefined));

  const dead = diagnostics.usageMatrix.find(
    (stat) => stat.selector === ".legacy-popup",
  );
  assert.ok(dead);
  assert.equal(dead.pageCount, 0);
  assert.equal(dead.targetChunk, "dead");

  const pageA = diagnostics.usageMatrix.find(
    (stat) => stat.selector === ".page-a",
  );
  assert.ok(pageA);
  assert.equal(pageA.pageCount, 1);
  assert.match(pageA.targetChunk, /^page:/);
});

test("skips page coverage when no page classes are detected", async () => {
  const captured: CssDoctorDiagnostics[] = [];
  const emitted: EmittedAsset[] = [];
  const plugin = cssDoctor({
    report: false,
    sizeBudget: { enabled: false },
    minify: false,
    pageUsage: {
      home: [],
      about: [],
    },
    onDiagnostics: (result) => {
      captured.push(result);
    },
  });

  const original =
    ".shared { color: red; } .about-only { color: blue; } .dead { display: none; }";
  const bundle: Record<string, unknown> = {
    "assets/all.css": asset("assets/all.css", original),
  };

  await hookFor(plugin).call(directContext(emitted), {}, bundle);

  const diagnostics = captured[0];
  assert.ok(diagnostics);
  assert.equal(diagnostics.splitApplied, false);
  assert.equal(diagnostics.deadCodeCount, 0);
  assert.equal(diagnostics.emittedPageChunks.length, 0);
  assert.match(
    String((bundle["assets/all.css"] as { source: unknown }).source),
    /\.shared/,
  );
  assert.match(
    String((bundle["assets/all.css"] as { source: unknown }).source),
    /\.dead/,
  );
});

test("splits CSS using explicit pageUsage", async () => {
  const captured: CssDoctorDiagnostics[] = [];
  const emitted: EmittedAsset[] = [];
  const plugin = cssDoctor({
    report: false,
    pageUsage: {
      home: ["shared"],
      about: ["shared", "about-only"],
      contact: ["shared"],
    },
    onDiagnostics: (result) => {
      captured.push(result);
    },
  });

  const bundle: Record<string, unknown> = {
    "assets/all.css": asset(
      "assets/all.css",
      ".shared { color: red; } .about-only { color: blue; } .dead { display: none; }",
    ),
  };

  await hookFor(plugin).call(directContext(emitted), {}, bundle);

  const diagnostics = captured[0];
  assert.ok(diagnostics);
  assert.equal(diagnostics.splitApplied, true);
  assert.equal(diagnostics.minify, true);
  assert.deepEqual(diagnostics.pages.sort(), ["about", "contact", "home"]);
  assert.equal(diagnostics.deadCodeCount, 1);
  assert.equal(diagnostics.emittedPageChunks.length, 1);
  assert.equal(diagnostics.emittedPageChunks[0]?.page, "about");
  assert.match(
    diagnostics.emittedPageChunks[0]?.fileName ?? "",
    /assets\/page-about-[^/]+\.css$/,
  );

  const common = String(
    (bundle["assets/all.css"] as { source: unknown }).source,
  );
  assert.match(common, /\.shared/);
  assert.doesNotMatch(common, /\.dead/);
  assert.doesNotMatch(common, /\.about-only/);

  const aboutChunk = emitted.find((item) =>
    item.fileName.includes("page-about"),
  );
  assert.ok(aboutChunk);
  assert.match(String(aboutChunk.source), /\.about-only/);

  const matrixSelector = diagnostics.usageMatrix.find(
    (stat) => stat.selector === ".about-only",
  );
  assert.ok(matrixSelector);
  assert.equal(matrixSelector.targetChunk, "page:about");
  assert.equal(matrixSelector.pageCount, 1);
  assert.ok(Math.abs(matrixSelector.coverageRatio - 0.3333) < 0.0001);
});

test("respects include/exclude filters", async () => {
  const captured: CssDoctorDiagnostics[] = [];
  const emitted: EmittedAsset[] = [];
  const plugin = cssDoctor({
    report: false,
    exclude: [/all\.css$/],
    onDiagnostics: (result) => {
      captured.push(result);
    },
  });

  await hookFor(plugin).call(
    directContext(emitted),
    {},
    {
      "assets/all.css": asset("assets/all.css", ".a { color: red; }"),
      "assets/keep.css": asset("assets/keep.css", ".b { color: blue; }"),
    },
  );

  const diagnostics = captured[0];
  assert.ok(diagnostics);
  assert.equal(diagnostics.totalCssAssets, 2);
  assert.equal(diagnostics.analyzedCssAssets, 1);
  assert.equal(diagnostics.skippedCssAssets, 1);
  assert.equal(diagnostics.files.length, 1);
  assert.equal(diagnostics.files[0]?.fileName, "assets/keep.css");
});

test("invalid CSS is reported without interrupting the build", async () => {
  const captured: CssDoctorDiagnostics[] = [];
  const plugin = cssDoctor({
    report: false,
    pageUsage: { home: ["app"] },
    onDiagnostics: (result) => {
      captured.push(result);
    },
  });

  await assert.doesNotReject(
    hookFor(plugin).call(
      directContext([]),
      {},
      {
        "bad.css": asset("bad.css", ".broken { color red; }"),
      },
    ),
  );

  const diagnostics = captured[0];
  assert.ok(diagnostics);
  assert.equal(diagnostics.failedCssAssets, 0);
  assert.ok(
    diagnostics.files[0]?.warnings.some((warning) => warning.kind === "syntax"),
  );
});

test("a throwing onDiagnostics callback is contained", async () => {
  const warnings: string[] = [];
  const plugin = cssDoctor({
    report: false,
    onDiagnostics: () => {
      throw new Error("callback boom");
    },
  });

  await assert.doesNotReject(
    hookFor(plugin).call(
      directContext([], warnings),
      {},
      {
        "a.css": asset("a.css", ".a { color: red; }"),
      },
    ),
  );

  assert.ok(warnings.some((warning) => warning.includes("onDiagnostics")));
});

test("prints the usage matrix and dead-code report", async () => {
  const lines: string[] = [];
  const originalLog = console.log;

  console.log = ((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  }) as typeof console.log;

  try {
    const plugin = cssDoctor({
      report: true,
      pageUsage: {
        home: ["shared"],
        about: ["shared", "about-only"],
        contact: ["shared"],
      },
    });

    await hookFor(plugin).call(
      directContext([]),
      {},
      {
        "assets/all.css": asset(
          "assets/all.css",
          ".shared { color: red; } .about-only { color: blue; } .dead { display: none; }",
        ),
      },
    );
  } finally {
    console.log = originalLog;
  }

  const output = lines.join("\n");
  assert.match(output, /\[css-doctor\]/);
  assert.match(output, /Usage Matrix/);
  assert.match(output, /Assigned Chunk/);
  assert.match(output, /assets\/page-about-[^\s]+\.css/);
  assert.match(output, /Size budget/);
  assert.match(output, /Minified: YES/);
  assert.match(output, /Dead code eliminated/);
});

test("disables Vite cssMinify when minify is false", async () => {
  const output = (await build({
    root: appRoot,
    logLevel: "silent",
    plugins: [
      cssDoctor({
        report: false,
        minify: false,
        pageCoverage: { enabled: false },
      }),
    ],
    build: {
      write: false,
      rollupOptions: {
        input: join(appRoot, "page-a.html"),
      },
    },
  })) as {
    output: Array<{
      type: string;
      fileName: string;
      source?: string | Uint8Array;
    }>;
  };

  const css = output.output.find(
    (item) => item.type === "asset" && item.fileName.endsWith(".css"),
  );
  assert.ok(css);
  const source = String(css.source);
  assert.match(source, /\n/);
  assert.match(source, /color: #646cff/);
});

test("clamps an invalid minPageRatio instead of crashing the build", () => {
  assert.doesNotThrow(() => cssDoctor({ minPageRatio: 1.5 }));
});

test("treats direct dynamic route imports as pages", async () => {
  const captured: CssDoctorDiagnostics[] = [];
  const spaRoot = join(packageRoot, "test/fixtures/spa");

  const buildOutput = (await build({
    root: spaRoot,
    logLevel: "silent",
    plugins: [
      cssDoctor({
        report: false,
        minPageRatio: 0.75,
        onDiagnostics: (result) => {
          captured.push(result);
        },
      }),
    ],
    build: {
      write: false,
    },
  })) as {
    output: Array<{
      type: string;
      fileName: string;
      code?: string;
      source?: string;
    }>;
  };

  const diagnostics = captured[0];
  assert.ok(diagnostics);
  assert.deepEqual(diagnostics.pages.slice().sort(), ["about", "home"]);
  assert.equal(diagnostics.splitApplied, true);
  assert.equal(diagnostics.deadCodeCount, 1);
  assert.equal(diagnostics.emittedPageChunks.length, 2);
  assert.ok(
    diagnostics.emittedPageChunks.some((chunk) => chunk.page === "home"),
  );
  assert.ok(
    diagnostics.emittedPageChunks.some((chunk) => chunk.page === "about"),
  );

  const homeCss = diagnostics.emittedPageChunks.find(
    (chunk) => chunk.page === "home",
  );
  assert.ok(homeCss);
  const homeChunk = buildOutput.output.find(
    (output) =>
      output.type === "chunk" &&
      output.fileName.includes("home-") &&
      output.code !== undefined,
  );
  assert.ok(homeChunk?.code);
  assert.ok(homeChunk.code.includes(homeCss.fileName));

  const htmlAsset = buildOutput.output.find(
    (output) => output.type === "asset" && output.fileName.endsWith(".html"),
  );
  assert.ok(htmlAsset?.source);
  assert.doesNotMatch(
    htmlAsset.source,
    new RegExp(homeCss.fileName.replaceAll(".", "\\.")),
  );

  const shared = diagnostics.usageMatrix.find(
    (stat) => stat.selector === ".shared-card",
  );
  assert.ok(shared);
  assert.equal(shared.pageCount, 2);
  assert.equal(shared.targetChunk, "common");

  const homeOnly = diagnostics.usageMatrix.find(
    (stat) => stat.selector === ".home-only",
  );
  assert.ok(homeOnly);
  assert.equal(homeOnly.pageCount, 1);
  assert.equal(homeOnly.targetChunk, "page:home");

  const dead = diagnostics.usageMatrix.find(
    (stat) => stat.selector === ".dead-route",
  );
  assert.ok(dead);
  assert.equal(dead.pageCount, 0);
  assert.equal(dead.targetChunk, "dead");
});

test("isolates variables and injects size-budget parts", async () => {
  const captured: CssDoctorDiagnostics[] = [];
  const emitted: EmittedAsset[] = [];
  const plugin = cssDoctor({
    report: false,
    pageCoverage: { enabled: false },
    sizeBudget: {
      maxChunkSize: 90,
      isolateVariables: true,
    },
    onDiagnostics: (result) => {
      captured.push(result);
    },
  });

  const html = `<!doctype html><html><head><title>Size budget</title></head><body></body></html>`;
  const css = `
    :root { --brand: #646cff; --space: 4px; }
    .a { color: red; }
    .b { color: blue; }
    .c { color: green; }
    .d { color: orange; }
    .e { color: purple; }
    .f { color: teal; }
    .g { color: pink; }
    .h { color: brown; }
  `;
  const bundle: Record<string, unknown> = {
    "index.html": asset("index.html", html),
    "assets/all.css": asset("assets/all.css", css),
  };

  await hookFor(plugin).call(directContext(emitted), {}, bundle);

  const diagnostics = captured[0];
  assert.ok(diagnostics);
  assert.equal(diagnostics.pageCoverage.enabled, false);
  assert.equal(diagnostics.sizeBudget.enabled, true);
  assert.equal(diagnostics.sizeBudget.maxChunkSize, 90);
  assert.ok(diagnostics.sizeBudget.splitChunks > 0);
  assert.ok(diagnostics.emittedCssChunks.some((chunk) => chunk.variables));
  assert.ok(
    diagnostics.emittedCssChunks.some(
      (chunk) => chunk.kind === "part" && chunk.part !== undefined,
    ),
  );

  const variableChunk = diagnostics.emittedCssChunks.find(
    (chunk) => chunk.variables,
  );
  assert.ok(variableChunk);
  assert.match(variableChunk.fileName, /common-vars-[^/]+\.css$/);
  assert.equal(variableChunk.embedded, false);

  const partFiles = emitted
    .map((item) => item.fileName)
    .filter((fileName) => fileName.includes("part-"));

  assert.ok(partFiles.length > 0);
  const htmlSource = String(
    (bundle["index.html"] as { source: unknown }).source,
  );
  assert.ok(htmlSource.includes(variableChunk.fileName));
  const firstPart = partFiles[0];
  assert.ok(firstPart);
  assert.ok(htmlSource.includes(firstPart));
  assert.ok(
    htmlSource.indexOf(variableChunk.fileName) < htmlSource.indexOf(firstPart),
  );
  assert.equal(
    String((bundle["assets/all.css"] as { source: unknown }).source),
    "",
  );
});

test("injects common CSS before </body> when </head> is missing", async () => {
  const captured: CssDoctorDiagnostics[] = [];
  const emitted: EmittedAsset[] = [];
  const plugin = cssDoctor({
    report: false,
    pageCoverage: { enabled: false },
    sizeBudget: {
      maxChunkSize: 90,
      isolateVariables: true,
    },
    onDiagnostics: (result) => {
      captured.push(result);
    },
  });

  const html = `<!doctype html><html><body><h1>No head</h1></body></html>`;
  const css = `
    :root { --brand: #646cff; --space: 4px; }
    .a { color: red; }
    .b { color: blue; }
    .c { color: green; }
    .d { color: orange; }
    .e { color: purple; }
    .f { color: teal; }
    .g { color: pink; }
    .h { color: brown; }
  `;
  const bundle: Record<string, unknown> = {
    "index.html": asset("index.html", html),
    "assets/all.css": asset("assets/all.css", css),
  };

  await hookFor(plugin).call(directContext(emitted), {}, bundle);

  const diagnostics = captured[0];
  assert.ok(diagnostics);
  const htmlSource = String(
    (bundle["index.html"] as { source: unknown }).source,
  );
  assert.ok(htmlSource.includes("</body>"));
  assert.ok(
    diagnostics.emittedCssChunks.some((chunk) =>
      htmlSource.includes(chunk.fileName),
    ),
    "expected stylesheet links before </body>",
  );
});

test("falls back to JS loader when HTML has no injection point", async () => {
  const captured: CssDoctorDiagnostics[] = [];
  const emitted: EmittedAsset[] = [];
  const plugin = cssDoctor({
    report: false,
    pageCoverage: { enabled: true, minPageRatio: 1 },
    sizeBudget: { enabled: false },
    pageUsage: {
      home: ["home-only"],
      about: ["about-only"],
    },
    onDiagnostics: (result) => {
      captured.push(result);
    },
  });

  const bundle: Record<string, unknown> = {
    // No </head>/</body>/</html> — HTML inject must fail open to the loader.
    "home.html": asset("home.html", "<!doctype html><title>home</title>"),
    "assets/home.js": {
      type: "chunk",
      fileName: "assets/home.js",
      name: "home",
      isEntry: true,
      facadeModuleId: join(appRoot, "page-a.html"),
      code: "export default 1;",
      modules: {},
      imports: [],
      dynamicImports: [],
      viteMetadata: { importedCss: new Set(["assets/all.css"]) },
    },
    "assets/about.js": {
      type: "chunk",
      fileName: "assets/about.js",
      name: "about",
      isEntry: true,
      facadeModuleId: join(appRoot, "page-b.html"),
      code: "export default 2;",
      modules: {},
      imports: [],
      dynamicImports: [],
      viteMetadata: { importedCss: new Set(["assets/all.css"]) },
    },
    "assets/all.css": asset(
      "assets/all.css",
      ".home-only { color: red; } .about-only { color: blue; }",
    ),
  };

  await hookFor(plugin).call(directContext(emitted), {}, bundle);

  const diagnostics = captured[0];
  assert.ok(diagnostics);
  assert.ok(diagnostics.splitApplied);
  assert.ok(
    diagnostics.emittedPageChunks.some((chunk) => chunk.page === "home"),
  );

  const homeChunk = bundle["assets/home.js"] as { code: string };
  assert.match(homeChunk.code, /__cssDoctorPageStyles/);
});

test("skips splitting for library builds", async () => {
  const plugin = cssDoctor({ report: false });
  const warnings: string[] = [];
  const configHook = plugin.configResolved;
  assert.ok(typeof configHook === "function");
  (
    configHook as (
      this: unknown,
      config: {
        base: string;
        mode: string;
        command: string;
        build: { lib?: { entry: string }; ssr?: boolean };
      },
    ) => void
  ).call(
    {},
    {
      base: "/",
      mode: "production",
      command: "build",
      build: { lib: { entry: "src/index.ts" } },
    },
  );

  const bundle: Record<string, unknown> = {
    "assets/all.css": asset("assets/all.css", ".keep { color: red; }"),
  };
  await hookFor(plugin).call(directContext([], warnings), {}, bundle);
  assert.equal(
    String((bundle["assets/all.css"] as { source: unknown }).source),
    ".keep { color: red; }",
  );
  assert.ok(warnings.some((warning) => /library\/SSR/i.test(warning)));
});

test("honors minify: false", async () => {
  const captured: CssDoctorDiagnostics[] = [];
  const plugin = cssDoctor({
    report: false,
    minify: false,
    pageUsage: { home: ["app"] },
    onDiagnostics: (result) => {
      captured.push(result);
    },
  });

  const bundle: Record<string, unknown> = {
    "assets/all.css": asset(
      "assets/all.css",
      ".app { color: red; } .dead { display: none; }",
    ),
  };

  await hookFor(plugin).call(directContext([]), {}, bundle);

  const diagnostics = captured[0];
  assert.ok(diagnostics);
  assert.equal(diagnostics.minify, false);
  const common = String(
    (bundle["assets/all.css"] as { source: unknown }).source,
  );
  assert.match(common, /color: red/);
  assert.doesNotMatch(common, /\.dead/);
});

test("wrapCommonImports uses relative paths for nested assets", async () => {
  const captured: CssDoctorDiagnostics[] = [];
  const emitted: EmittedAsset[] = [];
  const plugin = cssDoctor({
    report: false,
    wrapCommonImports: true,
    pageCoverage: { enabled: false },
    sizeBudget: { enabled: true, maxChunkSize: 40, isolateVariables: true },
    onDiagnostics: (result) => {
      captured.push(result);
    },
  });

  const large =
    ":root { --a: 1; --b: 2; --c: 3; --d: 4; } " +
    ".a{color:red}.b{color:blue}.c{color:green}.d{color:navy}.e{color:teal}.f{color:purple}";
  const bundle: Record<string, unknown> = {
    "style.css": asset("style.css", large),
  };

  await hookFor(plugin).call(directContext(emitted), {}, bundle);

  const diagnostics = captured[0];
  assert.ok(diagnostics);
  const source = String((bundle["style.css"] as { source: unknown }).source);
  const nestedEmitted = diagnostics.emittedCssChunks.filter(
    (chunk) =>
      !chunk.embedded &&
      chunk.fileName !== "style.css" &&
      chunk.fileName.includes("/"),
  );
  if (nestedEmitted.length > 0) {
    assert.match(source, /@import "/);
    for (const chunk of nestedEmitted) {
      const relative = chunk.fileName; // from style.css at repo root of bundle
      assert.ok(
        source.includes(`@import "./${relative}"`) ||
          source.includes(`@import "${relative}"`),
        `expected directory-aware import for ${chunk.fileName} in:\n${source}`,
      );
    }
  }
});

test("clamps an invalid size budget instead of crashing the build", () => {
  assert.doesNotThrow(() => cssDoctor({ sizeBudget: { maxChunkSize: 0 } }));
});

test("splits CSS Modules by usage and keeps dynamic modules whole", async () => {
  const captured: CssDoctorDiagnostics[] = [];
  const root = join(packageRoot, "test/fixtures/modules");
  const hooked: string[] = [];

  const result = (await build({
    root,
    logLevel: "silent",
    css: {
      modules: {
        getJSON(file) {
          hooked.push(file);
        },
      },
    },
    plugins: [
      cssDoctor({
        report: false,
        minify: false,
        minPageRatio: 1,
        sizeBudget: { enabled: false },
        onDiagnostics: (d) => {
          captured.push(d);
        },
      }),
    ],
    build: { write: false },
  })) as {
    output: Array<{
      type: string;
      fileName: string;
      source?: unknown;
      code?: string;
    }>;
  };

  assert.equal(hooked.length, 2, "user getJSON hook still runs");
  const css = result.output
    .filter((o) => o.type === "asset" && o.fileName.endsWith(".css"))
    .map((o) => String(o.source))
    .join("\n");

  // static usage keeps only referenced classes; the unused one is removed
  assert.match(css, /hero/);
  assert.match(css, /is-open/);
  assert.doesNotMatch(css, /unused-home/);
  // dynamic access keeps every class of that module
  assert.match(css, /card/);
  assert.match(css, /footer/);
  assert.equal(captured[0]?.errors.length, 0);
});

test("cssModules: false leaves module CSS untouched", async () => {
  const root = join(packageRoot, "test/fixtures/modules");
  const result = (await build({
    root,
    logLevel: "silent",
    plugins: [
      cssDoctor({
        report: false,
        minify: false,
        cssModules: false,
        minPageRatio: 1,
      }),
    ],
    build: { write: false },
  })) as {
    output: Array<{ type: string; fileName: string; source?: unknown }>;
  };
  const css = result.output
    .filter((o) => o.type === "asset" && o.fileName.endsWith(".css"))
    .map((o) => String(o.source))
    .join("\n");
  assert.match(css, /unused-home/);
});
