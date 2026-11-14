# Release checklist

Use this before tagging or publishing a css-doctor release. Do not mark items
complete without command evidence from the current checkout.

## Code

- [ ] No known P0 issues
- [ ] P1 issues resolved or explicitly accepted
- [ ] `git status` reviewed; no unexpected uncommitted changes
- [ ] No accidental debug logging left in adapters/CLI
- [ ] No new unsafe TODO/FIXME that blocks the release

## Tests

- [ ] `pnpm test:cargo` passes
- [ ] Package typechecks pass (`pnpm -r --filter "./packages/**" typecheck`)
- [ ] CLI tests pass (`pnpm --filter @zealakit/css-doctor-cli test`)
- [ ] Adapter tests pass (Vite, Next, Rsbuild, Remix, Nuxt)
- [ ] Binding smoke tests pass
- [ ] Regression cases for prior P0/P1 fixes still pass

## Build

- [ ] `pnpm build` (Turborepo full graph) passes
- [ ] Native binding artifacts present for the CI/host platform
- [ ] Package `exports` / `files` / `bin` inspected for publishable packages
- [ ] Temporary consumer install from packed tarballs verified
- [ ] Pack contents exclude tests, secrets, and local tool state
- [ ] `@zealakit/css-doctor-shared` builds in-repo and is **bundled** into CLI /
      Vite / Next / Rsbuild (`dist` has no unresolved `@zealakit/css-doctor-shared` import)

## Documentation

- [ ] Root `README.md` matches shipped adapters and CLI commands
- [ ] CLI command docs match Commander options
- [ ] Adapter READMEs state supported / partial / unsupported clearly
- [ ] Config examples match runtime validation
- [ ] Known limitations documented (CSS Modules, content-hash rewrite, host minify)
- [ ] Publishing docs state that `css-doctor-shared` is internal-only

## Release

- [ ] Workspace package versions reviewed for consistency (no silent mismatch)
- [ ] Changelog / release notes drafted when shipping user-visible changes
- [ ] Breaking changes listed explicitly
- [ ] Publishable tarballs inspected (`pnpm pack` per package)
- [ ] `pnpm publish:npm:validate` passes (packed manifests: no `workspace:*`, no
      `@zealakit/css-doctor-shared` runtime dependency; shared is not a publish target)
- [ ] No accidental publish from CI PR workflows
- [ ] Version bump is intentional and performed in a dedicated release change
- [ ] `@zealakit/css-doctor-shared` is **not** published independently

## Platform notes

- Native binding CI verifies the Ubuntu host used by GitHub Actions.
- Additional NAPI targets require an explicit multi-platform build matrix before
  claiming support in release notes.

## GUI (when shipping @zealakit/css-doctor-gui)

- [ ] Follow [`docs/gui-release-checklist.md`](./gui-release-checklist.md)
- [ ] Readiness decision recorded in [`docs/gui-release-readiness.md`](./gui-release-readiness.md)
- [ ] Changelog drafted in [`docs/gui-changelog.md`](./gui-changelog.md)
- [ ] `node packages/css-doctor-gui/scripts/verify-consumer-pack.mjs` passes
- [ ] Web production path verified on at least one host
- [ ] Desktop claims limited to platforms actually packaged
- [ ] Report contract docs match CLI `--save` / GUI discover behavior
  ([`docs/report-contract.md`](./report-contract.md))
