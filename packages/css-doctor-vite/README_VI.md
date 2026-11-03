<div align="center">

# @zealamic/css-doctor-vite

**Plugin Vite/Rollup tối ưu CSS theo page coverage và size budget.**

[English](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-vite/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-vite/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-vite/README_CN.md)

</div>

---


> **DEPRECATED:** `@zealamic/css-doctor-vite` đã chuyển sang [`@zealakit/css-doctor-vite`](https://www.npmjs.com/package/@zealakit/css-doctor-vite).
>
> Cài package mới: `pnpm add -D @zealakit/css-doctor-vite`
>
> Docs hiện hành: https://github.com/zealakit/css-doctor
>
> Các package `@zealamic` vẫn giữ trên npm vì đã có download và không thể xóa an toàn. Chúng không còn được duy trì.

![css doctor](https://github.com/zealamic/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Cài đặt

```bash
pnpm add -D @zealamic/css-doctor-vite
```

## Sử dụng

```ts
import { defineConfig } from "vite";
import { cssDoctor } from "@zealamic/css-doctor-vite";

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

## Tùy chọn

| Tùy chọn | Mặc định | Mô tả |
| --- | --- | --- |
| `pageCoverage.enabled` | `true` | Bật phân loại page/class coverage. |
| `pageCoverage.minPageRatio` | `0.5` | Tỷ lệ tối thiểu (0.0-1.0) để vào common chunk. |
| `pageCoverage.forceCommon` | `[]` | Selector/class luôn giữ trong common CSS. |
| `sizeBudget.enabled` | `true` | Bật chia nhỏ theo byte budget. |
| `sizeBudget.maxChunkSize` | `60 * 1024` | Số byte tối đa mỗi chunk. |
| `sizeBudget.isolateVariables` | `true` | Tách biến `:root` và `@theme` trước. |
| `minify` | production | Minify CSS bằng LightningCSS. |
| `report` | `true` | In chẩn đoán coverage và chunk. |
| `exclude` | CSS Modules safety | Bỏ qua asset CSS khớp mẫu. |

## An toàn và giới hạn

- Hỗ trợ Vite, React, Vue, Svelte, Astro, TanStack Start và TanStack Router.
- Lazy route chunk giúp page coverage phát huy tác dụng.
- CSS Modules và Vue scoped styles được bảo vệ; page CSS được loader nhỏ trong page chunk tải.

## Tài liệu đầy đủ

README dự án: [English](https://github.com/zealamic/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/README_CN.md)
