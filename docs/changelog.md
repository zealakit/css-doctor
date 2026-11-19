# Changelog

User-visible changes per release. The GUI has its own notes in
[`gui-changelog.md`](./gui-changelog.md).

## 1.2.0 (unreleased — previous published: 1.1.0)

All publishable packages are versioned together. This is a minor release: it
adds a CLI command (`coverage import`), a CLI subpath export and new options,
and is otherwise backward compatible (see "Breaking / behavior notes").

### Usage detection (fewer false "dead selector" results)

- **Class helpers.** Calls to `clsx`, `cn`, `cx`, `classnames`, `classNames`,
  `twMerge`, `twJoin`, `cva` and `tv` are resolved: string literals, static
  template parts and arrays are confirmed usage, object keys are possible
  usage, `cva`/`tv` base and every variant value count. Identifiers, calls and
  interpolated names are reported as *unknown evidence* per file and line.
  Configure with `classHelpers` (CLI config and every adapter).
- **CSS Modules.** Vite (via `css.modules.getJSON`, your hook still runs), Next
  (webpack) and Rsbuild now split CSS Modules by usage from the css-loader
  exports instead of skipping them; `styles.foo`, `styles["foo"]` and
  destructuring map to emitted classes and dynamic access keeps the whole
  module. Assets not fully covered by registered exports stay skipped.
  Opt out with `cssModules: false`. Rspack native CSS Modules are still skipped.
- **Path aliases (Next).** tsconfig/jsconfig `paths` (with `extends`),
  `baseUrl` and workspace `package.json` `exports` are resolved in place of the
  hard-coded `@/` handling. Unresolvable imports are skipped, never thrown.

### Confidence and runtime evidence

- Every selector match carries a confidence `level` (`low` / `medium` / `high`)
  and evidence `sources` (`static` / `runtime` / `config`); the GUI selector
  explorer shows both. `deriveUsageVerdict` (binding) exposes the Core rules.
- New `css-doctor coverage import` (Chrome DevTools, Puppeteer/Playwright and
  CDP coverage) stores merged runtime coverage in `.css-doctor/coverage.json`
  by route and build id; stale entries warn and are not applied. A Playwright
  helper ships as `@zealakit/css-doctor-cli/playwright`. Set `coverage` in
  `.css-doctor/config.json` to feed it into `css-doctor gui` verdicts.
- `pageCoverage.removeUnusedMinConfidence` (default `medium`, today's behavior)
  gates dead-code removal; `runtimeUsed` / `runtimeUnused` supply runtime
  evidence to the adapters explicitly.
- `pageCoverage.matching: "precise"` (default `"conservative"`) removes
  compound/descendant selectors on pages missing any strictly required class.
- The CLI reports compound selectors whose classes exist but never share an
  element (`classUsage.compoundNeverMatch`).

### Performance

- Size-budget splitting is linear in the number of rules (it re-printed the
  growing chunk after every rule). On a generated 300 KiB stylesheet: size split
  ~1.1 s → ~19 ms, full pipeline ~553 ms → ~23 ms. Output chunks are unchanged.
- The optimization report parses each chunk once instead of three times.
- New async native APIs — `optimizeCssAsync`, `evaluateCssHealthAsync`,
  `evaluateCssHealthBatchAsync`, `matchSelectorsAgainstMarkupAsync` — and the
  Vite, Next, Rsbuild and Remix integrations use `optimizeCssAsync`, so large
  stylesheets no longer block the event loop (including the Remix request path).
- `cargo bench -p css_doctor_core` benchmarks analyze, size split, pipeline and
  health on generated input.

### Other

- `pnpm snapshot:examples` compares the CSS emitted by seven examples with
  `examples/css-snapshots.json`.
- Vite examples now use `vite@^6.4.6` (a duplicate 6.4.5 install broke type-checks).
- Fixed two race conditions that made CLI GUI tests flaky.

### Breaking / behavior notes

- `@zealakit/css-doctor-cli` now has an `exports` map (`.`, `./playwright`,
  `./package.json`). Deep imports of `dist/*` from the package are no longer
  allowed; the `css-doctor` binary and the main entry are unchanged.
- With the new CSS Modules handling, Vite/Next/Rsbuild may now remove unused
  CSS Module classes that were previously left untouched. Dynamic access
  (`styles[x]`) and modules no scanned chunk imports are kept. Use
  `cssModules: false` to restore the old behavior.
- `classHelpers` scanning adds helper-literal classes to page usage; classes
  that were wrongly treated as dead before are now kept.
- Setting `classHelpers` is process-wide per build (`setActiveClassHelpers`);
  two builds with different lists in one process would race.

### Known limitations

See "Known limitations" in `AGENTS.md` and the root `README.md`.
