<div align="center">

# @zealakit/css-doctor-nuxt

**Official Nuxt 4 module for css-doctor.**

[English](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-nuxt/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-nuxt/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-nuxt/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Installation

```bash
pnpm add -D @zealakit/css-doctor-nuxt
```

## Usage

```ts
import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  modules: ["@zealakit/css-doctor-nuxt"],
  css: [
    "~/assets/styles-tailwind.css",
    "~/assets/styles-custom.scss",
  ],
  cssDoctor: {
    pageCoverage: { enabled: true, minPageRatio: 0.5 },
    sizeBudget: { enabled: true, maxChunkSize: 30 * 1024, isolateVariables: true },
    minify: true,
    report: true,
  },
  vite: { plugins: [tailwindcss()] },
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

## Safety and limitations

- Runs only for the production client build; Nitro SSR is never modified.
- Vue scoped styles are skipped and common chunks are loaded through ordered @import statements.
- Nuxt module default maxChunkSize is 30 * 1024 bytes.

## Full documentation

Project README: [English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)
