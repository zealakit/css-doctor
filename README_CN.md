<div align="center">

# css-doctor

**面向现代 Web 应用的原生 CSS 诊断、智能分割与生产级优化工具链。**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Rust](https://img.shields.io/badge/rust-stable-b7410e?logo=rust&logoColor=white)](https://www.rust-lang.org)

[English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## 概述

`css-doctor` 是一套基于 **LightningCSS AST** 的 Rust 原生 CSS 分析与优化工具，
通过 **NAPI-RS** 连接 Node.js。

它不仅做 minify，还能发现异常 selector、定位死码、分析页面覆盖率、隔离 CSS
变量，并在不破坏 CSS Modules 与框架 scoped styles 的前提下拆分过大的样式表。

项目提供 zero-config CLI、native binding，以及面向 Vite、Next.js、Nuxt、
Remix、Rsbuild 的官方适配器。

---

## 核心特性

### Rust 原生性能

CSS 解析、selector 提取、诊断与分割全部在 Rust core 中执行。Node.js 层只是
轻量的 NAPI-RS 桥接，因此即使样式表很大也能保持高速分析。

### Zero-config CLI

直接使用 `npx` 运行 `css-doctor`，或安装为 dev dependency。CLI 已内置
JavaScript 依赖，仅 native binding 保留为运行时动态 require。

### 全面诊断

CLI 可报告：

- 语法警告；
- 空规则与 dead rule；
- 重复 selector；
- 样式表体积与 selector 数量阈值；
- selector、rule、declaration 数量与耗时；
- 适用于 CI 的 JSON 输出。

### 跨平台原生二进制

`@zealakit/css-doctor-binding` 自动解析预构建 NAPI 二进制：

| 平台 | 架构 | Target |
| --- | --- | --- |
| macOS | Apple Silicon | `darwin-arm64` |
| macOS | Intel | `darwin-x64` |
| Linux | x64 glibc | `linux-x64-gnu` |
| Linux | x64 musl | `linux-x64-musl` |
| Windows | x64 MSVC | `win32-x64-msvc` |

在受支持平台上无需安装 Rust toolchain。

### 框架感知 CSS 优化

适配器支持 page coverage splitting、size budget、变量隔离、死码消除，以及
CSS Modules、Vue scoped、Svelte scoped、Astro scoped 的安全处理。

---

## 快速开始

### 直接运行 CLI

```bash
npx @zealakit/css-doctor-cli check "src/**/*.css"
```

### 安装 CLI

```bash
pnpm add -D @zealakit/css-doctor-cli

# 或
npm install -D @zealakit/css-doctor-cli
```

### 常用命令

```bash
# 帮助与版本
css-doctor --help
css-doctor --version

# 检查单个文件
css-doctor check src/styles/app.css

# 检查带引号的 glob
css-doctor check "src/**/*.css"

# CI 使用的 JSON 输出
css-doctor check "src/**/*.css" --json

# selector 超过 500 时警告
css-doctor check "src/**/*.css" --threshold 500
```

示例输出：

```text
css-doctor v1.0.0 · check
patterns src/**/*.css
────────────────────────────────────────────────────────────
 SUCCESS  src/styles/app.css · 12.4 KB
  selectors 184 · rules 132 · declarations 421
  analysis 3.2 ms · read 0.8 ms · total 4.0 ms
```

---

## 框架集成

| Framework / tool | Package | 安装 |
| --- | --- | --- |
| Vite、React、Vue、Svelte、TanStack | [`@zealakit/css-doctor-vite`](https://www.npmjs.com/package/@zealakit/css-doctor-vite) | `pnpm add -D @zealakit/css-doctor-vite` |
| Next.js App/Pages Router | [`@zealakit/css-doctor-next`](https://www.npmjs.com/package/@zealakit/css-doctor-next) | `pnpm add -D @zealakit/css-doctor-next` |
| Nuxt 4 | [`@zealakit/css-doctor-nuxt`](https://www.npmjs.com/package/@zealakit/css-doctor-nuxt) | `pnpm add -D @zealakit/css-doctor-nuxt` |
| Remix 3 | [`@zealakit/css-doctor-remix`](https://www.npmjs.com/package/@zealakit/css-doctor-remix) | `pnpm add @zealakit/css-doctor-remix` |
| Rsbuild / Rspack | [`@zealakit/css-doctor-rsbuild`](https://www.npmjs.com/package/@zealakit/css-doctor-rsbuild) | `pnpm add -D @zealakit/css-doctor-rsbuild` |
| CLI | [`@zealakit/css-doctor-cli`](https://www.npmjs.com/package/@zealakit/css-doctor-cli) | `pnpm add -D @zealakit/css-doctor-cli` |
| Native binding | [`@zealakit/css-doctor-binding`](https://www.npmjs.com/package/@zealakit/css-doctor-binding) | 通过依赖自动安装 |

每个 package 目录都包含英文、越南文和简体中文 README。根目录翻译仍可访问：
[English](./README.md) 与 [Tiếng Việt](./README_VI.md)。

### Vite

```ts
// vite.config.ts
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
      minify: true,
      report: true,
    }),
  ],
});
```

### Next.js

```js
// next.config.mjs
import { withCssDoctor } from "@zealakit/css-doctor-next";

export default withCssDoctor(
  {
    reactStrictMode: true,
  },
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
    minify: true,
    report: true,
  },
);
```

### 适配器能力

| Adapter | Page coverage | Size budget | Variables isolation | Dead code |
| --- | --- | --- | --- | --- |
| Vite / Astro / TanStack | 支持 | 支持 | 支持 | 支持 |
| Next.js | 支持 | 支持 | 支持 | 支持 |
| Nuxt 4 | 支持 | 支持 | 支持 | 支持 |
| Rsbuild / Rspack | 支持 | 支持 | 支持 | 支持 |
| Remix 3 runtime | 不支持 | 支持 | 支持 | 不支持 |

Remix 3 没有构建期 page-to-CSS 依赖图。Middleware 使用 `sizeBudget`、
`isolateVariables`、`minify` 与 response cache，而不是运行时 page coverage。

---

## 配置参考

| 参数 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `pageCoverage.enabled` | `boolean` | `true` | 启用按路由的覆盖率分类。 |
| `pageCoverage.minPageRatio` | `number` | `0.5` | 进入 common CSS 的最小页面比例（`0.0`–`1.0`）。 |
| `pageCoverage.forceCommon` | `string[]` | `[]` | 强制保留在 common chunk 的 selector/class。 |
| `sizeBudget.enabled` | `boolean` | `true` | 启用按字节预算分割。 |
| `sizeBudget.maxChunkSize` | `number` | `60 * 1024` | 每个 chunk 的最大字节数。 |
| `sizeBudget.isolateVariables` | `boolean` | `true` | 先提取 `:root` 与 Tailwind `@theme` 变量。 |
| `minify` | `boolean` | production/build 值 | 使用 LightningCSS 压缩 CSS。 |
| `report` | `boolean` | `true` | 输出覆盖率与 split 诊断。 |
| `exclude` | `(string \| RegExp)[]` | CSS Modules 安全规则 | 跳过匹配的资源。 |

完整参数列表请查阅各 adapter 的 README。

---

## 许可证

MIT。见 [LICENSE](./LICENSE)。
