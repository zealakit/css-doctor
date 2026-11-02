<div align="center">

# @zealakit/css-doctor-binding

**css-doctor LightningCSS 引擎的原生 NAPI-RS 桥接层。**

[English](https://github.com/zealakit/css-doctor/blob/main/packages/binding/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/binding/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/binding/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## 安装

```bash
pnpm add @zealakit/css-doctor-binding
```

## 使用

```ts
import { analyzeCss, optimizeCss } from "@zealakit/css-doctor-binding";

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
- 原生 API 属于底层接口；应用构建推荐使用 @zealakit/css-doctor-vite、next、rsbuild、nuxt 或 remix。
- 不要手动修改生成的 index.js、index.d.ts、index.d.cts 或 *.node。

## 完整文档

项目 README：[English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)
