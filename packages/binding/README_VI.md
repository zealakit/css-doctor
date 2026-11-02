<div align="center">

# @zealakit/css-doctor-binding

**Cầu nối NAPI-RS native cho engine LightningCSS của css-doctor.**

[English](https://github.com/zealakit/css-doctor/blob/main/packages/binding/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/binding/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/binding/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Cài đặt

```bash
pnpm add @zealakit/css-doctor-binding
```

## Sử dụng

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

## An toàn và giới hạn

- Binary dựng sẵn hỗ trợ darwin-arm64, darwin-x64, linux-x64-gnu, linux-x64-musl và win32-x64-msvc.
- API native là low-level; nên dùng @zealakit/css-doctor-vite, next, rsbuild, nuxt hoặc remix cho ứng dụng.
- Không chỉnh tay index.js, index.d.ts, index.d.cts hoặc *.node đã generate.

## Tài liệu đầy đủ

README dự án: [English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)
