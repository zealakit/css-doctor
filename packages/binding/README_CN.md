<div align="center">

# @zealamic/css-doctor-binding

**css-doctor LightningCSS 引擎的原生 NAPI-RS 桥接层。**

[English](https://github.com/zealamic/css-doctor/blob/main/packages/binding/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/packages/binding/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/packages/binding/README_CN.md)

</div>

---


> **DEPRECATED：** `@zealamic/css-doctor-binding` 已迁移到 [`@zealakit/css-doctor-binding`](https://www.npmjs.com/package/@zealakit/css-doctor-binding)。
>
> 安装新包：`pnpm add -D @zealakit/css-doctor-binding`
>
> 当前文档：https://github.com/zealakit/css-doctor
>
> `@zealamic` 包因已有下载量无法安全删除，仍保留在 npm 上，但不再维护。

![css doctor](https://github.com/zealamic/css-doctor/blob/main/assets/images/css-doctor.jpg)

## 安装

```bash
pnpm add @zealamic/css-doctor-binding
```

## 使用

```ts
import { analyzeCss, optimizeCss } from "@zealamic/css-doctor-binding";

const analysis = analyzeCss(".card { color: red; }");

const result = optimizeCss({
  cssContent: ".card { color: red; } :root { --brand: red; }",
  pageUsage: { home: ["card"] },
  pageCoverage: { enabled: true, minPageRatio: 0.5 },
  sizeBudget: { enabled: true, maxChunkSize: 40 * 1024, isolateVariables: true },
  minify: true,
});

console.log(analysis.stats.selectorCount);
console.log(result.chunks);
```

## 安全与限制

- 预构建二进制支持 darwin-arm64、darwin-x64、linux-x64-gnu、linux-x64-musl 和 win32-x64-msvc。
- 原生 API 属于底层接口；应用构建推荐使用 @zealamic/css-doctor-vite、next、rsbuild、nuxt 或 remix。
- 不要手动修改生成的 index.js、index.d.ts、index.d.cts 或 *.node。

## 完整文档

项目 README：[English](https://github.com/zealamic/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/README_CN.md)
