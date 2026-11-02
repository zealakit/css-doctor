---
name: css-doctor-verify
description: Verifies css-doctor after changes: runs Rust format/clippy/tests, rebuilds the NAPI binding, runs CLI/Vite/Next typechecks and tests, executes a real Next.js production build, and checks generated artifacts/git hygiene. Use before committing, opening a PR, or declaring a task complete.
---

# css-doctor verification workflow

## When this skill applies

Use after any non-trivial change, before handing off, committing, or opening a
PR. Also use when a build/test failure needs triage across the Rust, NAPI, and
TypeScript layers.

## Read first

1. `AGENTS.md`.
2. The diff / changed files.
3. The relevant skill (`css-doctor-core`, `css-doctor-binding`,
   `css-doctor-integrations`).

## Verification order

Run sequentially from the repo root. Do not parallelize native binding builds
with other Cargo builds that share `target/`.

### 1. Install / lockfile integrity

```bash
pnpm install --frozen-lockfile
```

A lockfile mismatch means dependencies changed without committing
`pnpm-lock.yaml`; fix it intentionally.

### 2. Rust

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features -- -D warnings
pnpm test:cargo
```

Expected: core tests (including splitter), binding mapping tests, doctests.

### 3. Native binding

```bash
pnpm --filter @zealakit/css-doctor-binding build
pnpm --filter @zealakit/css-doctor-binding test
```

Rebuild whenever core public API or binding source changed. Inspect the generated
`packages/binding/index.d.ts` when types changed.

### 4. TypeScript packages (Turborepo)

```bash
pnpm build
pnpm test
pnpm lint
pnpm format:check
pnpm check
```

The task graph is topological: binding → CLI/Vite/Next → Vite demo. `lint`
runs Biome lint and does not depend on build; `pnpm check` adds the Biome format
check. `tsc --noEmit` remains the separate typecheck gate. The root Biome config
is framework-agnostic; app-specific domains belong in a nested `biome.json` with
`"root": false`. For a focused loop:

```bash
pnpm --filter <pkg> typecheck
pnpm --filter <pkg> build
```

Inspect the graph before running:

```bash
pnpm exec turbo build --dry=json
pnpm exec turbo build --dry-run
```

### 5. Real Next.js build

```bash
pnpm --filter @zealakit/css-doctor-next test:next
```

This runs Next 14 App Router with `app/**/page`, layouts, global CSS, and the
plugin wrapper. Confirm:

- build exits `0`;
- common hashed CSS contains shared/layout classes;
- `static/css/page-index.css` and `page-about.css` exist;
- unused `.legacy-popup` is gone;
- reporter prints the usage matrix and dead-code warning.

### 6. Cache verification

```bash
pnpm build
pnpm build
```

Second run should report `FULL TURBO` with 5 cached tasks. A cache miss on the
binding task after a Rust change is expected; a cache hit after only a
TypeScript consumer change should not rebuild the native addon.

### 7. Manual Vite smoke (when touching Vite)

```bash
pnpm --filter @zealakit/css-doctor-vite test
```

The Vite test suite already runs a real multi-page Vite build. If you edit the
fixture or page-scanning logic, keep that integration test green.

## Naming check

TypeScript source must use `type` aliases, not `interface` (except generated
NAPI `*.d.ts`). Biome enforces this with `useConsistentTypeDefinitions`.

New files/directories must be kebab-case, except:
Rust module files (snake_case), Next route files, tool configs (`*.config.*`,
`tsconfig.json`, `package.json`, Cargo files), generated `index.js`/`index.d.ts`/
`*.node`, dotfiles, and `AGENTS.md`/`CLAUDE.md`/`SKILL.md`/`LICENSE`.
React component filenames are kebab-case; identifiers stay PascalCase.

## Additional checks

```bash
git status --short
git status --ignored --short | head
```

Confirm:

- No `node_modules`, `target`, `dist`, `.next`, `.node`, generated binding
  loader, coverage, or local agent state is staged.
- `Cargo.lock` and `pnpm-lock.yaml` are intentionally committed.
- `AGENTS.md`, skills, and rules are committed when updated.
- No secrets or `.env*` files.

## Failure triage

| Symptom | Likely cause |
| --- | --- |
| NAPI type error on `f32` | Use `f64` at JS boundary |
| TS cannot find binding types | Build binding; generated d.ts missing |
| Vite/Next test sees empty classes | page scanning/path alias issue; use `pageUsage` |
| Next page CSS empty | route source scan / entrypoint names changed; inspect `pages` diagnostics |
| `pnpm install --frozen-lockfile` fails | lockfile not updated |
| Clippy fails with `-D warnings` | fix warnings; do not relax the flag |
| Generated artifacts appear in diff | `.gitignore` regression; never commit them |
| Real Next build passes but page CSS missing from HTML | known limitation: manifests not linked yet |

## Definition of done

- Every command above relevant to the changed layer passes.
- The final response states exactly what was run and any limitations.
- Tests cover the new behavior, not just the happy path.
- Generated files regenerated locally but not staged.
