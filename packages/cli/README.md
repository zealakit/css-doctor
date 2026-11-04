<div align="center">

# @zealakit/css-doctor-cli

**Command-line diagnostics for CSS files using the native css-doctor engine.**

[English](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## What it does

`css-doctor check` reads one or more CSS files, parses them with the native
LightningCSS engine, and prints a terminal report (or JSON for CI).

It is a **diagnostics** tool. It does **not** rewrite files, minify CSS, or
split stylesheets by page. Use the Vite / Next / Nuxt / Rsbuild / Remix adapters
for build-time optimization.

The CLI reports:

| Kind | Meaning |
| --- | --- |
| `syntax` | Parser / syntax warnings from LightningCSS |
| `empty-rule` | Rules with no declarations and no nested rules (dead-code candidates) |
| `duplicate-selector` | The same selector text appears in more than one rule |
| `threshold` | Selector count in a file exceeds `--threshold` |

## Requirements

- Node.js **≥ 18**
- A supported `@zealakit/css-doctor-binding` native binary (downloaded with the
  package on macOS / Linux / Windows x64 targets)

## Installation

### One-off run (no install)

```bash
npx @zealakit/css-doctor-cli check "src/**/*.css"
```

### Project dependency

```bash
pnpm add -D @zealakit/css-doctor-cli

# or
npm install -D @zealakit/css-doctor-cli
yarn add -D @zealakit/css-doctor-cli
```

After install, the `css-doctor` binary is available via:

```bash
pnpm exec css-doctor --help
# npm
npx css-doctor --help
```

### package.json script

```json
{
  "scripts": {
    "css:check": "css-doctor check \"src/**/*.css\"",
    "css:check:ci": "css-doctor check \"src/**/*.css\" --json --threshold 500"
  }
}
```

```bash
pnpm css:check
```

## Quick start

```bash
# Help / version
css-doctor --help
css-doctor --version
css-doctor check --help
css-doctor health --help

# Single file
css-doctor check src/styles/app.css

# Multiple files
css-doctor check src/a.css src/b.css

# Glob — quote the pattern so the shell does not expand it first
css-doctor check "src/**/*.css"

# Mix paths and globs
css-doctor check styles/global.css "components/**/*.css"

# CSS Health Score (polished report)
css-doctor health "src/**/*.css"
css-doctor health "src/**/*.css" --json
css-doctor health "src/**/*.css" --fail-under 80
css-doctor check "src/**/*.css" --fail-under 85

# Baseline + regression
css-doctor baseline create "src/**/*.css"
css-doctor baseline show
css-doctor diff "src/**/*.css" --fail-on-regression

# Optimization intelligence
css-doctor optimize "src/**/*.css" --dry-run --explain --json
css-doctor split "src/**/*.css" --dry-run
css-doctor fix --list
css-doctor fix "src/**/*.css" --dry-run --rule dead.empty-rule
```

## Command: `check`

```text
css-doctor check [patterns...] [options]
```

| Argument / option | Description |
| --- | --- |
| `patterns...` | One or more CSS file paths or glob patterns. **Required.** |
| `-j, --json` | Print a structured `CheckReport` JSON document to stdout |
| `--threshold <n>` | Warn when a file has more than `<n>` selectors (`n` ≥ 0 integer) |
| `--fail-under <n>` | Exit `1` when overall Health Score is below `<n>` (0–100) |
| `-v, --version` | Print CLI version (global flag) |
| `-h, --help` | Print help |

### Glob tips

- Quote globs: `"src/**/*.css"`. Unquoted `*` may be expanded by your shell
  before css-doctor sees the pattern.
- `node_modules` and `.git` are ignored automatically.
- Literal paths that contain glob characters (for example `src/[slug].css`)
  still work when passed as an existing file path.

### Example terminal output

```text
css-doctor v1.0.0 · check
patterns src/**/*.css
────────────────────────────────────────────────────────────────
 SUCCESS  src/styles/app.css · 12.4 KB
  selectors 184 · rules 132 · declarations 421
  analysis 3.2 ms · read 0.8 ms · total 4.0 ms
  Top selectors
    #app .card:hover
    .nav-link.is-active
    …

 WARNING  src/legacy.css · 48.1 KB
  selectors 612 · rules 540 · declarations 1 204
  Diagnostics
    • empty-rule — Rule ".unused" has no declarations…
    • duplicate-selector — Selector ".btn" is defined in multiple rules…
────────────────────────────────────────────────────────────────
 files 2 · analyzed 2 · issues 2 · …
```

Status badges:

| Status | When |
| --- | --- |
| `SUCCESS` | File analyzed; no issues |
| `WARNING` | File analyzed; has syntax / empty-rule / duplicate / threshold issues |
| `ERROR` | File could not be read or analyzed, or setup failed |

## CI and JSON output

```bash
css-doctor check "src/**/*.css" --json
css-doctor check "src/**/*.css" -j --threshold 500
```

`--json` prints a stable `CheckReport` (`schemaVersion: 1`) with:

- `success` — `true` only when setup succeeded and every matched file was analyzed
- `errors` — fatal setup messages (no patterns, no matches, binding load failure, …)
- `files[]` — per-file path, size, timings, `issues`, and native `result` when `ok`
- `summary` — aggregated counters (files, selectors, warnings, timings, …)

Pipe or save the report:

```bash
css-doctor check "src/**/*.css" --json > css-doctor-report.json
```

### Exit codes (`check`)

| Code | Meaning |
| --- | --- |
| `0` | Setup OK and every matched file was read + analyzed (warnings still allowed) |
| `1` | Fatal setup error, no matches, unloadable native binding, a file failed to read/analyze, or `--fail-under` failed |

Warnings and hints **do not** fail the process unless you also set
`--fail-under`. Use `--json` and inspect `summary.issues` / `files[].issues`
if you want CI gates on warnings.

`check --json` also includes an aggregated `health` field (CSS Health Score).

## Command: `health`

```text
css-doctor health [patterns...] [options]
```

Evaluates a deterministic **CSS Health Score** (0–100) across five dimensions:

| Dimension | Weight | Measures |
| --- | ---: | --- |
| Selector Complexity | 20% | High specificity, deep combinators/nesting, long chains |
| Duplicate Rules | 20% | Repeated selectors / intra-rule duplicate declarations |
| CSS Size Efficiency | 20% | Large sheets, heavy rules, selector pressure |
| Dead CSS | 25% | Empty rules, recoverable syntax drops |
| Variable Consistency | 15% | Duplicate/`var()` usage gaps, naming mix (heuristic) |

Grades: **A** 90–100 · **B** 80–89 · **C** 70–79 · **D** 60–69 · **F** 0–59.

| Option | Description |
| --- | --- |
| `-j, --json` | Stable health JSON (`schemaVersion: 1`) |
| `--threshold <n>` | Maps to native `manySelectors` size pressure |
| `--fail-under <n>` | Exit `1` when overall score `< n` (CI gate) |

The score is **not** a guarantee of visual correctness. Unused-variable and
cross-file/`var()` findings are marked `heuristic` when static evidence is
incomplete. Page-usage dead CSS still requires adapters / `pageUsage`.

### GitHub Actions sketch

```yaml
- name: CSS diagnostics
  run: pnpm exec css-doctor check "src/**/*.css" --json --threshold 800

- name: CSS health gate
  run: pnpm exec css-doctor health "src/**/*.css" --fail-under 80

- name: CSS regression gate
  run: pnpm exec css-doctor diff "src/**/*.css" --fail-on-regression --fail-on-new-errors
```

Initialize and commit `.css-doctor/baseline.json` on the default branch before
enabling the regression gate.

## Command: `baseline`

```text
css-doctor baseline create|show|validate|remove [options]
```

Creates a versioned JSON baseline (default `.css-doctor/baseline.json`) with:

- schema / tool versions and creation timestamp;
- overall + dimension Health Scores;
- aggregate size / rule / declaration counters;
- per-file content fingerprints (no CSS source stored);
- diagnostic fingerprints that ignore line-number drift.

| Subcommand | Purpose |
| --- | --- |
| `create [patterns...]` | Analyze CSS and write the baseline (`-o/--output` for custom path) |
| `show` | Print baseline metadata and scores |
| `validate` | Check schema compatibility (hard fail vs soft tool-version warning) |
| `remove` | Delete the baseline file |

## Command: `diff`

```text
css-doctor diff [patterns...] [options]
```

Compares the current analysis against a stored baseline and classifies status as
`healthy` | `improved` | `regressed` | `mixed` | `inconclusive`.

| Option | Description |
| --- | --- |
| `-b, --baseline <path>` | Baseline path (default `.css-doctor/baseline.json`) |
| `--fail-on-regression` | Exit `1` when status is `regressed` or `mixed` |
| `--fail-on-new-errors` | Exit `1` when new error diagnostics appear |
| `--fail-on-new-diagnostics` | Exit `1` when any new diagnostics appear |
| `--max-size-increase <n%>` | Fail when total CSS bytes grow beyond the percent |
| `--max-new-errors <n>` | Fail when new error count exceeds `<n>` |
| `--max-new-warnings <n>` | Fail when new warning count exceeds `<n>` |
| `--min-score <n>` | Fail when current overall score is below `<n>` |
| `--score-tolerance <n>` | Ignore score deltas within absolute tolerance |
| `-v, --verbose` | Longer file / diagnostic lists |
| `-j, --json` | Stable regression JSON (`schemaVersion: 1`) |

Diagnostic matching uses `code|path|selector|severity` fingerprints so inserting
lines near the top of a file does not mark every later finding as new.

### Project config

Optional `.css-doctor/config.json`:

```json
{
  "baseline": ".css-doctor/baseline.json",
  "patterns": ["src/**/*.css"],
  "regression": {
    "enabled": true,
    "scoreTolerance": 1,
    "sizeIncreasePercent": 10,
    "maxNewErrors": 0,
    "maxNewWarnings": 5
  },
  "qualityGates": {
    "minScore": 85,
    "maxSizeIncreasePercent": 10,
    "failOnRegression": true
  }
}
```

**Precedence:** CLI flags > config file > built-in defaults.

### Exit codes (`diff` / `baseline`)

| Code | Meaning |
| --- | --- |
| `0` | Command succeeded and configured quality gates passed |
| `1` | Missing/invalid baseline, analysis failure, or a quality gate failed |

## Command: `optimize` / `split`

```text
css-doctor optimize|split [patterns...] [options]
```

Runs the native two-tier pipeline (page coverage → size budget) and prints an
**optimization report** with structured decisions.

| Option | Description |
| --- | --- |
| `--dry-run` | Preview only (default unless `--write`) |
| `--write --out-dir <dir>` | Emit chunk CSS files under `<dir>` |
| `--explain` / `-v` | Show more decision detail |
| `--diff` | Concise unified diff of source vs emitted CSS |
| `--page-usage <json>` | Route → class map for coverage / DCE |
| `--min-page-ratio <n>` | Common threshold (0–1) |
| `--max-chunk-size <bytes>` | Size budget |
| `--no-page-coverage` / `--no-size-budget` / `--no-isolate-variables` / `--no-minify` | Disable stages |
| `-j, --json` / `--report <path>` | Stable JSON (`schemaVersion: 1`) |

**Metrics:** `bytesEliminated` is measured against a reference payload (common /
minified equivalent). `redistributedBytes` accounts for split duplication — chunk
sum vs input is **not** claimed as savings.

## Command: `fix`

```text
css-doctor fix [patterns...] [options]
css-doctor fix --list
```

| Option | Description |
| --- | --- |
| `--list` | Show fix catalog with safety levels |
| `--dry-run` | Preview (default unless `--write`) |
| `--write` | Atomically apply Safe fixes to source files |
| `--rule <id>` | Limit to selected rule ids (repeatable) |
| `--backup` | Write `.bak` before modifying |
| `--diff` | Unified diff preview |
| `-j, --json` | Stable JSON |

### Autofix safety

| Level | Default | Examples |
| --- | --- | --- |
| Safe | Applied with `--write` | `dead.empty-rule`, `duplicate.declaration` |
| Review | Never silent | `duplicate.selector` |
| Unsafe | Never applied | `variable.unused-definition` |

Safe transforms use LightningCSS AST rewrites and preserve cascade under the
documented conditions.

## Safety and limitations

- Binary name: `css-doctor` (package `bin` field).
- The CLI **analyzes** and **scores** CSS. Page-coverage splitting, size budgets,
  and variable isolation for production bundles belong to the framework adapters.
- CSS Modules / dynamic class usage are out of scope for static checks; those
  matter for build plugins.
- Native binding must resolve for your platform; no Rust toolchain is required
  when a prebuilt binary is available.

## Full documentation

Project README: [English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)
