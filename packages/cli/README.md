<div align="center">

# @zealamic/css-doctor-cli

**Command-line diagnostics for CSS files using the native css-doctor engine.**

[English](https://github.com/zealamic/css-doctor/blob/main/packages/cli/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/packages/cli/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/packages/cli/README_CN.md)

</div>

---


> **DEPRECATED:** `@zealamic/css-doctor-cli` has moved to [`@zealakit/css-doctor-cli`](https://www.npmjs.com/package/@zealakit/css-doctor-cli).
>
> Install the replacement: `pnpm add -D @zealakit/css-doctor-cli`
>
> Active docs: https://github.com/zealakit/css-doctor
>
> The `@zealamic` packages remain on npm only because existing downloads prevent deletion. They are unmaintained.

![css doctor](https://github.com/zealamic/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Installation

```bash
pnpm add -D @zealamic/css-doctor-cli
```

## Usage

```bash
# Analyze files or quoted globs
pnpm exec css-doctor check "src/**/*.css"

# Machine-readable CI output
pnpm exec css-doctor check "src/**/*.css" --json

# Warn when a file has more than 500 selectors
pnpm exec css-doctor check "src/**/*.css" --threshold 500
```

## Safety and limitations

- The binary is named css-doctor and is exposed through the package bin field.
- --json emits a stable CheckReport schema with files, issues, and summary counters.
- Exit code is non-zero for fatal setup/read/analysis failures; warnings remain visible in the report.

## Full documentation

Project README: [English](https://github.com/zealamic/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/README_CN.md)
