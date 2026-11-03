<div align="center">

# @zealamic/css-doctor-rsbuild

**Tích hợp Rsbuild/Rspack phân tách CSS theo page coverage và size budget.**

[English](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-rsbuild/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-rsbuild/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-rsbuild/README_CN.md)

</div>

---


> **DEPRECATED:** `@zealamic/css-doctor-rsbuild` đã chuyển sang [`@zealakit/css-doctor-rsbuild`](https://www.npmjs.com/package/@zealakit/css-doctor-rsbuild).
>
> Cài package mới: `pnpm add -D @zealakit/css-doctor-rsbuild`
>
> Docs hiện hành: https://github.com/zealakit/css-doctor
>
> Các package `@zealamic` vẫn giữ trên npm vì đã có download và không thể xóa an toàn. Chúng không còn được duy trì.

![css doctor](https://github.com/zealamic/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Cài đặt

```bash
pnpm add -D @zealamic/css-doctor-rsbuild
```

## Sử dụng

```ts
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginCssDoctor } from "@zealamic/css-doctor-rsbuild";

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

- Chỉ production build; hoạt động với Rspack bundler.
- Peer range @rsbuild/core >=1 được giữ rộng.
- CSS Modules và scoped styles của framework không bị động tới.

## Tài liệu đầy đủ

README dự án: [English](https://github.com/zealamic/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/README_CN.md)
