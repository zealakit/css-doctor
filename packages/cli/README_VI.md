<div align="center">

# @zealamic/css-doctor-cli

**Công cụ chẩn đoán CSS trên terminal bằng engine native css-doctor.**

[English](https://github.com/zealamic/css-doctor/blob/main/packages/cli/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/packages/cli/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/packages/cli/README_CN.md)

</div>

---


> **DEPRECATED:** `@zealamic/css-doctor-cli` đã chuyển sang [`@zealakit/css-doctor-cli`](https://www.npmjs.com/package/@zealakit/css-doctor-cli).
>
> Cài package mới: `pnpm add -D @zealakit/css-doctor-cli`
>
> Docs hiện hành: https://github.com/zealakit/css-doctor
>
> Các package `@zealamic` vẫn giữ trên npm vì đã có download và không thể xóa an toàn. Chúng không còn được duy trì.

![css doctor](https://github.com/zealamic/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Cài đặt

```bash
pnpm add -D @zealamic/css-doctor-cli
```

## Sử dụng

```bash
# Phân tích file hoặc glob có quote
pnpm exec css-doctor check "src/**/*.css"

# Output JSON cho CI/CD
pnpm exec css-doctor check "src/**/*.css" --json

# Cảnh báo khi file có hơn 500 selector
pnpm exec css-doctor check "src/**/*.css" --threshold 500
```

## An toàn và giới hạn

- Binary tên css-doctor, được expose qua trường bin của package.
- --json xuất schema CheckReport ổn định gồm files, issues và summary.
- Exit code khác 0 khi setup/read/analyze lỗi nghiêm trọng; warning vẫn hiện trong report.

## Tài liệu đầy đủ

README dự án: [English](https://github.com/zealamic/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealamic/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealamic/css-doctor/blob/main/README_CN.md)
