<div align="center">

# css-doctor

**Bộ công cụ chẩn đoán, phân tách và tối ưu CSS native cho các ứng dụng web hiện đại.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Rust](https://img.shields.io/badge/rust-stable-b7410e?logo=rust&logoColor=white)](https://www.rust-lang.org)

[English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## Tổng quan

`css-doctor` là bộ công cụ phân tích và tối ưu CSS được xây dựng trên lõi Rust
native sử dụng **LightningCSS AST**, kết nối với Node.js qua **NAPI-RS**.

Công cụ không chỉ minify. Nó giúp phát hiện selector lỗi, tìm CSS chết, hiểu
page coverage, tách biến CSS và chia nhỏ stylesheet quá lớn mà không làm hỏng
CSS Modules hay scoped styles của framework.

Dự án cung cấp CLI zero-config, native binding và adapter chính thức cho Vite,
Next.js, Nuxt, Remix và Rsbuild.

---

## Tính năng nổi bật

### Hiệu năng Rust native

Parse, trích xuất selector, chẩn đoán và phân tách CSS đều chạy trong Rust core.
Bề mặt Node.js chỉ là cầu nối NAPI-RS mỏng, nên phân tích vẫn nhanh với
stylesheet lớn.

### CLI zero-config

Chạy `css-doctor` ngay bằng `npx`, hoặc cài làm dev dependency. CLI đã bundle
các JavaScript dependency; chỉ native binding được giữ external và require
động lúc runtime.

### Chẩn đoán toàn diện + CSS Health Score

CLI báo cáo:

- cảnh báo cú pháp;
- rule rỗng hoặc dead rule;
- selector trùng lặp;
- stylesheet quá lớn và ngưỡng selector;
- số selector, rule, declaration và thời gian phân tích;
- **CSS Health Score** (0–100) theo năm chiều có trọng số;
- **baseline và phát hiện regression** (`baseline` / `diff`) cho quality gate CI;
- **optimization intelligence** (`optimize` / `split` / `fix`) với giải thích,
  dry-run và autofix Safe;
- JSON cho CI (`check`, `health`, `baseline`, `diff`, `optimize`, `fix`).

### Native binary đa nền tảng

`@zealakit/css-doctor-binding` tự phân giải binary NAPI dựng sẵn cho:

| Nền tảng | Kiến trúc     | Target           |
| -------- | ------------- | ---------------- |
| macOS    | Apple Silicon | `darwin-arm64`   |
| macOS    | Intel         | `darwin-x64`     |
| Linux    | x64 glibc     | `linux-x64-gnu`  |
| Linux    | x64 musl      | `linux-x64-musl` |
| Windows  | x64 MSVC      | `win32-x64-msvc` |

Không cần Rust toolchain trên nền tảng có binary hỗ trợ.

### Tối ưu CSS theo framework

Các integration hỗ trợ page-coverage splitting, size budget, variables
isolation, dead-code elimination và xử lý an toàn CSS Modules, Vue scoped,
Svelte scoped, Astro scoped.

---

## Bắt đầu nhanh — CLI

CLI gồm **chẩn đoán tĩnh**, Health Score, baseline/regression, preview tối ưu
(dry-run) và autofix Safe. Việc **emit CSS lúc build** (gắn chunk vào HTML/JS)
vẫn thuộc adapter framework.

Hướng dẫn CLI đầy đủ:
[`packages/cli/README_VI.md`](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README_VI.md)
([English](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README.md) ·
[简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README_CN.md)).

### Chạy không cần cài

```bash
npx @zealakit/css-doctor-cli check "src/**/*.css"
```

### Cài làm dev dependency

```bash
pnpm add -D @zealakit/css-doctor-cli

# hoặc
npm install -D @zealakit/css-doctor-cli
```

Script gợi ý trong `package.json`:

```json
{
  "scripts": {
    "css:check": "css-doctor check \"src/**/*.css\"",
    "css:check:ci": "css-doctor check \"src/**/*.css\" --json --threshold 500"
  }
}
```

### Bảng lệnh thường dùng

```bash
# Trợ giúp và phiên bản
css-doctor --help
css-doctor --version
css-doctor check --help

# Một file hoặc nhiều path
css-doctor check src/styles/app.css
css-doctor check src/a.css src/b.css

# Glob — luôn quote để shell không expand trước
css-doctor check "src/**/*.css"

# Trộn file và glob
css-doctor check styles/global.css "components/**/*.css"

# CI: JSON (+ ngưỡng selector tùy chọn)
css-doctor check "src/**/*.css" --json
css-doctor check "src/**/*.css" -j --threshold 500

# CSS Health Score
css-doctor health "src/**/*.css"
css-doctor health "src/**/*.css" --json
css-doctor health "src/**/*.css" --fail-under 80
css-doctor check "src/**/*.css" --fail-under 85

# Baseline + regression (commit baseline trên main)
css-doctor baseline create "src/**/*.css"
css-doctor baseline show
css-doctor diff "src/**/*.css" --fail-on-regression --max-size-increase 10%

# Optimization intelligence (dry-run mặc định)
css-doctor optimize "src/**/*.css" --dry-run --explain
css-doctor fix --list
css-doctor fix "src/**/*.css" --dry-run --rule dead.empty-rule
```

| Cờ | Mục đích |
| --- | --- |
| `-j, --json` | Xuất JSON ổn định (`check`, `health`, `baseline`, `diff`) |
| `--threshold <n>` | Cảnh báo / áp lực size khi file có hơn `<n>` selector |
| `--fail-under <n>` | (`check` / `health`) Exit `1` khi overall `< n` |
| `--fail-on-regression` | (`diff`) Exit `1` khi status là `regressed` hoặc `mixed` |
| `--max-size-increase <n%>` | (`diff`) Fail khi tổng kích thước CSS tăng vượt hạn mức |
| `-v, --version` | In phiên bản CLI |
| `-h, --help` | In trợ giúp |

`check` báo cáo: `syntax`, `empty-rule`, `duplicate-selector`, tùy chọn
`threshold`, kèm field `health`. Exit code `0` khi mọi file khớp đều analyze
được (vẫn cho phép warning); `1` khi lỗi setup/đọc/analyze hoặc `--fail-under`
không đạt.

`health` chấm selector complexity, duplicates, size efficiency, dead CSS và
variable consistency — tín hiệu chất lượng, không đảm bảo runtime/visual.

### Baseline và regression

Lưu snapshot có version tại `.css-doctor/baseline.json` (không lưu source CSS),
rồi so sánh pull request bằng `css-doctor diff`:

1. Trên `main`: `css-doctor baseline create "src/**/*.css"` và commit file.
2. Trên PR: `css-doctor diff --fail-on-regression --fail-on-new-errors`.
3. Sau thay đổi CSS cố ý: tạo lại baseline và commit.

Config tùy chọn: `.css-doctor/config.json` (flag CLI > config > mặc định).
Adapter framework tái sử dụng health engine; persistence baseline thuộc CLI/CI.

### Optimization intelligence

`optimize` / `split` giải thích quyết định pipeline từ metadata đo được (không
bịa coverage). Metric tách byte **loại bỏ** khỏi byte **phân tán** do split.
`fix` chỉ áp dụng transform **Safe** mặc định; Review/Unsafe không bao giờ
áp dụng im lặng. Dry-run không ghi file.

Ví dụ output terminal:

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
```

---

## Tích hợp framework

| Framework / tool                   | Package                                                                                      | Cài đặt                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Vite, React, Vue, Svelte, TanStack | [`@zealakit/css-doctor-vite`](https://www.npmjs.com/package/@zealakit/css-doctor-vite)       | `pnpm add -D @zealakit/css-doctor-vite`    |
| Next.js App/Pages Router           | [`@zealakit/css-doctor-next`](https://www.npmjs.com/package/@zealakit/css-doctor-next)       | `pnpm add -D @zealakit/css-doctor-next`    |
| Nuxt 4                             | [`@zealakit/css-doctor-nuxt`](https://www.npmjs.com/package/@zealakit/css-doctor-nuxt)       | `pnpm add -D @zealakit/css-doctor-nuxt`    |
| Remix 3                            | [`@zealakit/css-doctor-remix`](https://www.npmjs.com/package/@zealakit/css-doctor-remix)     | `pnpm add @zealakit/css-doctor-remix`      |
| Rsbuild / Rspack                   | [`@zealakit/css-doctor-rsbuild`](https://www.npmjs.com/package/@zealakit/css-doctor-rsbuild) | `pnpm add -D @zealakit/css-doctor-rsbuild` |
| CLI                                | [`@zealakit/css-doctor-cli`](https://www.npmjs.com/package/@zealakit/css-doctor-cli)         | `pnpm add -D @zealakit/css-doctor-cli`     |
| Native binding                     | [`@zealakit/css-doctor-binding`](https://www.npmjs.com/package/@zealakit/css-doctor-binding) | Cài tự động qua dependency                 |

Mỗi thư mục package có README tiếng Anh, tiếng Việt và tiếng Trung. Bản dịch
root vẫn có tại [English](./README.md) và [简体中文](./README_CN.md).

### Vite

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { cssDoctor } from "@zealakit/css-doctor-vite";

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
      minify: true,
      report: true,
    }),
  ],
});
```

### Next.js

```js
// next.config.mjs
import { withCssDoctor } from "@zealakit/css-doctor-next";

export default withCssDoctor(
  {
    reactStrictMode: true,
  },
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
    minify: true,
    report: true,
  },
);
```

### Khả năng của adapter

| Adapter                 | Page coverage | Size budget | Variables isolation | Dead code |
| ----------------------- | ------------- | ----------- | ------------------- | --------- |
| Vite / Astro / TanStack | Có            | Có          | Có                  | Có        |
| Next.js                 | Có            | Có          | Có                  | Có        |
| Nuxt 4                  | Có            | Có          | Có                  | Có        |
| Rsbuild / Rspack        | Có            | Có          | Có                  | Có        |
| Remix 3 runtime         | Không         | Có          | Có                  | Không     |

Remix 3 không có page-to-CSS dependency graph lúc build. Middleware dùng
`sizeBudget`, `isolateVariables`, `minify` và response cache thay vì page
coverage runtime.

---

## Tham chiếu cấu hình

| Tùy chọn                      | Kiểu                   | Mặc định                 | Mô tả                                              |
| ----------------------------- | ---------------------- | ------------------------ | -------------------------------------------------- |
| `pageCoverage.enabled`        | `boolean`              | `true`                   | Bật phân loại coverage theo route.                 |
| `pageCoverage.minPageRatio`   | `number`               | `0.5`                    | Tỷ lệ page tối thiểu (`0.0`–`1.0`) cho common CSS. |
| `pageCoverage.forceCommon`    | `string[]`             | `[]`                     | Selector/class luôn giữ trong common chunk.        |
| `sizeBudget.enabled`          | `boolean`              | `true`                   | Bật chia nhỏ theo byte budget.                     |
| `sizeBudget.maxChunkSize`     | `number`               | `60 * 1024`              | Số byte tối đa mỗi chunk.                          |
| `sizeBudget.isolateVariables` | `boolean`              | `true`                   | Tách biến `:root` và Tailwind `@theme` trước.      |
| `minify`                      | `boolean`              | giá trị production/build | Minify CSS bằng LightningCSS.                      |
| `report`                      | `boolean`              | `true`                   | In chẩn đoán coverage và split.                    |
| `exclude`                     | `(string \| RegExp)[]` | Safety rule CSS Modules  | Bỏ qua asset khớp mẫu.                             |

Xem README của từng adapter để biết đầy đủ danh sách tùy chọn.

---

## Giấy phép

MIT. Xem [LICENSE](./LICENSE).
