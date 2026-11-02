<div align="center">

# @zealakit/css-doctor-rsbuild

**用于页面覆盖率与体积预算 CSS 分割的 Rsbuild/Rspack 集成。**

[English](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-rsbuild/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-rsbuild/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-rsbuild/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## 安装

```bash
pnpm add -D @zealakit/css-doctor-rsbuild
```

## 使用

```ts
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginCssDoctor } from "@zealakit/css-doctor-rsbuild";

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

- 仅用于生产构建；适用于 Rspack bundler。
- peer 范围 @rsbuild/core >=1 保持宽泛。
- 不会修改 CSS Modules 与框架 scoped styles。

## 完整文档

项目 README：[English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)
