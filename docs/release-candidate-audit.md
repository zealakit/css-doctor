# css-doctor release candidate audit

**Date:** 2026-11-13  
**Branch:** `coding/v1.1.1`  
**Auditor role:** Independent release-candidate review (read-only of product code; this report is the only intentional documentation write).  
**Scope:** Phases 1–4 outcomes vs source, tests, packages, docs, and local verification evidence.

Evidence labels used below:

| Label | Meaning |
| --- | --- |
| **Verified** | Checked in this audit with reproducible evidence |
| **Not verified** | Insufficient evidence in this environment |
| **Failed** | Command or check executed and did not succeed |
| **Not applicable** | Does not apply to current design |

---

## A. Executive summary

**Repository status:** Functionally mature monorepo (Rust core + NAPI + CLI + five adapters + shared helpers) with substantial uncommitted Phase 1–4 work on disk. Local product gates largely pass when packages are built/tested in a stable order; one parallel-Turborepo flake and a failing real Next fixture build remain.

**Overall risk:** Medium. No verified P0 that corrupts CSS semantics or crashes host builds in the covered unit/integration suites. Release process risk is higher: dirty tree, intermittent `pnpm test` under parallel Turbo, `test:next` failure, and GitHub Actions not executed here.

**Release recommendation:** **CONDITIONAL GO**

Ship only after the conditions in §G are met. Do not treat prior agent phase reports as proof of completion without the evidence tables below.

---

## B. Phase completion matrix

| Phase | Status | Evidence | Remaining issues |
| --- | --- | --- | --- |
| Phase 1 — Correctness & Safety | **Mostly complete (Verified in source + tests)** | Commander `--no-*` mapping in `packages/cli/src/commands/optimize.ts` + CLI tests; `property_identity_key` via `property_id()` in `crates/core/src/property_key.rs` + fix unit tests; atomic writes in `packages/cli/src/utils/atomic-write.ts`; Vite `Boolean(config.build.lib)` + HTML inject tests | Uncommitted; CI green on GitHub **Not verified** |
| Phase 2 — Core & Adapter Reliability | **Mostly complete (Verified)** | Health empty-merge tests in `scoring.rs`; redistribution-aware bytes in `optimization/report.rs`; Rsbuild minify warning + docs; Remix fail-open; Next Turbopack explicit unsupported | Content-hash rewrite still a documented limitation; `test:next` **Failed** |
| Phase 3 — Architecture | **Mostly complete (Verified)** | `@zealakit/css-doctor-shared` exists; adapters (except Nuxt→Vite) depend on binding/shared only; CLI not a dep of adapters; core Cargo.toml has no Node/bundler deps | Nuxt→Vite is intentional coupling (exception to “adapters don’t depend on each other”); AGENTS.md overview still says “Vite and Next.js” only |
| Phase 4 — Testing/CI/Docs | **Partial (Verified mixed)** | Rsbuild/Nuxt/Remix tests present; CI YAML has push/PR; release checklist exists; root README known limitations | Parallel `pnpm test` flake **Failed** once then **Passed** on retry; GH Actions **Not run**; README_VI/CN limitations gap; CLI README intro contradicts optimize/fix write docs |

---

## C. Package audit matrix

| Package | Correctness | Tests | Build | Documentation | Known limitations |
| --- | --- | --- | --- | --- | --- |
| `crates/core` | Verified strong (97 + 2 doctests pass) | Verified | Verified (via cargo) | Via AGENTS | Conservative matching, `@keyframes` always common |
| `@zealakit/css-doctor-binding` | Verified smoke OK | Verified smoke | Verified | Present | Five published triples; CI host-only build in PR CI |
| `@zealakit/css-doctor-cli` | Verified key behaviors + 31 tests | Verified (31) | Verified | Partially inconsistent intro vs optimize/fix | Needs native binding |
| `@zealakit/css-doctor-shared` | Verified clamps/scan | Verified (6) | Verified | Minimal README | N/A bundler |
| `@zealakit/css-doctor-vite` | Verified plugin tests (17) | Verified | Verified | Options OK; missing content-hash/lib-SSR notes vs root README | CSS Modules / cn/clsx; content-hash |
| `@zealakit/css-doctor-next` | Webpack plugin tests Verified (9); full App Router build **Failed** | Partial | Package build Verified | Turbopack unsupported documented | Turbopack; aliases beyond `@/`; content-hash |
| `@zealakit/css-doctor-rsbuild` | Rspack integration Verified (5) | Verified | Verified | minify:false host caveat OK | Host CSS minify; production Rspack only |
| `@zealakit/css-doctor-remix` | Middleware + ETag Verified (4) | Verified | Verified | No pageCoverage / concat response documented | No page coverage / dead code |
| `@zealakit/css-doctor-nuxt` | Module hooks Verified (5) | Verified when Vite DTS stable | Verified | Defaults 30KiB documented | Dev/SSR skipped; wraps Vite |

### Architecture boundaries (Verified)

- Rust core dependencies: `cssparser`, `lightningcss`, `serde`, `serde_json` only — no Node/bundler.
- Binding has no reverse dep on CLI/adapters.
- Adapters do not depend on CLI.
- Vite / Next / Rsbuild / Remix do not depend on each other.
- Nuxt depends on Vite (wrapper module) — intentional exception.
- Shared has zero `@zealakit/*` runtime deps.
- Public exports: Nuxt also publishes `src/` via `files` + `development` export (implementation source in the tarball).

### Repository hygiene (Verified)

- `git status`: ~74 dirty/untracked paths (Phases 1–4 + monitor + docs). **Not a clean release tree.**
- No accidental secrets found by keyword scan (sample).
- Adapter `console.log` usage is diagnostics reporters (expected).
- Hand-written `test/*.mjs` / fixture `.js` exist (process tension with AGENTS “TS/Rust only” rule; fixtures are an allowed class, `.mjs` tests are an exception).

---

## D. Issue register

### RC-001 — Turbo parallel test race (Nuxt DTS vs Vite rebuild)

- **Priority:** P1  
- **Package:** `@zealakit/css-doctor-nuxt` / Turborepo `test` graph  
- **Description:** Under `pnpm test`, Nuxt’s `pnpm build` (DTS) failed with missing types for `@zealakit/css-doctor-vite` while Vite’s test script was also rebuilding/cleaning `dist/`. Sibling tasks were cancelled mid-run.  
- **Reproduction:** `pnpm test` immediately after a cold or concurrent Vite rebuild (observed once in this audit: `/tmp/audit-test.txt`).  
- **Evidence:** Error `TS7016: Could not find a declaration file for module '@zealakit/css-doctor-vite'`; Tasks `12 successful, 16 total`, Failed `@zealakit/css-doctor-nuxt#test`. Retry with Vite DTS present: Tasks `16 successful, 16 total`.  
- **Impact:** Flaky CI / false red on PR verify job.  
- **Recommended fix:** Make Nuxt test depend on Vite build outputs without concurrent clean, or stop cleaning Vite `dist` during its test build, or serialize Nuxt after Vite in turbo.  
- **Release blocker:** Yes (process) — until CI is shown green or flake removed.

### RC-002 — `test:next` real App Router build fails

- **Priority:** P1  
- **Package:** `@zealakit/css-doctor-next`  
- **Description:** Fixture `next build` fails typechecking `import './globals.css'` after deleting `next-env.d.ts`.  
- **Reproduction:** `pnpm --filter @zealakit/css-doctor-next test:next`  
- **Evidence:** stdout `Type error: Cannot find module or type declarations for side-effect import of './globals.css'`; assertion `1 !== 0` in `test/next-build.test.ts`. Webpack plugin unit/integration tests still pass (9/9).  
- **Impact:** End-to-end Next production verification required by verify skill is red; webpack-level confidence remains.  
- **Recommended fix:** Ensure CSS module ambient types in the fixture (stable `next-env.d.ts` / `css.d.ts`) without relying on a deleted generated file.  
- **Release blocker:** Yes for claiming full Next E2E readiness; No for webpack-plugin-only release notes if explicitly scoped.

### RC-003 — Large uncommitted Phase 1–4 tree

- **Priority:** P1  
- **Package:** repository  
- **Description:** Release cannot be cut from a known commit; ~74 modified/untracked paths.  
- **Evidence:** `git status --short` count.  
- **Impact:** Irreproducible release; review/changelog risk.  
- **Recommended fix:** Review, commit (or discard intentionally), then tag from clean HEAD.  
- **Release blocker:** Yes.

### RC-004 — GitHub Actions execution not verified

- **Priority:** P1  
- **Package:** `.github/workflows/ci.yml`  
- **Description:** Workflow config includes push/PR, Rust + Node + repair-esbuild + build/test/check. No Actions run was observed in this audit.  
- **Evidence:** Local file read only; no `gh run` / Actions URL.  
- **Impact:** Unknown CI environment failures (Linux binding, frozen lockfile, flake).  
- **Recommended fix:** Open PR or dispatch workflow; require green `CI / Verify`.  
- **Release blocker:** Yes (process).

### RC-005 — CLI README intro contradicts rewrite/optimize/fix docs

- **Priority:** P2  
- **Package:** `@zealakit/css-doctor-cli`  
- **Description:** Opening section says the CLI does **not** rewrite, minify, or split; later sections document `optimize`/`split`/`fix --write`.  
- **Evidence:** `packages/cli/README.md` lines ~20–22 vs §optimize/§fix.  
- **Impact:** User confusion; support burden.  
- **Recommended fix:** Narrow the intro to “diagnostics by default; optimize/fix are explicit opt-in”.  
- **Release blocker:** No.

### RC-006 — Vite package README omits content-hash / lib-SSR limitations

- **Priority:** P2  
- **Package:** `@zealakit/css-doctor-vite`  
- **Description:** Root README documents content-hash and related limits; Vite README “Safety and limitations” does not mention content-hash staleness or library/SSR skip.  
- **Evidence:** Compare `README.md` (root) vs `packages/css-doctor-vite/README.md`.  
- **Impact:** Adapter consumers may miss host-cache caveats.  
- **Recommended fix:** Mirror root known limitations in adapter README.  
- **Release blocker:** No.

### RC-007 — Localized READMEs lag English known-limitations

- **Priority:** P3  
- **Package:** root `README_VI.md` / `README_CN.md`  
- **Description:** English root gained a Known limitations section; VI/CN lack the matching section (spot-check).  
- **Evidence:** Search in VI for limitations section returned none.  
- **Impact:** Non-EN docs drift.  
- **Recommended fix:** Sync VI/CN.  
- **Release blocker:** No.

### RC-008 — AGENTS.md overview understates adapters

- **Priority:** P3  
- **Package:** docs  
- **Description:** Opening sentence still says integrates with Vite and Next.js while the table lists Nuxt/Remix/Rsbuild.  
- **Evidence:** `AGENTS.md` lines 8–10 vs package table.  
- **Impact:** Agent/contributor confusion only.  
- **Recommended fix:** Update one-liner.  
- **Release blocker:** No.

### RC-009 — Nuxt publishes TypeScript `src/` in npm `files`

- **Priority:** P3  
- **Package:** `@zealakit/css-doctor-nuxt`  
- **Description:** `files` includes `src` for `development` export.  
- **Evidence:** `package.json` `files` + `exports.development`.  
- **Impact:** Extra surface area; not a functional bug.  
- **Recommended fix:** Confirm intentional for Nuxt module DX; document.  
- **Release blocker:** No.

### RC-010 — Content-hash integrity after in-place CSS rewrite

- **Priority:** P2 (accepted limitation)  
- **Package:** Vite / Next / Rsbuild  
- **Description:** Host hashed CSS filenames may not match rewritten bytes.  
- **Evidence:** Documented in root README / AGENTS; no rehash implementation.  
- **Impact:** Long-cache CDN mismatch risk.  
- **Recommended fix:** Keep documented; optional future rehash or short TTL guidance in release notes.  
- **Release blocker:** No (if release notes state the limitation).

### Phase 1/2 bug remediations (spot-check)

| Historical bug | Fixed in source? | Regression test? | Tests run this audit? | Residual risk |
| --- | --- | --- | --- | --- |
| Commander `--no-*` ignored | Yes — `isNegatedOption` / `pageCoverage` mapping | Yes — CLI optimize/split tests | Yes (31 CLI) | Low |
| Autofix `Unparsed` property identity | Yes — `property_key.rs` | Yes — core fix tests | Yes (`pnpm test:cargo`) | Low |
| Fix write when unchanged | Yes — `fix.ts` writes only if `changed` | Partial (dry-run/changed assertions) | Yes | Low |
| Baseline partial write | Yes — atomic write + fail paths | CLI baseline round-trip | Yes | Medium (backup/restore edge cases not exhaustively fuzzed) |
| Optimization byte accounting | Yes — `redistributed_bytes` | Core report tests | Yes | Low |
| Vite missing `</head>` | Yes — inject fallbacks | Vite tests | Yes (17) | Low |
| Vite lib/`false` skip | Yes — `Boolean(config.build.lib)` | Vite library test | Yes | Low |
| Rsbuild `minify: false` | Warning + LightningCSS flag | Rsbuild test | Yes (5) | Host minify still active (documented) |
| Empty health merge = A/100 | Yes — `merge_empty_reports_is_not_perfect` | Core health tests | Yes | Low |

No verified remaining **P0** CSS-corruption bugs in the covered suites.

---

## E. Verification results

Commands executed during this audit (local macOS arm64 / Node 26). **GitHub Actions: Not run.**

| Command | Result | Notes |
| --- | --- | --- |
| `git status --short` | Verified dirty (~74) | Uncommitted Phase work |
| `cargo fmt --all -- --check` | **Passed** | |
| `cargo clippy --all-targets --all-features -- -D warnings` | **Passed** | |
| `pnpm test:cargo` | **Passed** | 97 lib + 2 doctests |
| `pnpm build` | **Passed** | 8/8 package tasks |
| `pnpm typecheck` | **Passed** | 11/11 |
| `pnpm test` (1st) | **Failed** | Nuxt DTS race; CLI/Rsbuild cancelled |
| `pnpm test` (2nd) | **Passed** | 16/16 after Vite DTS present |
| Per-package Nuxt/Rsbuild/CLI/Vite/Next/Remix/Shared tests | **Passed** when isolated | Counts: 5 / 5 / 31 / 17 / 9 / 4 / 6 |
| `pnpm --filter @zealakit/css-doctor-binding test` | **Passed** | Smoke |
| `pnpm check` | **Passed** | 17/17; Next non-null warnings only |
| `pnpm --filter @zealakit/css-doctor-next test:next` | **Failed** | `globals.css` types |
| GitHub Actions `CI` workflow | **Not run** | Config present with push/PR |
| Multi-platform NAPI matrix (prepare-release) | **Not run** | workflow_dispatch only; never publish |
| Outside-workspace full binding+CLI consumer | **Not verified** this pass | Phase 4 had partial pack smoke; not re-proven end-to-end here |
| Security vuln scan (`pnpm audit` / cargo audit) | **Not run** | |

### Adapter capability honesty (from source + docs)

| Adapter | Page coverage | Size budget | Variables | Dead code | Notes |
| --- | --- | --- | --- | --- | --- |
| Vite | Supported | Supported | Supported | Supported | Lib/SSR skipped; HTML fallbacks tested |
| Next | Supported (webpack prod client) | Supported | Supported | Supported | Turbopack unsupported; E2E fixture **Failed** |
| Rsbuild | Supported | Supported | Supported | Supported | Production Rspack; host minify caveat |
| Remix | Unsupported | Supported (concat response) | Supported | Unsupported | Runtime middleware |
| Nuxt | Via Vite plugin | Via Vite (default 30KiB) | Via Vite | Via Vite | Prod client only |

---

## F. Release recommendation

### **CONDITIONAL GO**

No verified **P0** product defect that destroys CSS correctness in the local unit/integration corpus. However, release is **not** unconditionally safe because:

1. The working tree is not a releasable commit (RC-003).  
2. `pnpm test` is not reliably green under Turbo parallelism (RC-001).  
3. Next real-build verification is red (RC-002).  
4. GitHub Actions success is unproven (RC-004).

Choose **GO** only after §G conditions are satisfied. Choose **NO-GO** if maintainers require flawless Turbo `pnpm test` and `test:next` before any tag.

---

## G. Next actions (required before release)

1. **Commit or otherwise stabilize** the Phase 1–4 tree; release only from a clean, reviewed commit.  
2. **Eliminate or gate** the Nuxt↔Vite DTS race so `pnpm test` is deterministic (CI uses the same Turbo graph).  
3. **Fix `test:next`** fixture CSS typing (or temporarily demote it from release-critical with explicit release-note acceptance).  
4. **Run GitHub Actions** on the release candidate branch and keep the Verify job green.  
5. **Correct CLI README intro** so it does not deny optimize/fix write behavior.  
6. **State in release notes:** content-hash limitation, Turbopack unsupported, Remix no page coverage, Rsbuild host minify caveat, platforms actually built for the binding.  
7. **Do not publish** until versions/changelog are intentional (packages currently `1.1.0` on branch `coding/v1.1.1` — reconcile naming).

Optional (non-blocking): sync VI/CN known limitations; expand Vite README limitations; confirm Nuxt `src` publish intentional.

---

## Appendix — independence notes

- Prior agent phase summaries were treated as hypotheses only.  
- Pass/fail above is from commands run in this audit session.  
- “Passed once after flake” is recorded honestly; intermittent failure is still an issue.  
- This document does not mark `docs/release-checklist.md` items complete.
