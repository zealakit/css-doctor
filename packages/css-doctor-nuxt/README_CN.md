<div align="center">

# @zealakit/css-doctor-nuxt

**css-doctor 官方 Nuxt 4 模块。**

[English](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-nuxt/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-nuxt/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-nuxt/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## 安装

```bash
pnpm add -D @zealakit/css-doctor-nuxt
```

## 使用

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

## 配置

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `pageCoverage.enabled` | `true` | 启用页面/class 覆盖率分类。 |
| `pageCoverage.minPageRatio` | `0.5` | 进入 common chunk 的最小比例（0.0-1.0）。 |
| `pageCoverage.forceCommon` | `[]` | 强制保留在 common CSS 中的 selector/class。 |
| `sizeBudget.enabled` | `true` | 启用按字节预算分割。 |
| `sizeBudget.maxChunkSize` | `60 * 1024` | 每个 chunk 的最大字节数。 |
| `sizeBudget.isolateVariables` | `true` | 先提取 `:root` 与 `@theme` 变量。 |
| `minify` | production | 使用 LightningCSS 压缩输出 CSS。 |
| `report` | `true` | 输出覆盖率和 chunk 诊断。 |

## 安全与限制

- 仅用于生产客户端构建，不会修改 Nitro SSR。
- 跳过 Vue scoped styles；公共 chunk 通过有序 @import 加载。
- Nuxt 模块默认 maxChunkSize 为 30 * 1024 字节。

## 完整文档

项目 README：[English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)
