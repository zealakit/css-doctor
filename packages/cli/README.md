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

# Single file
css-doctor check src/styles/app.css

# Multiple files
css-doctor check src/a.css src/b.css

# Glob — quote the pattern so the shell does not expand it first
css-doctor check "src/**/*.css"

# Mix paths and globs
css-doctor check styles/global.css "components/**/*.css"
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

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Setup OK and every matched file was read + analyzed (warnings still allowed) |
| `1` | Fatal setup error, no matches, unloadable native binding, or a file failed to read/analyze |

Warnings and hints **do not** fail the process. Use `--json` and inspect
`summary.issues` / `files[].issues` if you want CI gates on warnings.

### GitHub Actions sketch

```yaml
- name: CSS diagnostics
  run: pnpm exec css-doctor check "src/**/*.css" --json --threshold 800
```

## Safety and limitations

- Binary name: `css-doctor` (package `bin` field).
- The CLI only **analyzes** CSS. Page-coverage splitting, size budgets, and
  variable isolation belong to the framework adapters.
- CSS Modules / dynamic class usage are out of scope for this command; those
  matter for build plugins, not static file checks.
- Native binding must resolve for your platform; no Rust toolchain is required
  when a prebuilt binary is available.

## Full documentation

Project README: [English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)
