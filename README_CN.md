<div align="center">

# css-doctor

**面向现代 Web 应用的原生 CSS 诊断、智能分割与生产级优化工具链。**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
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
- 确定性的 **CSS Health Score**（0–100，五个加权维度）；
- **基线与回归检测**（`baseline` / `diff`）用于 CI 质量门禁；
- **优化智能**（`optimize` / `split` / `fix`）：决策解释、dry-run 预览与 Safe 自动修复；
- 适用于 CI 的 JSON（`check`、`health`、`baseline`、`diff`、`optimize`、`fix`）。

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

## 快速开始 — CLI

CLI 覆盖**静态诊断**、Health Score、基线/回归、优化 dry-run 预览与 Safe autofix。
构建期 **CSS 产物注入**（HTML/JS chunk 链接）仍由框架适配器负责。

完整 CLI 指南：
[`packages/cli/README_CN.md`](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README_CN.md)
([English](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README.md) ·
[Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README_VI.md))。

### 无需安装直接运行

```bash
npx @zealakit/css-doctor-cli check "src/**/*.css"
```

### 安装为开发依赖

```bash
pnpm add -D @zealakit/css-doctor-cli

# 或
npm install -D @zealakit/css-doctor-cli
```

可选 `package.json` scripts：

```json
{
  "scripts": {
    "css:check": "css-doctor check \"src/**/*.css\"",
    "css:check:ci": "css-doctor check \"src/**/*.css\" --json --threshold 500"
  }
}
```

### 常用命令速查

```bash
# 帮助与版本
css-doctor --help
css-doctor --version
css-doctor check --help

# 单个或多个路径
css-doctor check src/styles/app.css
css-doctor check src/a.css src/b.css

# Glob — 务必加引号，避免 shell 先展开
css-doctor check "src/**/*.css"

# 文件与 glob 混用
css-doctor check styles/global.css "components/**/*.css"

# CI：JSON（可加选择器阈值）
css-doctor check "src/**/*.css" --json
css-doctor check "src/**/*.css" -j --threshold 500

# CSS Health Score
css-doctor health "src/**/*.css"
css-doctor health "src/**/*.css" --json
css-doctor health "src/**/*.css" --fail-under 80
css-doctor check "src/**/*.css" --fail-under 85

# 基线 + 回归（在 main 提交基线）
css-doctor baseline create "src/**/*.css"
css-doctor baseline show
css-doctor diff "src/**/*.css" --fail-on-regression --max-size-increase 10%

# 优化智能（默认 dry-run）
css-doctor optimize "src/**/*.css" --dry-run --explain
css-doctor fix --list
css-doctor fix "src/**/*.css" --dry-run --rule dead.empty-rule
```

| 选项 | 作用 |
| --- | --- |
| `-j, --json` | 输出稳定 JSON（`check`、`health`、`baseline`、`diff`） |
| `--threshold <n>` | 文件选择器超过 `<n>` 时警告 / 体积压力 |
| `--fail-under <n>` | （`check` / `health`）overall `< n` 时退出码为 `1` |
| `--fail-on-regression` | （`diff`）状态为 `regressed` 或 `mixed` 时退出码为 `1` |
| `--max-size-increase <n%>` | （`diff`）CSS 总体积增长超过限制时失败 |
| `-v, --version` | 打印 CLI 版本 |
| `-h, --help` | 打印帮助 |

`check` 会报告：`syntax`、`empty-rule`、`duplicate-selector`、可选 `threshold`，
以及聚合 `health`。所有匹配文件都分析成功时退出码为 `0`（允许 warning）；
初始化/读取/分析失败或 `--fail-under` 未通过时为 `1`。

`health` 评分覆盖选择器复杂度、重复规则、体积效率、死代码与变量一致性。
它是质量信号，不能保证 runtime/视觉正确性。

### 基线与回归

将版本化快照存入 `.css-doctor/baseline.json`（不保存 CSS 源码），然后用
`css-doctor diff` 对比 PR：

1. 在 `main`：`css-doctor baseline create "src/**/*.css"` 并提交该文件。
2. 在 PR：`css-doctor diff --fail-on-regression --fail-on-new-errors`。
3. 有意变更 CSS 后：重新创建并提交基线。

可选配置：`.css-doctor/config.json`（CLI 参数 > 配置文件 > 默认值）。
框架适配器继续复用共享健康评分引擎；基线持久化由 CLI/CI 负责。

### 优化智能

`optimize` / `split` 基于实测 metadata 解释流水线决策（绝不虚构覆盖率）。指标
区分 **消除** 字节与因拆分产生的 **重分布** 字节。`fix` 默认只应用 **Safe**
AST 变换；Review/Unsafe 绝不会静默应用。Dry-run 不写任何文件。

终端输出示例：

```text
css-doctor v1.0.0 · check
patterns src/**/*.css
────────────────────────────────────────────────────────────────
 SUCCESS  src/styles/app.css · 12.4 KB
  selectors 184 · rules 132 · declarations 421
  analysis 3.2 ms · read 0.8 ms · total 4.0 ms
  Top selectors
    #app .card:hover
    .nav-link.is-active
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
