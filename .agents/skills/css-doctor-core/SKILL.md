---
name: css-doctor-core
description: Implements or debugs the Rust css-doctor engine (lightningcss AST parsing, selector extraction, usage matrix, page-coverage splitter, dead-code elimination). Use when changing crates/core, selector semantics, splitting behavior, or Rust unit tests.
---

# css-doctor core workflow

## When this skill applies

Use for any change under `crates/core/`:

- AST parsing or rule traversal
- selector/class extraction
- usage matrix and coverage calculation
- common/page chunk splitting
- dead-code elimination
- at-rule or nested-rule handling
- serialization models consumed by the NAPI bridge

## File naming

New files/directories default to kebab-case. Rust module files are the
exception: keep snake_case (`lib.rs`, `splitter.rs`, `build.rs`) so `mod`
resolution stays valid. Cargo manifests and lockfiles keep their required
names. Do not rename Rust sources to kebab-case.

## Read before editing

1. `AGENTS.md` for repo-wide guardrails.
2. `crates/core/src/splitter.rs` for splitting behavior.
3. `crates/core/src/analyzer.rs` for parsing and selector extraction.
4. `crates/core/src/model.rs` for public serde models.
5. `crates/core/src/usage.rs` for usage-frequency helpers.
6. `crates/core/src/lib.rs` for public exports.

Read the existing tests in each module before changing behavior. Keep public
API changes intentional and propagate them to `packages/binding`.

## Non-negotiable semantics

- Class matching is case-insensitive; normalize with lowercase for comparison.
- A selector is used by a page if **at least one positively required class** in
  it is present in that page's usage set. Classes inside `:not()` are not
  required. For `:is()` / `:where()` / `:any()`, a classless alternative makes
  the whole functional pseudo contribute no required classes (keeps
  `div:not(.hidden)` and `:is(.unused, div)` alive). This is conservative for
  dead-code removal.
- A selector with no class (`:root`, `html`, `body`, `*`, resets) is global and
  goes to the common chunk.
- Classless nested rules (`&:hover`, nested declarations, nested `@media` with
  no classes) under a page-specific parent ride along with that page fragment.
- `force_common_selectors` matches a full selector or a class name
  (case-insensitive, optional leading dot) and keeps it in common.
- `coverage = used_pages / total_pages`.
  - `0` pages → dead.
  - `>= min_page_ratio` → common.
  - otherwise page-specific, copied into each using page's chunk.
- `dead_code_count` counts dead selector occurrences, not whole rules.
- `total_occurrences` in `SelectorStat` is matched class-hit frequency across
  pages; selectors without classes use page count.
- At-rules:
  - `@font-face`, `@keyframes`, `@import`, non-style at-rules → common.
  - `@media`, `@supports`, `@layer`, `@container`, `@scope`,
    `@starting-style`, `@-moz-document`, legacy `@nest` → recursively split.
- Nested style rules are recursively split, keeping the parent selector context
  for page-specific fragments.
- AST output must be rendered with `to_css(PrinterOptions::default())`.
- Use `error_recovery: true` for parsing. Invalid config ratios must return a
  descriptive `Err(String)`; do not panic.

## Change workflow

1. Add or update a focused unit test first in the relevant module (`splitter.rs`
   or `analyzer.rs`).
2. Implement the smallest change consistent with existing data structures.
3. Check nested selectors, selector lists, global selectors, and at-rules.
4. Run:

   ```bash
   cargo fmt --all
   cargo test -p css_doctor_core
   cargo clippy -p css_doctor_core --all-targets --all-features -- -D warnings
   ```

5. If a public struct, field, function, or behavior exposed through
   `packages/binding` changed:
   - update the NAPI mapping in `packages/binding/src/lib.rs`;
   - rebuild the binding;
   - regenerate `packages/binding/index.d.ts`;
   - run binding tests and dependent TypeScript tests.

## Two-tier pipeline

`optimize_css_pipeline` composes:
1. `split_css_by_pages` (page coverage + dead code).
2. `split_css_by_size` (byte budget; optional variable isolation).

Size splitting must not cut inside a top-level at-rule. A single rule larger
than the budget is emitted as an oversized chunk. Variables include `:root`,
`:host`, `@property`, `@custom-media`, `@theme`, and `--*` declarations.
`minify` defaults to `true` and must be passed to every `PrinterOptions` used
for common, page, variable, and part serialization.

## Splitter test matrix

At minimum verify:

- 3 pages with 100% common, one-page specific, and unused selector.
- Selector list splitting: `.shared, .about-only, .dead { ... }`.
- Case-insensitive class usage.
- `force_common_selectors` on an unused class.
- Conditional at-rule splitting (e.g. `@media`).
- Nested CSS rules keep parent context.
- Empty/invalid page usage and invalid `min_page_ratio`.

Use `analyze_css` on rendered chunks to assert the exact selector contents
instead of brittle full-string comparisons.

## Common pitfalls

- Do not treat selectors without classes as dead; they are global.
- Do not count a whole rule as dead when only one selector in its list is dead.
- Do not lose duplicate class names across pages when building page chunks.
- Do not put `@font-face`/`@keyframes` into page chunks.
- Do not use nondeterministic `HashMap` iteration for stats or page output;
  sort pages and selectors.
- Do not add `unwrap()` on parse/render/user configuration paths.
- NAPI 2.x cannot map `f32`; expose `f64` at the JS boundary.

## Handoff

If core public API changed, tell the caller exactly:

- which core structs/functions changed;
- which binding types/functions must be updated;
- which TypeScript consumers need a rebuild;
- which tests were run and what remains.
