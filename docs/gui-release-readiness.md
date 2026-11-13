# css-doctor-gui first public release — readiness

**Decision: Ready with limitations** (Web package + CLI integration).

Do **not** publish until explicitly approved. Do **not** bump versions in this
prep pass. Evidence below is from the current checkout (2026-11-13).

## Architecture audit

| Check | Result |
| --- | --- |
| GUI independent of adapters | Pass — no adapter deps |
| CLI discovers optional GUI | Pass — filesystem `node_modules` walk |
| Web without Tauri | Pass — `files` = `dist` + `dist-server` only |
| Desktop isolated | Pass — Tauri not in npm package; `--desktop` optional |
| Shared report contract | Pass — CLI JSON / `--save` discover |
| No second analysis pipeline | Pass — view path does not re-analyze; generate-check optional |
| `workspace:*` in published tarball | Pass — `pnpm pack` rewrites to `1.1.1` |
| React not required at runtime | Pass — moved to `devDependencies` (SPA prebundled) |

## Release checklist status

| Area | Status | Notes |
| --- | --- | --- |
| Package metadata | **Verified** | name `@zealakit/css-doctor-gui`, keywords, exports, engines, license, repo |
| Production build | **Verified** | `pnpm --filter @zealakit/css-doctor-gui build` → `dist/` + `dist-server/` |
| Package contents | **Verified** | `pnpm pack`: includes `dist/index.html`, excludes `src/`, `src-tauri` |
| Consumer installation | **Verified** | Out-of-repo temp project via packed tarballs (`scripts/verify-consumer-pack.mjs`) |
| CLI integration | **Verified** | `css-doctor gui` from consumer `npx`; missing-GUI install hint |
| Web runtime | **Verified** | health + production HTML + report discover on loopback |
| Desktop runtime | **Partially verified** | Unit/CLI error paths; full app packaging not claimed for v1 Web release |
| Report compatibility | **Verified** | CLI `--save` → discover; schema v1 fail-closed (Phase 7) |
| Security | **Verified** | Existing loopback/Host/Origin/traversal tests in GUI suite |
| Documentation | **Verified** | README, report-contract, changelog, this readiness doc |
| Tests | **Verified** | GUI + CLI suites; pack consumer script |

## Commands used

```bash
pnpm --filter @zealakit/css-doctor-gui build
pnpm --filter @zealakit/css-doctor-gui test
pnpm --filter @zealakit/css-doctor-cli test
node packages/css-doctor-gui/scripts/verify-consumer-pack.mjs
```

## Registry reality

| Package | Registry (approx.) | Workspace |
| --- | --- | --- |
| `@zealakit/css-doctor-binding` | `1.1.0` published | `1.1.1` |
| `@zealakit/css-doctor-cli` | `1.1.0` published | `1.1.1` |
| `@zealakit/css-doctor-vite` | `1.1.0` published | `1.1.1` |
| `@zealakit/css-doctor-gui` | **not published** | `1.1.1` |

First publish must ship a coherent set (at least binding + CLI + gui at matching
semver), or document that gui `1.1.1` requires CLI/binding `1.1.1`.

## Limitations (non-blocking for Web)

1. Desktop installers / multi-OS Tauri artifacts are **not** part of the npm
   Web package; document as optional/experimental until host-verified.
2. `@zealakit/css-doctor-gui` is unpublished; consumer proof used **packed tarballs**, not
   `npm install css-doctor-gui` from the public registry.
3. Optional generate-check still loads the native binding (same as CLI); viewing
   saved reports does not.

## Publish gate (blocked until approval)

- [ ] Explicit human approval to publish
- [ ] Intentional version bump change set (if required)
- [ ] Publish binding platform packages + binding + CLI (+ adapters as needed) + `@zealakit/css-doctor-gui`
- [ ] Post-publish smoke: clean machine `npm install -D @zealakit/css-doctor-cli css-doctor-gui`
