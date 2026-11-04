# css-doctor agent guide

This file is the canonical project context for coding agents. Keep it short,
current, and operational. Detailed workflows live in `.agents/skills/`.

## What this repo is

`css-doctor` is a Rust + Node.js monorepo that analyzes CSS with
`lightningcss`, computes selector usage, splits CSS by page coverage, and
integrates with Vite and Next.js. Build/test orchestration is handled by
Turborepo.

| Path | Role |
| --- | --- |
| `crates/core` | Rust engine: parse, selector extraction, usage matrix, page-coverage splitter, CSS Health Score |
| `packages/binding` | NAPI-RS bridge exposing `analyzeCss`, `splitCssByPages`, `optimizeCss`, and JS types |
| `packages/cli` | `css-doctor` terminal CLI (`check`, `health`, `baseline`, `diff`, `optimize`, `split`, `fix`; Commander + tsup, ESM) |
| `packages/css-doctor-vite` | Vite/Rollup plugin (ESM + CJS + DTS) |
| `packages/css-doctor-next` | Next.js config wrapper + Webpack plugin (ESM + CJS + DTS) |
| `packages/css-doctor-rsbuild` | Rsbuild/Rspack plugin (ESM + DTS) |
| `packages/css-doctor-remix` | Remix 3 asset-server middleware (ESM + DTS) |
| `packages/css-doctor-nuxt` | Nuxt 4 module wrapping the Vite plugin (ESM + DTS) |
| `examples/vite-react-tailwind` | React 19 + Tailwind v4 SPA build-graph demo for Vite |
| `examples/next-app-tailwind` | Next 15 App Router + Tailwind v4 CSS Modules safety fixture |
| `examples/rsbuild-react-tailwind` | Rsbuild 2 + React 19 + Tailwind v4 fixture |
| `examples/astro-tailwind-sass` | Astro 5 multi-island + Tailwind v4 + SCSS stress fixture |
| `examples/remix-tailwind-sass` | Remix 3 asset-server + Tailwind v4 + Sass fixture |
| `examples/nuxt-tailwind-sass` | Nuxt 4 + Tailwind v4 + Sass + Vue scoped fixture |
| `examples/vite-react-3rd-ui` | Vite + React 3rd-party UI (Antd/MUI/Chakra) fixture |
| `monitor/` | Local Node/Rust dependency dashboard (`pnpm monitor`) |
| `turbo.json` | Turborepo task graph, input hashing, native addon outputs |
| `.agents/skills` | Vendor-neutral agent skills (canonical) |
| `.claude/skills` | Single Claude router skill pointing at the canonical workflows |

## Non-negotiable rules

1. Never edit generated artifacts:
   - `packages/binding/index.js`, `index.d.ts`, `index.d.cts`, `*.node`
   - `packages/*/dist/**`
   - `.next/**`, `target/**`, `coverage/**`
   Regenerate them with the documented commands.
2. Source code is TypeScript or Rust. Do not add hand-written `.js`/`.cjs`/`.mjs`
   project source. Generated NAPI loaders plus test/example JS configs (Next
   `next.config.mjs`, Webpack fixture entry files) are the only intentional
   exceptions.
3. Public API changes must be propagated through:
   `crates/core` → `packages/binding` → consumers (CLI/Vite/Next) → tests/docs.
4. Build the native binding before running TypeScript integration tests:
   `pnpm --filter @zealakit/css-doctor-binding build`.
5. NAPI-RS 2.x does not support `f32`. Use `f64` at the JS boundary and cast
   explicitly to/from `f32` in Rust.
6. Do not commit generated lockfile noise. `Cargo.lock` and `pnpm-lock.yaml`
   are source-of-truth and must stay committed.
7. Never weaken error boundaries. Integration plugins must never crash the
   user's Vite/Next/Webpack build because of CSS parse, split, callback, or
   reporter failures.
8. Use Turborepo for workspace-wide orchestration. Do not replace root
   `build`/`test`/`lint` with ad-hoc `pnpm -r` loops.
9. Edit skills only in `.agents/skills`. `.claude/skills/css-doctor` is a single
   router entrypoint; do not add duplicate workflow copies there.

## Fast task router

| If the task is… | Read first | Skill |
| --- | --- | --- |
| Rust parser, selector extraction, splitter, AST | `crates/core/src/analyzer.rs`, `model.rs`, `splitter.rs` | `css-doctor-core` |
| NAPI types/function, JS ↔ Rust mapping | `packages/binding/src/lib.rs`, `crates/core/src/` changed API | `css-doctor-binding` |
| CLI output/flags, Vite plugin, Next wrapper | package `src/` and tests | `css-doctor-integrations` |
| Full verification / release readiness | all package test commands | `css-doctor-verify` |

## Canonical commands

From the repo root:

```bash
pnpm install --frozen-lockfile

# Workspace graph (Turborepo)
pnpm build                  # turbo build, topological: binding -> consumers -> example
pnpm test                   # turbo test, depends on ^build
pnpm lint                   # turbo lint (Biome lint), parallel, no build dependency
pnpm format                 # turbo format (Biome format --write)
pnpm format:check           # turbo format:check (no writes)
pnpm check                  # turbo check (Biome lint + format)
pnpm dev                    # turbo dev (persistent, uncached)
pnpm monitor                # dependency dashboard at http://127.0.0.1:3000

# Rust
pnpm test:cargo             # cargo test --workspace
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings

# Binding-focused verification
pnpm --filter @zealakit/css-doctor-binding test

# Real Next.js App Router build
pnpm --filter @zealakit/css-doctor-next test:next

# Inspect task order/inputs without running
pnpm exec turbo build --dry=json
pnpm exec turbo build --dry-run

# Full local reset
pnpm clean
```

Native addon caching lives in `turbo.json` + `packages/binding/turbo.json`:
Rust sources, Cargo files, and `build.rs` are hashed, while `.node`,
`index.js`, `index.d.ts`, and `index.d.cts` are cached outputs.

Use `pnpm --filter <package> typecheck` or `build` for a focused loop. Do not
run `next build` or package builds in parallel with `cargo build` if the same
target directory is involved.

## Architecture invariants

### Core semantics

- Class matching is ASCII/Unicode case-insensitive.
- A selector is considered used by a page when **at least one positively
  required class** appears in that page's usage. Classes inside `:not()` are
  not required; `:is()` / `:where()` / `:any()` with a classless alternative
  contribute no required classes. This is intentionally conservative for dead
  code elimination.
- Selectors with no class (`:root`, `html`, `body`, `*`, element resets) are
  global and go to the common chunk.
- `force_common_selectors` accepts full selectors or class names (with/without
  a leading dot), case-insensitively.
- `coverage = used_pages / total_pages`; `>= min_page_ratio` → common,
  `0` → dead, otherwise page-specific.
- Page-specific selectors are duplicated into each page chunk that uses them.
- `dead_code_count` counts removed selector occurrences, not whole rules.
- `@font-face`, `@keyframes`, `@import` and other non-style at-rules go to
  common. Conditional at-rules (`@media`, `@supports`, `@layer`, `@container`,
  `@scope`, `@starting-style`, `@-moz-document`) are recursively split.
- Nested style rules are recursively split and keep parent-selector context.
  Classless nests under a page-specific parent ride along with that page.
- `total_occurrences` in the matrix means matched class-hit frequency across
  pages, not raw occurrences in the CSS file.
- The high-level pipeline runs tier 1 (page coverage + dead code) and then tier
  2 (size budget + variable isolation). Either tier can be disabled.
- Size splitting only cuts between top-level AST rules. `@media`, `@supports`,
  `@keyframes`, and other blocks stay intact; a single oversized rule is
  emitted alone and marked `oversized`.
- `minify` is a cross-cutting pipeline option (default `true`). Both page and
  size splitters pass it to LightningCSS `PrinterOptions`; JS callers can set
  `minify: false` to preserve readable output. The Vite plugin also sets
  `build.cssMinify: false` when `minify: false`, otherwise Vite would minify
  the emitted assets afterwards.
- CSS Health Score and regression comparison live in `crates/core/src/health`
  and `crates/core/src/regression`. Baselines are versioned JSON fingerprints
  (no CSS source). The CLI owns baseline persistence
  (`.css-doctor/baseline.json` + optional `.css-doctor/config.json`); framework
  adapters reuse the shared scoring engine and do not need to persist baselines.
- Optimization intelligence lives in `crates/core/src/optimization`: explanations
  and reports are derived from `optimize_css_pipeline` metadata; Safe autofixes
  use LightningCSS AST rewrites. Do not count split redistribution as byte
  savings. Never silently apply Review/Unsafe fixes.

### Integration semantics

- Vite: `generateBundle` → native `optimizeCss` pipeline → embed the common
  chunk when it fits, or emit `common-vars.css` / `common-part-*.css` and
  inject ordered stylesheet links. Page chunks are emitted as
  `page-*.css` / `page-*-part-*.css`.
- Vite entries with direct `import()` routes are treated as SPA shells: the
  entry's static classes/CSS become shared shell context, and each direct
  dynamic chunk becomes a page. Entries without direct dynamic imports remain
  single pages.
- Next: `thisCompilation` → `processAssets` at
  `PROCESS_ASSETS_STAGE_OPTIMIZE` → native `optimizeCss` → update the original
  global CSS asset and emit hashed `static/css/[name].[contenthash:8].css`
  chunks. CSS Modules (`*.module.css`) are skipped automatically; App/Pages
  Router route scanning and shared `_app`/layout context remain.
- Next common chunks that exceed the budget are wrapped by `@import` statements
  in the original CSS asset, so Next's existing HTML/manifest reference keeps
  working. Page-specific chunks are loaded lazily from the page JS chunk.
- Next only activates for `!context.dev && !context.isServer`. When
  `minify: false`, the plugin removes Next's CSS minimizer so output stays
  readable.
- Next route source scanning covers App Router `app/**/page` + layouts, Pages
  Router `pages/**` + `_app` (root and `src/`), relative imports, and `@/`
  aliases resolved against the project root and `src/`. Page coverage is
  skipped when no page classes are detected.
- Vite emits hashed assets via `emitFile({ name })` + `getFileName()`.
  Common chunks are linked from HTML; page CSS is loaded lazily by a small
  loader prepended to each page chunk, so a fresh page load requests only the
  current route's CSS. Visited page CSS remains cached in the DOM. `minify`
  defaults to the production build value.
- Next page CSS is loaded lazily from the page JS chunk; Next-specific CSS
  module assets are skipped and never rewritten.

### Known limitations

- CSS Modules (`styles.foo`) and helper-built class strings (`cn`/`clsx`) are
  not fully resolved by static source scanning. Literal Tailwind tokens in
  `class`/`className` strings are accepted. Use `pageUsage` or
  `forceCommonSelectors` for the rest.
- Next path aliases beyond `@/` need explicit `pageUsage`.
- A selector with multiple classes is matched conservatively by any class.
- `@keyframes` are always common; animation usage is not tracked per page.


## Naming & file layout

Default to **kebab-case** for every file and directory: lowercase words separated
by hyphens (`webpack-plugin.ts`, `css-doctor-vite`, `vite-react-tailwind`). React component
filenames are kebab-case too; component identifiers stay PascalCase in code.

Only these are exempt:

- Tool/framework-mandated files: `package.json`, `pnpm-lock.yaml`,
  `pnpm-workspace.yaml`, `Cargo.toml`, `Cargo.lock`, `tsconfig.json`,
  `turbo.json`, `biome.json`, `vite.config.*`, `tsup.config.*`,
  `tailwind.config.*`, `postcss.config.*`, `next.config.*`, `cssd.config.*`,
  `.gitignore`,
  `LICENSE`, `AGENTS.md`, `CLAUDE.md`, `SKILL.md`, `README.md`.
- Rust module files use **snake_case** (for example `lib.rs`, `splitter.rs`,
  `build.rs`) because Rust module names cannot contain hyphens. Do not rename
  Rust source files to kebab-case.
- Next.js route files keep their framework names: `page.tsx`, `layout.tsx`,
  `loading.tsx`, `error.tsx`, `not-found.tsx`, `route.ts`, `template.tsx`.
- Generated files keep their tool-defined names: `index.js`, `index.d.ts`,
  `index.d.cts`, `*.node`, `next-env.d.ts`.
- Dotfiles/dot-directories and numeric rule prefixes such as
  `.cursor/rules/00-project.mdc` are allowed.

When adding a file or folder outside these exceptions, rename it to kebab-case
and update imports/configs in the same change.

## TypeScript conventions

- ESM, `strict`, `noUncheckedIndexedAccess`, `moduleResolution: Bundler`.
- This is an FE-scoped project: define object shapes with `type`, **never**
  `interface`. Biome enforces `style/useConsistentTypeDefinitions` with
  `style: "type"`. Generated NAPI `*.d.ts` may contain interfaces; do not edit
  or convert generated declarations.
- Prefer explicit public type aliases and exported option/diagnostic types.
- Catch errors at boundaries; report through diagnostics/logger, not throws.
- Build with `tsup`; test TS with `tsx --test`.
- `pnpm lint` runs Biome (`biome lint`); `pnpm check` runs Biome lint + format
  check. Neither typechecks, so keep `tsc --noEmit` as the separate
  typecheck/test gate. `pnpm format` writes formatting changes.
- The root Biome config is framework-agnostic: no Next.js/React domains or
  framework-specific rule overrides. Add a nested `biome.json` with
  `"root": false` for app-specific domains/rules instead of changing the base.
- Never mutate user config destructively. Preserve original webpack callbacks,
  plugin arrays, and config fields.
- Generated `.d.ts` is part of the package contract. Check it after adding a
  NAPI export or changing a public TS type.

## Rust conventions

- Idiomatic Rust, no placeholder branches, no `unwrap` on user input.
- Prefer `BTreeMap`/`BTreeSet` where deterministic output matters.
- Keep serde models camelCase for JavaScript boundaries.
- Validate numeric config at the boundary; return descriptive `Err(String)`.
- Run format, clippy with `-D warnings`, and tests before declaring done.
- When adding core APIs, add core unit tests and binding mapping tests.

## Definition of done

- Relevant tests added/updated and passing.
- `cargo fmt`, `cargo clippy`, `pnpm test:cargo` pass for Rust changes.
- `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm check` pass for workspace changes.
- Native binding rebuilt when Rust public API changed.
- No generated artifacts or local tool state staged for commit.
- Known limitations documented instead of silently ignored.
- Update skills if architecture, commands, or invariants changed.

## Tool entrypoints

- **Cursor**: `.cursor/rules/*.mdc`
- **Claude Code**: `CLAUDE.md` + `.claude/skills/css-doctor` router
- **Antigravity**: `AGENTS.md` + `.agents/skills/*/SKILL.md` (open Agent Skills
  standard)
- **Codex**: `AGENTS.md` (nested `AGENTS.md` files are respected)
- **GitHub Copilot**: `.github/copilot-instructions.md`

## Skills

- `css-doctor-core` — Rust engine / AST / splitter work.
- `css-doctor-binding` — NAPI-RS surface and generated types.
- `css-doctor-integrations` — CLI, Vite, Next.js behavior.
- `css-doctor-verify` — full verification and release checklist.
