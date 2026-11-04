<div align="center">

# @zealakit/css-doctor-cli

**使用原生 css-doctor 引擎的命令行 CSS 诊断工具。**

[English](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## 功能说明

`css-doctor check` 读取一个或多个 CSS 文件，用原生 LightningCSS 引擎解析，并输出
终端报告（或供 CI 使用的 JSON）。

这是**诊断**工具。它**不会**改写文件、minify CSS，也不会按页面拆分样式表。
构建期优化请使用 Vite / Next / Nuxt / Rsbuild / Remix 适配器。

CLI 会报告：

| 类型 | 含义 |
| --- | --- |
| `syntax` | LightningCSS 语法警告 |
| `empty-rule` | 无声明且无嵌套规则的规则（疑似死代码） |
| `duplicate-selector` | 同一选择器文本出现在多个规则中 |
| `threshold` | 单文件选择器数量超过 `--threshold` |

## 环境要求

- Node.js **≥ 18**
- 对应平台的 `@zealakit/css-doctor-binding` 原生二进制（随包安装，支持
  macOS / Linux / Windows x64）

## 安装

### 无需安装，直接运行

```bash
npx @zealakit/css-doctor-cli check "src/**/*.css"
```

### 安装到项目

```bash
pnpm add -D @zealakit/css-doctor-cli

# 或
npm install -D @zealakit/css-doctor-cli
yarn add -D @zealakit/css-doctor-cli
```

安装后可通过以下方式调用：

```bash
pnpm exec css-doctor --help
# npm
npx css-doctor --help
```

### package.json script

```json
{
  "scripts": {
    "css:check": "css-doctor check \"src/**/*.css\"",
    "css:check:ci": "css-doctor check \"src/**/*.css\" --json --threshold 500"
  }
}
```

```bash
pnpm css:check
```

## 快速开始

```bash
# 帮助 / 版本
css-doctor --help
css-doctor --version
css-doctor check --help
css-doctor health --help

# 单个文件
css-doctor check src/styles/app.css

# 多个文件
css-doctor check src/a.css src/b.css

# Glob — 请加引号，避免 shell 先展开
css-doctor check "src/**/*.css"

# 路径与 glob 混用
css-doctor check styles/global.css "components/**/*.css"

# CSS Health Score
css-doctor health "src/**/*.css"
css-doctor health "src/**/*.css" --json
css-doctor health "src/**/*.css" --fail-under 80
css-doctor check "src/**/*.css" --fail-under 85

# 基线 + 回归
css-doctor baseline create "src/**/*.css"
css-doctor baseline show
css-doctor diff "src/**/*.css" --fail-on-regression

# 优化智能
css-doctor optimize "src/**/*.css" --dry-run --explain --json
css-doctor fix --list
css-doctor fix "src/**/*.css" --dry-run --rule dead.empty-rule
```

## 命令：`check`

```text
css-doctor check [patterns...] [options]
```

| 参数 / 选项 | 说明 |
| --- | --- |
| `patterns...` | 一个或多个 CSS 路径或 glob。**必填。** |
| `-j, --json` | 向 stdout 输出结构化 `CheckReport` JSON |
| `--threshold <n>` | 当文件选择器数量超过 `<n>` 时警告（非负整数） |
| `--fail-under <n>` | 总体 Health Score `< n`（0–100）时退出码为 `1` |
| `-v, --version` | 打印 CLI 版本 |
| `-h, --help` | 打印帮助 |

### Glob 提示

- 请给 glob 加引号：`"src/**/*.css"`。不加引号时，shell 可能先展开 `*`。
- 自动忽略 `node_modules` 与 `.git`。
- 含 glob 字符的真实文件路径（如 `src/[slug].css`）在文件存在时可直接传入。

### 终端输出示例

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
    …

 WARNING  src/legacy.css · 48.1 KB
  selectors 612 · rules 540 · declarations 1 204
  Diagnostics
    • empty-rule — Rule ".unused" has no declarations…
    • duplicate-selector — Selector ".btn" is defined in multiple rules…
────────────────────────────────────────────────────────────────
 files 2 · analyzed 2 · issues 2 · …
```

状态含义：

| Status | 时机 |
| --- | --- |
| `SUCCESS` | 分析成功且无 issue |
| `WARNING` | 分析成功，但有 syntax / empty-rule / duplicate / threshold |
| `ERROR` | 无法读取/分析文件，或初始化失败 |

## CI 与 JSON

```bash
css-doctor check "src/**/*.css" --json
css-doctor check "src/**/*.css" -j --threshold 500
```

`--json` 输出稳定的 `CheckReport`（`schemaVersion: 1`），包含：

- `success` — 仅当初始化成功且所有匹配文件都分析成功时为 `true`
- `errors` — 致命初始化错误（无 pattern、无匹配、绑定加载失败等）
- `files[]` — 每个文件的路径、大小、耗时、`issues`，以及成功时的 native `result`
- `summary` — 汇总计数（files、selectors、warnings、耗时等）

保存报告：

```bash
css-doctor check "src/**/*.css" --json > css-doctor-report.json
```

### 退出码（`check`）

| Code | 含义 |
| --- | --- |
| `0` | 初始化成功，且所有匹配文件均已读取并分析（允许 warning） |
| `1` | 初始化失败、无匹配、无法加载绑定、某文件读取/分析失败，或 `--fail-under` 未通过 |

warning / hint **不会**单独导致非零退出码，除非同时设置 `--fail-under`。
若要在 CI 中根据 warning 失败，请解析 `--json` 中的 `summary.issues` /
`files[].issues`。

`check --json` 还会包含聚合的 `health` 字段（CSS Health Score）。

## 命令：`health`

```text
css-doctor health [patterns...] [options]
```

计算确定性的 **CSS Health Score**（0–100），覆盖五个维度：

| 维度 | 权重 | 测量内容 |
| --- | ---: | --- |
| Selector Complexity | 20% | 高特异性、深层组合/嵌套、长选择器 |
| Duplicate Rules | 20% | 重复选择器 / 同规则重复声明 |
| CSS Size Efficiency | 20% | 大样式表、重规则、选择器压力 |
| Dead CSS | 25% | 空规则、可恢复语法丢弃 |
| Variable Consistency | 15% | 重复定义 / `var()` 缺口（启发式） |

等级：**A** 90–100 · **B** 80–89 · **C** 70–79 · **D** 60–69 · **F** 0–59。

| 选项 | 说明 |
| --- | --- |
| `-j, --json` | 稳定 health JSON（`schemaVersion: 1`） |
| `--threshold <n>` | 映射到 `manySelectors` 体积压力阈值 |
| `--fail-under <n>` | overall `< n` 时退出码为 `1`（CI 门禁） |

该分数**不能**保证视觉/runtime 正确性。未使用变量等 finding 在静态证据不足时
标记为 `heuristic`。

### GitHub Actions 示例

```yaml
- name: CSS diagnostics
  run: pnpm exec css-doctor check "src/**/*.css" --json --threshold 800

- name: CSS health gate
  run: pnpm exec css-doctor health "src/**/*.css" --fail-under 80

- name: CSS regression gate
  run: pnpm exec css-doctor diff "src/**/*.css" --fail-on-regression --fail-on-new-errors
```

启用回归门禁前，请先在默认分支创建并提交 `.css-doctor/baseline.json`。

## 命令：`baseline`

```text
css-doctor baseline create|show|validate|remove [options]
```

创建版本化 JSON 基线（默认 `.css-doctor/baseline.json`），包含 Health Score、
文件/诊断指纹（不保存 CSS 源码）。

| 子命令 | 作用 |
| --- | --- |
| `create [patterns...]` | 分析 CSS 并写入基线（`-o/--output` 可自定义路径） |
| `show` | 显示元数据与分数 |
| `validate` | 校验 schema 兼容性 |
| `remove` | 删除基线文件 |

## 命令：`diff`

```text
css-doctor diff [patterns...] [options]
```

将当前分析与基线对比；状态为
`healthy` | `improved` | `regressed` | `mixed` | `inconclusive`。

| 选项 | 说明 |
| --- | --- |
| `-b, --baseline <path>` | 基线路径（默认 `.css-doctor/baseline.json`） |
| `--fail-on-regression` | 状态为 `regressed` 或 `mixed` 时退出码为 `1` |
| `--fail-on-new-errors` | 出现新的 error 诊断时退出码为 `1` |
| `--fail-on-new-diagnostics` | 出现任意新诊断时退出码为 `1` |
| `--max-size-increase <n%>` | CSS 总字节增长超过百分比时失败 |
| `--max-new-errors <n>` / `--max-new-warnings <n>` | 新问题数量上限 |
| `--min-score <n>` | 当前 overall `< n` 时失败 |
| `-v, --verbose` / `-j, --json` | 详细输出 / 稳定 JSON（`schemaVersion: 1`） |

诊断匹配使用 `code|path|selector|severity` 指纹，行号漂移不会把后续 finding
全部标为“新增”。

可选配置：`.css-doctor/config.json`。**优先级：** CLI 参数 > 配置文件 > 默认值。

## 命令：`optimize` / `split` / `fix`

- `optimize` / `split`：优化报告与决策解释；默认 dry-run；`--write --out-dir` 写出分块。
- 指标区分消除字节与拆分重分布字节。
- `fix --list` / `--dry-run` / `--write`：默认只应用 **Safe** 修复
  （`dead.empty-rule`、`duplicate.declaration`）；Review/Unsafe 不会静默应用。

## 安全与限制

- 命令名：`css-doctor`（通过 package `bin` 暴露）。
- CLI 做 **分析** 与 **评分**。页面覆盖拆分、体积预算、变量隔离属于框架适配器。
- CSS Modules / 动态 class 不在静态检查范围内。
- 需要对应平台的原生二进制；有预构建包时无需 Rust 工具链。

## 完整文档

项目 README：[English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)
