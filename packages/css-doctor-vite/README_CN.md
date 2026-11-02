<div align="center">

# @zealakit/css-doctor-vite

**用于页面覆盖率与体积预算 CSS 优化的 Vite/Rollup 插件。**

[English](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-vite/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-vite/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-vite/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## 安装

```bash
pnpm add -D @zealakit/css-doctor-vite
```

## 使用

```ts
import { defineConfig } from "vite";
import { cssDoctor } from "@zealakit/css-doctor-vite";

export default defineConfig({
  plugins: [
    cssDoctor({
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
    }),
  ],
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
| `exclude` | CSS Modules safety | 跳过匹配的 CSS 资源。 |

## 安全与限制

- 支持 Vite、React、Vue、Svelte、Astro、TanStack Start 和 TanStack Router。
- 懒加载路由 chunk 才能让页面覆盖率分析有效。
- 保护 CSS Modules 与 Vue scoped styles；页面 CSS 由 page chunk 内的小型 loader 加载。

## 完整文档

项目 README：[English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)
