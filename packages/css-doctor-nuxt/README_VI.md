<div align="center">

# @zealakit/css-doctor-nuxt

**Module Nuxt 4 chính thức cho css-doctor.**

[English](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-nuxt/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-nuxt/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/css-doctor-nuxt/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Cài đặt

```bash
pnpm add -D @zealakit/css-doctor-nuxt
```

## Sử dụng

```ts
import tailwindcss from "@tailwindcss/vite";

export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  modules: ["@zealakit/css-doctor-nuxt"],
  css: [
    "~/assets/styles-tailwind.css",
    "~/assets/styles-custom.scss",
  ],
  cssDoctor: {
    pageCoverage: { enabled: true, minPageRatio: 0.5 },
    sizeBudget: { enabled: true, maxChunkSize: 30 * 1024, isolateVariables: true },
    minify: true,
    report: true,
  },
  vite: { plugins: [tailwindcss()] },
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

## An toàn và giới hạn

- Chỉ chạy cho production client build; không sửa Nitro SSR.
- Vue scoped styles được bỏ qua; common chunk được tải qua @import có thứ tự.
- maxChunkSize mặc định của module Nuxt là 30 * 1024 byte.

## Tài liệu đầy đủ

README dự án: [English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)
