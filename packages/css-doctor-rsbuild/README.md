<div align="center">

# @zealamic/css-doctor-rsbuild

**Rsbuild/Rspack integration for page-coverage and size-budget CSS splitting.**

[English](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-rsbuild/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-rsbuild/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-rsbuild/README_CN.md)

</div>

---


> **DEPRECATED:** `@zealamic/css-doctor-rsbuild` has moved to [`@zealakit/css-doctor-rsbuild`](https://www.npmjs.com/package/@zealakit/css-doctor-rsbuild).
>
> Install the replacement: `pnpm add -D @zealakit/css-doctor-rsbuild`
>
> Active docs: https://github.com/zealakit/css-doctor
>
> The `@zealamic` packages remain on npm only because existing downloads prevent deletion. They are unmaintained.

![css doctor](https://github.com/zealamic/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Installation

```bash
pnpm add -D @zealamic/css-doctor-rsbuild
```

## Usage

```ts
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginCssDoctor } from "@zealamic/css-doctor-rsbuild";

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginCssDoctor({
      pageCoverage: { enabled: true, minPageRatio: 0.5 },
      sizeBudget: { enabled: true, maxChunkSize: 40 * 1024, isolateVariables: true },
      report: true,
    }),
  ],
});
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `pageCoverage.enabled` | `true` | Enable page/class coverage classification. |
| `pageCoverage.minPageRatio` | `0.5` | Minimum ratio (0.0-1.0) for the common chunk. |
| `pageCoverage.forceCommon` | `[]` | Selectors or classes forced into common CSS. |
| `sizeBudget.enabled` | `true` | Enable byte-budget splitting. |
| `sizeBudget.maxChunkSize` | `60 * 1024` | Maximum bytes per emitted chunk. |
| `sizeBudget.isolateVariables` | `true` | Extract `:root` and `@theme` variables first. |
| `minify` | production | Minify emitted CSS with LightningCSS. |
| `report` | `true` | Print coverage and chunk diagnostics. |
| `exclude` | CSS Modules safety | Skip matching CSS assets. |

## Safety and limitations

- Production build only; works with the Rspack bundler.
- Peer range @rsbuild/core >=1 remains broad.
- CSS Modules and scoped framework styles are left untouched.

## Full documentation

Project README: [English](https://github.com/zealamic/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/README_CN.md)
