<div align="center">

# @zealamic/css-doctor-remix

**用于运行时 CSS 优化的 Remix 3 Asset Server 中间件。**

[English](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-remix/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-remix/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-remix/README_CN.md)

</div>

---


> **DEPRECATED：** `@zealamic/css-doctor-remix` 已迁移到 [`@zealakit/css-doctor-remix`](https://www.npmjs.com/package/@zealakit/css-doctor-remix)。
>
> 安装新包：`pnpm add -D @zealakit/css-doctor-remix`
>
> 当前文档：https://github.com/zealakit/css-doctor
>
> `@zealamic` 包因已有下载量无法安全删除，仍保留在 npm 上，但不再维护。

![css doctor](https://github.com/zealamic/css-doctor/blob/main/assets/images/css-doctor.jpg)

## 安装

```bash
pnpm add @zealamic/css-doctor-remix
```

## 使用

```ts
import { createAssetServer } from "remix/assets";
import { withCssDoctorAssets } from "@zealamic/css-doctor-remix";

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

## 配置

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `sizeBudget.enabled` | `true` | 启用按字节预算分割。 |
| `sizeBudget.maxChunkSize` | `60 * 1024` | 每个 chunk 的最大字节数。 |
| `sizeBudget.isolateVariables` | `true` | 先提取 `:root` 与 `@theme` 变量。 |
| `minify` | production | 使用 LightningCSS 压缩输出 CSS。 |

## 安全与限制

- 不支持 pageCoverage：Remix 3 没有构建期 route-to-CSS 图。
- 优化成功的 text/css GET 响应，失败时回退原始响应。
- 使用基于 URL、源 ETag 和内容哈希的 LRU 缓存。
- 按 controller action 加载页面 module 样式，不要硬编码到全局 document head。

## 完整文档

项目 README：[English](https://github.com/zealamic/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/README_CN.md)
