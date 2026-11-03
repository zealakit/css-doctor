<div align="center">

# @zealamic/css-doctor-binding

**Native NAPI-RS bridge for the css-doctor LightningCSS engine.** 

[English](https://github.com/zealamic/css-doctor/blob/main/packages/binding/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/packages/binding/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/packages/binding/README_CN.md)

</div>

---


> **DEPRECATED:** `@zealamic/css-doctor-binding` has moved to [`@zealakit/css-doctor-binding`](https://www.npmjs.com/package/@zealakit/css-doctor-binding).
>
> Install the replacement: `pnpm add -D @zealakit/css-doctor-binding`
>
> Active docs: https://github.com/zealakit/css-doctor
>
> The `@zealamic` packages remain on npm only because existing downloads prevent deletion. They are unmaintained.

![css doctor](https://github.com/zealamic/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Installation

```bash
pnpm add @zealamic/css-doctor-binding
```

## Usage

```ts
import { analyzeCss, optimizeCss } from "@zealamic/css-doctor-binding";

const analysis = analyzeCss(".card { color: red; }");

const result = optimizeCss({
  cssContent: ".card { color: red; } :root { --brand: red; }",
  pageUsage: { home: ["card"] },
  pageCoverage: { enabled: true, minPageRatio: 0.5 },
  sizeBudget: { enabled: true, maxChunkSize: 40 * 1024, isolateVariables: true },
  minify: true,
});

console.log(analysis.stats.selectorCount);
console.log(result.chunks);
```

## Safety and limitations

- Prebuilt binaries cover darwin-arm64, darwin-x64, linux-x64-gnu, linux-x64-musl, and win32-x64-msvc.
- The native API is low-level; prefer @zealamic/css-doctor-vite, next, rsbuild, nuxt, or remix for application builds.
- Never edit generated index.js, index.d.ts, index.d.cts, or *.node files by hand.

## Full documentation

Project README: [English](https://github.com/zealamic/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/README_CN.md)
