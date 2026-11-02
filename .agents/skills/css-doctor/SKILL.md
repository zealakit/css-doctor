---
name: css-doctor
description: Canonical operating guide for @zealakit/css-doctor. Use for the Rust/LightningCSS engine, NAPI-RS binding, Vite/Next/Rsbuild/Nuxt adapters, Remix 3 runtime middleware, examples, CSS splitting, variable isolation, and dead-code removal.
---

# css-doctor agent guide

`@zealakit/css-doctor` is a Rust-powered CSS optimization and splitting engine.
It parses CSS with LightningCSS, builds a selector/class usage matrix, removes
unused selectors, splits CSS by page coverage and byte budget, isolates CSS
variables, and optionally minifies the result.

The Node surface is provided by the NAPI-RS binding. Bundler adapters collect
page usage and run the engine at build time. Remix 3 uses a runtime asset
middleware because it has no equivalent build-time CSS bundle graph.

Read this file before making changes. Read the focused skill for the affected
layer:

- Rust engine: `.agents/skills/css-doctor-core/SKILL.md`
- NAPI binding: `.agents/skills/css-doctor-binding/SKILL.md`
- CLI / Vite / Next: `.agents/skills/css-doctor-integrations/SKILL.md`
- Release verification: `.agents/skills/css-doctor-verify/SKILL.md`

## Mental model

```text
CSS text
  -> LightningCSS AST
  -> selector/class extraction
  -> page usage matrix
  -> tier 1: page coverage + dead-code removal
  -> tier 2: size budget + variable isolation
  -> minification
  -> common chunks + page chunks
```

The compiler must be conservative. A selector is considered used by a page when
at least one class in the selector appears in that page's class set. Selectors
without classes are global and belong in the common chunk. Dead-code removal
must never break dynamic class names, CSS Modules, or framework-scoped styles.

## Two adapter families

### Bundler plugins (build-time static)

| Ecosystem | Package | Integration point |
| --- | --- | --- |
| Vite / Vue / Svelte / React / TanStack | `@zealakit/css-doctor-vite` | Rollup/Vite `generateBundle` |
| Astro | `@zealakit/css-doctor-vite` | Astro Vite integration + `astro:build:done` link injection |
| Nuxt 4 | `@zealakit/css-doctor-nuxt` | Nuxt `vite:extendConfig` client production hook |
| Next.js | `@zealakit/css-doctor-next` | Webpack `processAssets` |
| Rsbuild / Rspack | `@zealakit/css-doctor-rsbuild` | Rspack plugin/compiler hook |

These adapters support, where the host exposes the required graph:

- `pageCoverage`
- `sizeBudget`
- `isolateVariables`
- `minify`
- `report` / `onDiagnostics`

The Vite adapter treats direct `import()` entries as pages. It emits common
chunks and page chunks with content-hashed names. Common chunks are linked from
HTML where HTML exists. Page CSS is loaded by a small loader prepended to the
page JS chunk. Astro and Nuxt need host-specific link handling because their
HTML is produced after or outside the Vite HTML bundle.

### Runtime middleware (streaming/server-side)

| Ecosystem | Package | Integration point |
| --- | --- | --- |
| Remix 3 | `@zealakit/css-doctor-remix` | `withCssDoctorAssets(createAssetServer(...))` |

Remix 3 runs directly on Node and serves assets through `remix/assets`.
`withCssDoctorAssets` wraps the asset server's `fetch` and optimizes successful
`text/css` responses.

Supported in Remix runtime mode:

- `sizeBudget`
- `isolateVariables`
- `minify`
- LRU response cache
- CSS Modules / scoped-style safety

Do **not** enable runtime `pageCoverage` in Remix. There is no build dependency
graph or reliable page-to-asset association at request time. The middleware
must always fall back to the original response when parsing, splitting, or
native calls fail; never crash the Node server.

## Non-negotiable invariants

1. `crates/core` owns semantics. Adapters must not reimplement splitting.
2. Public API changes flow:
   `crates/core` -> `packages/binding` -> CLI/Vite/Next/Rsbuild/Nuxt/Remix -> tests/docs.
3. CSS Modules and framework-scoped CSS are safety boundaries:
   - `*.module.css`
   - `*.module.scss`
   - Vue `[data-v-*]` / `data-v-*`
   - Svelte `svelte-*`
   - Astro `data-astro-cid-*`
   Never rename or rewrite these selectors or class names.
4. Do not edit generated files: `packages/binding/index.js`, `index.d.ts`,
   `index.d.cts`, `*.node`, `packages/*/dist/**`, `.next/**`, `.astro/**`,
   `.nuxt/**`, `.output/**`, `target/**`, or lockfile noise unrelated to the
   change.
5. Never let an integration error crash a user build or runtime server.
   Catch at the adapter boundary, log a warning, and return the original CSS or
   response.
6. Keep peer dependency ranges broad unless the task explicitly requires a
   migration. Do not narrow `vite >=4`, `next >=13`, `@nuxt/kit >=3`,
   `@nuxt/schema >=3`, `nuxt >=3`, or `@rsbuild/core >=1`.
7. Never replace `workspace:*` or path dependencies with registry versions.
8. Examples are test fixtures. Do not modify them while doing package work
   unless the task explicitly targets that example.

## Workflow: add or change an adapter

1. Read this file and the focused integration skill.
2. Identify whether the host is a build-time bundler or a runtime server.
3. If build-time:
   - Collect the real page/class usage graph from the host.
   - Skip CSS Modules and framework-scoped CSS.
   - Call the native `optimizeCss` pipeline, not a hand-written splitter.
   - Define how common chunks and page chunks are delivered to the browser.
   - Preserve the host's existing HTML/manifest links.
4. If runtime:
   - Keep the host's asset server as source of truth.
   - Only process successful `text/css` `GET` responses.
   - Use `sizeBudget`, `isolateVariables`, `minify`, and an LRU cache.
   - Return a new `Response` with corrected `Content-Length`/`ETag`.
   - Fall back to the original response on every failure.
5. Add focused tests or a real example.
6. Build and run the example with production mode.
7. Document known limitations rather than hiding them.

## Workflow: add an example

Create `examples/<framework>-<style>` using kebab-case:

```text
examples/<framework>-<style>/
  package.json
  <framework config>
  src or app/
  styles/
  public/
```

Rules:

- `"@zealakit/css-doctor-<adapter>": "workspace:*"`.
- Add `format`, `format:check`, and `check` scripts when the example has
  TypeScript/JSON files.
- Keep Tailwind v4 directives in a pure `.css` file.
- Keep Sass/SCSS in separate `.scss` files.
- Use lazy routes for bundler page-coverage tests.
- Run the production build and preview; verify actual browser network requests,
  computed styles, dynamic chunks, CSS Module hashes, and scoped attributes.
- Never commit generated build output.

## Canonical commands

```bash
pnpm install --frozen-lockfile

pnpm build
pnpm test
pnpm lint
pnpm check
pnpm format
pnpm format:check

# Native binding before TS integration tests
pnpm --filter @zealakit/css-doctor-binding build

# Rust
cargo fmt --all -- --check
cargo test --workspace
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo check --workspace
```

For this macOS workspace, native builds may require:

```bash
PATH="$HOME/.cargo/bin:$PATH" \
CARGO_HOME=/tmp/css-doctor-cargo-home \
CARGO_TARGET_DIR=/tmp/css-doctor-target \
pnpm build
```

## Definition of done

- Source and public types are updated together.
- Binding generated outputs are regenerated, never hand-edited.
- `pnpm check`, `pnpm build`, and `pnpm test` pass.
- Rust changes pass `cargo test`, `cargo clippy -D warnings`, and `cargo fmt`.
- Real example builds/preview were exercised when the adapter has a fixture.
- No generated files or unrelated lockfile changes are included.
- Known limitations and migration risks are documented in the final response.
