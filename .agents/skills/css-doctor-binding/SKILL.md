---
name: css-doctor-binding
description: Extends or fixes the NAPI-RS bridge in packages/binding, including JS object types, Rust-to-JavaScript mapping, splitCssByPages, generated index.d.ts, and native rebuilds. Use when exposing new core APIs to Node.js or debugging binding type/runtime mismatches.
---

# css-doctor NAPI bridge workflow

## When this skill applies

Use for changes in `packages/binding/` or when a core API must be exposed to
JavaScript:

- adding/changing `#[napi(object)]` or `#[napi(string_enum)]` types
- exposing a new Rust function
- converting core structs to JavaScript-friendly shapes
- fixing TypeScript declaration/runtime mismatches
- rebuilding the `.node` binary after core changes

## Read before editing

1. `AGENTS.md`.
2. `packages/binding/src/lib.rs`.
3. The changed core types/functions under `crates/core/src/`.
4. `packages/binding/test.ts`.
5. Generated `packages/binding/index.d.ts` (read only).

## File naming

New source files/directories default to kebab-case. Generated package files
keep tool-defined names: `index.js`, `index.d.ts`, `index.d.cts`, `*.node`.
`Cargo.toml` and `build.rs` keep their required names. Never rename generated
artifacts to satisfy a naming convention.

TypeScript source uses `type` aliases, never `interface`. The generated NAPI
`index.d.ts` is an exception: it contains tool-generated interfaces and must
not be edited.

## Rules

- NAPI 2.x does not support `f32`; use `f64` at the JS boundary and cast
  explicitly to/from `f32`.
- JS collections should be `Record<string, string[]>` / `Vec<String>`, not
  `HashSet` at the boundary. Convert to `HashSet` in Rust.
- All indexes/counters exposed to JS use `u32` with saturating conversion via
  the existing `to_u32` helper.
- JS object fields are camelCase automatically; do not add redundant
  `#[napi(js_name)]` unless the public name must differ.
- Preserve the Rust `Result<..., napi::Error>` boundary. Map failures with
  `napi::Error::from_reason`, never `unwrap`.
- Do not edit generated `index.js`, `index.d.ts`, `index.d.cts`, or `*.node`.
- Keep the NAPI object model close to the core model; document deliberate
  differences (for example f64 ratios, arrays instead of sets).

## Pipeline API

`optimize_css` maps `JsPipelineInput` to the core two-tier pipeline and returns
`JsPipelineOutput` with `JsChunkOutput[]`. Use optional nested
`pageCoverage` / `sizeBudget` objects; omitted fields use core defaults.
`minify` is optional at both `JsPipelineInput` and `JsChunkConfig` and defaults
to `true`. `maxChunkSize` maps to `u32`, chunk byte sizes map back with
`to_u32`.

## Workflow

1. Make the core change and run core tests first.
2. Add/update JS object types in `packages/binding/src/lib.rs`.
3. Add the `#[napi]` function or mapping impl.
4. Add a mapping test in the Rust `#[cfg(test)]` module.
5. Add a smoke assertion in `packages/binding/test.ts`.
6. Rebuild the release binary and regenerate declarations:

   ```bash
   pnpm --filter @zealakit/css-doctor-binding build
   pnpm --filter @zealakit/css-doctor-binding test
   ```

7. Inspect `index.d.ts` for the expected exported names and property types.
8. Re-run TypeScript consumers that import the binding:

   ```bash
   pnpm --filter @zealakit/css-doctor-cli typecheck
   pnpm --filter @zealakit/css-doctor-vite test
   pnpm --filter @zealakit/css-doctor-next test
   ```

## Type mapping reference

| Rust/core | JS boundary |
| --- | --- |
| `f32` ratio | `f64` |
| `usize` counter/index | `u32` + saturating helper |
| `HashSet<String>` page usage | `Vec<String>` inside `HashMap` |
| `HashMap<String, String>` chunks | `Record<string, string>` |
| `Option<T>` | optional TS field / omitted when `None` |
| selector kind enum | `#[napi(string_enum = "snake_case")]` |
| serde model | camelCase JSON-compatible fields |

## Verification checklist

- `cargo test` and `cargo clippy` pass.
- NAPI build succeeds and emits a `.node` for the host platform.
- Generated `index.d.ts` contains the new function/types.
- Node smoke test exercises success and error paths.
- At least one downstream package typechecks against the regenerated d.ts.
- No generated files staged for commit.

## Common pitfalls

- Using `f32` in a `#[napi(object)]` field: compile error or invalid JS mapping.
- Returning a `HashSet`: NAPI does not map it; convert to `Vec`.
- Assuming `index.d.ts` updates without a rebuild.
- Editing generated JS loader to “fix” an import; fix the source/build instead.
- Forgetting that `split_css_by_pages` f64 input must cast to core f32.
- Changing a field name in Rust and forgetting that camelCase changes the JS
  property name.
