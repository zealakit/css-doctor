<div align="center">

# @zealamic/css-doctor-next

**Next.js App Router and Pages Router integration for css-doctor.**

[English](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-next/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-next/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-next/README_CN.md)

</div>

---


> **DEPRECATED:** `@zealamic/css-doctor-next` has moved to [`@zealakit/css-doctor-next`](https://www.npmjs.com/package/@zealakit/css-doctor-next).
>
> Install the replacement: `pnpm add -D @zealakit/css-doctor-next`
>
> Active docs: https://github.com/zealakit/css-doctor
>
> The `@zealamic` packages remain on npm only because existing downloads prevent deletion. They are unmaintained.

![css doctor](https://github.com/zealamic/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Installation

```bash
pnpm add -D @zealamic/css-doctor-next
```

## Usage

```ts
import { withCssDoctor } from "@zealamic/css-doctor-next";

export default withCssDoctor(
  { reactStrictMode: true },
  {
    pageCoverage: {
      enabled: true,
      minPageRatio: 0.5,
      forceCommon: [".app-shell", ".nav-link"],
    },
    sizeBudget: {
      enabled: true,
      maxChunkSize: 40 * 1024,
      isolateVariables: true,
    },
    report: true,
  },
);
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

- Preserves the existing webpack callback and applies only to the production client build.
- CSS Modules are skipped automatically; common chunks remain linked through @import wrappers.
- Peer range next >=13 is intentionally broad.

## Full documentation

Project README: [English](https://github.com/zealamic/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/README_CN.md)
