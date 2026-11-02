<div align="center">

# @zealakit/css-doctor-remix

**Remix 3 asset-server middleware for runtime CSS optimization.**

[English](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-remix/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-remix/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-remix/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Installation

```bash
pnpm add @zealakit/css-doctor-remix
```

## Usage

```ts
import { createAssetServer } from "remix/assets";
import { withCssDoctorAssets } from "@zealakit/css-doctor-remix";

const baseAssets = createAssetServer({
  basePath: "/assets",
  rootDir: process.cwd(),
  allowFiles: ["app/**/public/**", "app/routes.ts"],
  allowPackages: ["remix"],
});

export const assets = withCssDoctorAssets(baseAssets, {
  sizeBudget: {
    enabled: true,
    maxChunkSize: 30 * 1024,
    isolateVariables: true,
  },
  minify: process.env.NODE_ENV === "production",
  cache: { enabled: true, maxEntries: 100 },
  exclude: [/\.module\.(css|scss)$/],
});
```

## Options

| Option | Default | Description |
| --- | --- | --- |
| `sizeBudget.enabled` | `true` | Enable byte-budget splitting. |
| `sizeBudget.maxChunkSize` | `60 * 1024` | Maximum bytes per emitted chunk. |
| `sizeBudget.isolateVariables` | `true` | Extract `:root` and `@theme` variables first. |
| `minify` | production | Minify emitted CSS with LightningCSS. |

## Safety and limitations

- No pageCoverage: Remix 3 has no build-time route-to-CSS graph.
- Optimizes successful text/css GET responses and falls back to the original response on failure.
- Uses an LRU cache based on URL, source ETag, and content hash.
- Load page-specific module stylesheets from controller actions, not a global document head.

## Full documentation

Project README: [English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)
