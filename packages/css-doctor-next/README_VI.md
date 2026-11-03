<div align="center">

# @zealamic/css-doctor-next

**Tích hợp Next.js App Router và Pages Router cho css-doctor.**

[English](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-next/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-next/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/packages/css-doctor-next/README_CN.md)

</div>

---


> **DEPRECATED:** `@zealamic/css-doctor-next` đã chuyển sang [`@zealakit/css-doctor-next`](https://www.npmjs.com/package/@zealakit/css-doctor-next).
>
> Cài package mới: `pnpm add -D @zealakit/css-doctor-next`
>
> Docs hiện hành: https://github.com/zealakit/css-doctor
>
> Các package `@zealamic` vẫn giữ trên npm vì đã có download và không thể xóa an toàn. Chúng không còn được duy trì.

![css doctor](https://github.com/zealamic/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Cài đặt

```bash
pnpm add -D @zealamic/css-doctor-next
```

## Sử dụng

```ts
import { withCssDoctor } from "@zealamic/css-doctor-next";

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

- Giữ nguyên webpack callback cũ và chỉ áp dụng cho production client build.
- CSS Modules được tự động bỏ qua; common chunk vẫn được link qua @import wrapper.
- Peer range next >=13 được giữ rộng có chủ đích.

## Tài liệu đầy đủ

README dự án: [English](https://github.com/zealamic/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/README_CN.md)
