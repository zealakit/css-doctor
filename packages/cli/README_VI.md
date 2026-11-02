<div align="center">

# @zealakit/css-doctor-cli

**Công cụ chẩn đoán CSS trên terminal bằng engine native css-doctor.**

[English](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Cài đặt

```bash
pnpm add -D @zealakit/css-doctor-cli
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

README dự án: [English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)
