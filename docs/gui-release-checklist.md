# css-doctor-gui release checklist

Do not mark an item complete without command evidence from the current checkout.

## Workspace

- [ ] `pnpm --filter @zealakit/css-doctor-gui typecheck`
- [ ] `pnpm --filter @zealakit/css-doctor-gui check`
- [ ] `pnpm --filter @zealakit/css-doctor-gui test`
- [ ] `pnpm --filter @zealakit/css-doctor-cli test`
- [ ] Related Core/binding/adapters not regressed for this change set

## Web production

- [ ] `pnpm --filter @zealakit/css-doctor-gui build` produces `dist/` + `dist-server/`
- [ ] `css-doctor gui --no-open` prints a `127.0.0.1` URL
- [ ] Port fallback works when preferred port is busy
- [ ] `--strict-port` fails instead of falling back
- [ ] Load check/optimize/split/diff JSON in the UI
- [ ] Refresh / reload / failed load keep session semantics
- [ ] Ctrl+C shuts down cleanly

## Desktop

- [ ] Tauri CLI + Rust toolchain available on the build host
- [ ] `pnpm --filter @zealakit/css-doctor-gui desktop:build` succeeds on that host
- [ ] App launches and shows the SPA
- [ ] Node sidecar starts and `/api/health` responds
- [ ] Closing the app stops the sidecar (no orphan `node` process)
- [ ] `css-doctor gui --desktop` fails clearly when app missing (no Web fallback)
- [ ] Windows / Linux artifacts only claimed after builds on those hosts

## Security

- [ ] Non-loopback Host rejected
- [ ] Non-loopback Origin on POST rejected
- [ ] Path traversal on static assets rejected
- [ ] Oversized upload rejected
- [ ] Logs do not print report bodies

## Documentation / distribution

- [ ] `packages/css-doctor-gui/README.md` matches verified capabilities
- [ ] Root README GUI section matches Web/Desktop status
- [ ] CLI treats `@zealakit/css-doctor-gui` as optional peer (lazy resolve from project)
- [ ] Consumer-style install layout can launch `css-doctor gui` (node_modules link or published tarball)
- [ ] `node packages/css-doctor-gui/scripts/verify-consumer-pack.mjs` passes (packed tarballs outside monorepo)
- [ ] Packed `package.json` has no `workspace:` protocol and no unnecessary React runtime deps
- [ ] No version bump / publish performed accidentally
- [ ] Readiness doc + changelog reviewed (`docs/gui-release-readiness.md`, `docs/gui-changelog.md`)

## Status key for release notes

- **Verified** — exercised on this host with passing commands
- **Partially verified** — implemented + unit-tested; full packaging not run
- **Not verified** — config present only
- **Blocked** — missing toolchain/platform/access
