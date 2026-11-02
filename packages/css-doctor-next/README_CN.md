<div align="center">

# @zealakit/css-doctor-next

**面向 Next.js App Router 与 Pages Router 的 css-doctor 集成。**

[English](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-next/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-next/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-next/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## 安装

```bash
pnpm add -D @zealakit/css-doctor-next
```

## 使用

```ts
import { withCssDoctor } from "@zealakit/css-doctor-next";

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

- 保留现有 webpack callback，仅作用于生产客户端构建。
- 自动跳过 CSS Modules；公共 chunk 通过 @import wrapper 保持链接。
- peer 范围 next >=13 有意保持宽泛。

## 完整文档

项目 README：[English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)
