# Architecture matrix

## Adapter capabilities

| Ecosystem | Adapter package | Bundler / hook | pageCoverage | sizeBudget | isolateVariables | Delivery model |
| --- | --- | --- | --- | --- | --- | --- |
| Vite (Vue, Svelte, React, TanStack) | `@zealakit/css-doctor-vite` | Rollup/Vite `generateBundle` | Yes | Yes | Yes | Common HTML links (or `wrapCommonImports`); page JS CSS loader |
| Astro | `@zealakit/css-doctor-vite` + example `astro:build:done` hook | Astro Vite integration | Yes | Yes | Yes | Example injects page/common links into HTML after Vite emit |
| Nuxt 4 | `@zealakit/css-doctor-nuxt` | Nuxt `vite:extendConfig` (client production) | Yes | Yes | Yes | `wrapCommonImports` on entry CSS; page JS loaders |
| Next.js | `@zealakit/css-doctor-next` | Webpack `processAssets` | Yes | Yes | Yes | Original asset → common CSS or `@import` wrapper; page JS loader |
| Rsbuild / Rspack | `@zealakit/css-doctor-rsbuild` | Rspack plugin/compiler | Yes | Yes | Yes | Plugin emits/updates CSS assets + page JS loaders |
| Remix 3 | `@zealakit/css-doctor-remix` | Runtime `AssetServer.fetch` wrapper | No | Yes | Yes | Optimized single Response + LRU cache |

## Why Remix has no pageCoverage

Remix 3 serves assets directly through `createAssetServer`; there is no
build-time page-to-CSS graph and no reliable route association during an asset
request. Runtime page coverage would require a separate manifest and would be
unsafe with streaming requests.

Use only:

```ts
withCssDoctorAssets(assetServer, {
  sizeBudget: { enabled: true, maxChunkSize: 30 * 1024, isolateVariables: true },
  minify: process.env.NODE_ENV === "production",
  cache: { enabled: true, maxEntries: 100 },
});
```

## Build-time delivery details

### Vite

- `generateBundle` reads emitted CSS assets.
- `common` chunks are linked into HTML when an HTML asset exists.
- Page CSS is emitted as content-hashed assets and loaded by a loader prepended
  to each page JS chunk.
- `wrapCommonImports` is required when the host cannot inject Vite HTML links
  (Nuxt/Nitro); the original CSS asset becomes ordered `@import` statements.
- `skipVueScopedStyles` skips assets whose CSS contains Vue `[data-v-*]`
  selectors. CSS Modules are skipped by name and by hashed class shape.

### Next.js

- Production client only.
- Replaces the original global CSS asset with the common chunk when it fits the
  budget; when common is size-split, the original asset becomes ordered
  `@import` statements so Next's existing HTML/manifest link keeps working.
- Emits hashed `static/css/[name].[contenthash:8].css` for variables/parts/pages.
- Page CSS is loaded lazily from a loader prepended to the page JS chunk.
- Source scanning covers root `app/`/`pages/` and `src/app`/`src/pages`, plus
  `@/` aliases resolved against the project root and `src/`.
- Page coverage is skipped when no page classes are detected (empty usage).
- CSS Modules are never rewritten.

### Astro

- There is no dedicated Astro package; use `@zealakit/css-doctor-vite` and the
  example `astro:build:done` hook in `examples/astro-tailwind-sass`.
- Vite server build does not expose final HTML as an asset.
- Page and common CSS links are injected in `astro:build:done`.
- Page CSS must be linked; emitted-but-unreferenced chunks are not acceptable.

### Nuxt 4

- Module runs in production client build only.
- Never touches Nitro SSR graph.
- `wrapCommonImports: true` makes the entry CSS load `common-vars` and
  `common-part-*`.
- `skipVueScopedStyles: true` protects Vue scoped CSS.
- Page CSS loaders are prepended to page chunks; do not rely on prefetch to
  prove route isolation (NuxtLink prefetch can load CSS for other routes).

### Rsbuild / Rspack

- Uses the Rspack plugin/compiler lifecycle.
- Must preserve CSS Modules and scoped framework styles.
- Current dev compatibility stays on `@rsbuild/core` 1.x and
  `@rspack/core` 2.x. Rsbuild 2 is a separate major migration.

## Peer dependency policy

Keep these ranges broad:

```json
"vite": ">=4.0.0"
"next": ">=13.0.0"
"@rsbuild/core": ">=1.0.0"
"@nuxt/kit": ">=3.0.0"
"@nuxt/schema": ">=3.0.0"
"nuxt": ">=3.0.0"
```

They intentionally support older consumer majors. They already accept current
releases; do not narrow them just because a monitor reports a newer latest
version.

## Runtime safety boundaries

| Boundary | Required behavior |
| --- | --- |
| CSS Modules | Skip optimization/renaming |
| Vue scoped CSS | Preserve `[data-v-*]`; skip when configured |
| Svelte scoped CSS | Preserve `svelte-*` |
| Astro scoped CSS | Preserve `data-astro-cid-*` |
| Emotion / Antd CSS-in-JS | Do not rewrite runtime `<style>` tags |
| Remix asset errors | Return original `Response`, warn, never crash |
| Malformed CSS | Fall back to original CSS/response |

## Verification matrix

| Change | Minimum verification |
| --- | --- |
| Core AST/splitter | `cargo test -p css_doctor_core`, clippy, fmt |
| NAPI surface | build binding, package tests, generated `.d.ts` inspection |
| Vite adapter | `pnpm --filter @zealakit/css-doctor-vite test`, example build/preview |
| Next adapter | `pnpm --filter @zealakit/css-doctor-next test`, `test:next` |
| Nuxt module | module typecheck/build, Nuxt example build/preview |
| Remix middleware | package typecheck/build, mock asset-server test, preview |
| Rsbuild adapter | package typecheck/build, Rsbuild example build |
| Release | `pnpm build`, `pnpm test`, `pnpm check`, Rust checks |
