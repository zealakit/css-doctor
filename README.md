<div align="center">

# css-doctor

**Native CSS diagnostics, intelligent splitting, and production-grade optimization for modern web applications.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Rust](https://img.shields.io/badge/rust-stable-b7410e?logo=rust&logoColor=white)](https://www.rust-lang.org)

[English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Overview

`css-doctor` is a CSS analysis and optimization toolkit built on a native Rust
core using the **LightningCSS AST** and exposed to Node.js through **NAPI-RS**.

It is designed for teams that need more than minification: detect problematic
selectors, find dead CSS, understand page coverage, isolate variables, and split
oversized stylesheets without breaking framework-scoped styles.

The project ships a zero-config CLI, a native binding, and first-class adapters
for Vite, Next.js, Nuxt, Remix, and Rsbuild.

---

## Features

### Native Rust performance

CSS parsing, selector extraction, diagnostics, and splitting run in the Rust
core. The Node.js surface is a thin NAPI-RS bridge, so analysis stays fast even
on large stylesheets.

### Zero-config CLI

Run `css-doctor` immediately with `npx`, or install it as a development
dependency. The published CLI bundles its JavaScript dependencies; only the
native binding remains a dynamic runtime require.

### Comprehensive diagnostics

The CLI reports:

- syntax warnings;
- empty or dead rules;
- duplicate selectors;
- oversized stylesheets and selector-count thresholds;
- selector counts, rule counts, declarations, and analysis timing;
- structured JSON output for CI pipelines.

### Cross-platform native binaries

`@zealakit/css-doctor-binding` resolves prebuilt NAPI binaries for:

| Platform | Architecture  | Target           |
| -------- | ------------- | ---------------- |
| macOS    | Apple Silicon | `darwin-arm64`   |
| macOS    | Intel         | `darwin-x64`     |
| Linux    | x64 glibc     | `linux-x64-gnu`  |
| Linux    | x64 musl      | `linux-x64-musl` |
| Windows  | x64 MSVC      | `win32-x64-msvc` |

No Rust toolchain is required on supported platforms.

### Framework-aware CSS optimization

The integration packages support page-coverage splitting, size budgets, CSS
variable isolation, dead-code elimination, and safe handling of CSS Modules and
framework-scoped styles.

---

## Quick start — CLI

The CLI is for **static diagnostics** (syntax, empty rules, duplicate selectors,
selector thresholds). It does not minify or split CSS at build time — use a
framework adapter for that.

Full CLI guide:
[`packages/cli/README.md`](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README.md)
([Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README_VI.md) ·
[简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README_CN.md)).

### Run without installing

```bash
npx @zealakit/css-doctor-cli check "src/**/*.css"
```

### Install as a dev dependency

```bash
pnpm add -D @zealakit/css-doctor-cli

# or
npm install -D @zealakit/css-doctor-cli
```

Optional `package.json` scripts:

```json
{
  "scripts": {
    "css:check": "css-doctor check \"src/**/*.css\"",
    "css:check:ci": "css-doctor check \"src/**/*.css\" --json --threshold 500"
  }
}
```

### Command cheat sheet

```bash
# Help and version
css-doctor --help
css-doctor --version
css-doctor check --help

# Single file or multiple paths
css-doctor check src/styles/app.css
css-doctor check src/a.css src/b.css

# Glob — always quote so the shell does not expand first
css-doctor check "src/**/*.css"

# Mix a file and a glob
css-doctor check styles/global.css "components/**/*.css"

# CI: machine-readable JSON (+ optional selector budget)
css-doctor check "src/**/*.css" --json
css-doctor check "src/**/*.css" -j --threshold 500
```

| Flag | Purpose |
| --- | --- |
| `-j, --json` | Emit a stable `CheckReport` JSON document |
| `--threshold <n>` | Warn when a file has more than `<n>` selectors |
| `-v, --version` | Print the CLI version |
| `-h, --help` | Print help |

What `check` reports: `syntax`, `empty-rule`, `duplicate-selector`, and optional
`threshold` issues. Exit code `0` when every matched file was analyzed
(warnings allowed); `1` on setup/read/analyze failures.

Example terminal output:

```text
css-doctor v1.0.0 · check
patterns src/**/*.css
────────────────────────────────────────────────────────────────
 SUCCESS  src/styles/app.css · 12.4 KB
  selectors 184 · rules 132 · declarations 421
  analysis 3.2 ms · read 0.8 ms · total 4.0 ms
  Top selectors
    #app .card:hover
    .nav-link.is-active
```

---

## Framework integrations

| Framework / tool                   | Package                                                                                      | Install                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Vite, React, Vue, Svelte, TanStack | [`@zealakit/css-doctor-vite`](https://www.npmjs.com/package/@zealakit/css-doctor-vite)       | `pnpm add -D @zealakit/css-doctor-vite`    |
| Next.js App/Pages Router           | [`@zealakit/css-doctor-next`](https://www.npmjs.com/package/@zealakit/css-doctor-next)       | `pnpm add -D @zealakit/css-doctor-next`    |
| Nuxt 4                             | [`@zealakit/css-doctor-nuxt`](https://www.npmjs.com/package/@zealakit/css-doctor-nuxt)       | `pnpm add -D @zealakit/css-doctor-nuxt`    |
| Remix 3                            | [`@zealakit/css-doctor-remix`](https://www.npmjs.com/package/@zealakit/css-doctor-remix)     | `pnpm add @zealakit/css-doctor-remix`      |
| Rsbuild / Rspack                   | [`@zealakit/css-doctor-rsbuild`](https://www.npmjs.com/package/@zealakit/css-doctor-rsbuild) | `pnpm add -D @zealakit/css-doctor-rsbuild` |
| CLI                                | [`@zealakit/css-doctor-cli`](https://www.npmjs.com/package/@zealakit/css-doctor-cli)         | `pnpm add -D @zealakit/css-doctor-cli`     |
| Native binding                     | [`@zealakit/css-doctor-binding`](https://www.npmjs.com/package/@zealakit/css-doctor-binding) | Installed transitively                     |

Each package directory contains English, Vietnamese, and Simplified Chinese
README files. The root translations remain available at
[Tiếng Việt](./README_VI.md) and [简体中文](./README_CN.md).

### Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { cssDoctor } from "@zealakit/css-doctor-vite";

export default defineConfig({
  plugins: [
    cssDoctor({
      pageCoverage: {
        enabled: true,
        minPageRatio: 0.5,
        forceCommon: [".app-shell", ".nav-link"],
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
```

### Next.js

```js
// next.config.mjs
import { withCssDoctor } from "@zealakit/css-doctor-next";

export default withCssDoctor(
  {
    reactStrictMode: true,
  },
  {
    pageCoverage: {
      enabled: true,
      minPageRatio: 0.5,
      forceCommon: [".app-shell", ".nav-link"],
    },
    sizeBudget: {
      enabled: true,
      maxChunkSize: 40 * 1024,
      isolateVariables: true,
    },
    minify: true,
    report: true,
  },
);
```

### Adapter capabilities

| Adapter                 | Page coverage | Size budget | Variables isolation | Dead code |
| ----------------------- | ------------- | ----------- | ------------------- | --------- |
| Vite / Astro / TanStack | Yes           | Yes         | Yes                 | Yes       |
| Next.js                 | Yes           | Yes         | Yes                 | Yes       |
| Nuxt 4                  | Yes           | Yes         | Yes                 | Yes       |
| Rsbuild / Rspack        | Yes           | Yes         | Yes                 | Yes       |
| Remix 3 runtime         | No            | Yes         | Yes                 | No        |

Remix 3 has no build-time page-to-CSS dependency graph. Its middleware uses
`sizeBudget`, `isolateVariables`, `minify`, and a response cache instead of
runtime page coverage.

---

## Configuration reference

| Option                        | Type                   | Default                  | Description                                            |
| ----------------------------- | ---------------------- | ------------------------ | ------------------------------------------------------ |
| `pageCoverage.enabled`        | `boolean`              | `true`                   | Enable route-based coverage classification.            |
| `pageCoverage.minPageRatio`   | `number`               | `0.5`                    | Minimum page ratio (`0.0`–`1.0`) for common CSS.       |
| `pageCoverage.forceCommon`    | `string[]`             | `[]`                     | Selectors or classes forced into the common chunk.     |
| `sizeBudget.enabled`          | `boolean`              | `true`                   | Enable byte-budget splitting.                          |
| `sizeBudget.maxChunkSize`     | `number`               | `60 * 1024`              | Maximum bytes per emitted chunk.                       |
| `sizeBudget.isolateVariables` | `boolean`              | `true`                   | Extract `:root` and Tailwind `@theme` variables first. |
| `minify`                      | `boolean`              | production/build value   | Minify emitted CSS with LightningCSS.                  |
| `report`                      | `boolean`              | `true`                   | Print coverage and split diagnostics.                  |
| `exclude`                     | `(string \| RegExp)[]` | CSS Modules safety rules | Skip matching assets.                                  |

See the individual adapter README files for the complete option set.

---

## License

MIT. See [LICENSE](./LICENSE).
