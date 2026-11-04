<div align="center">

# @zealakit/css-doctor-cli

**Công cụ chẩn đoán CSS trên terminal bằng engine native css-doctor.**

[English](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/packages/cli/README_CN.md)

</div>

---

![css doctor](https://github.com/zealakit/css-doctor/blob/main/assets/images/css-doctor.jpg)

## CLI làm gì?

`css-doctor check` đọc một hoặc nhiều file CSS, parse bằng engine LightningCSS
native, rồi in báo cáo trên terminal (hoặc JSON cho CI).

Đây là công cụ **chẩn đoán**. Nó **không** ghi đè file, không minify, và không
chia stylesheet theo page. Muốn tối ưu lúc build, dùng adapter Vite / Next /
Nuxt / Rsbuild / Remix.

CLI báo cáo các loại issue:

| Loại | Ý nghĩa |
| --- | --- |
| `syntax` | Cảnh báo cú pháp từ LightningCSS |
| `empty-rule` | Rule không có declaration và không có nested rule (ứng viên dead code) |
| `duplicate-selector` | Cùng một selector xuất hiện ở nhiều rule |
| `threshold` | Số selector trong file vượt `--threshold` |

## Yêu cầu

- Node.js **≥ 18**
- Binary native `@zealakit/css-doctor-binding` phù hợp nền tảng (cài kèm package
  trên macOS / Linux / Windows x64 được hỗ trợ)

## Cài đặt

### Chạy một lần (không cần cài)

```bash
npx @zealakit/css-doctor-cli check "src/**/*.css"
```

### Cài vào project

```bash
pnpm add -D @zealakit/css-doctor-cli

# hoặc
npm install -D @zealakit/css-doctor-cli
yarn add -D @zealakit/css-doctor-cli
```

Sau khi cài, gọi binary `css-doctor`:

```bash
pnpm exec css-doctor --help
# npm
npx css-doctor --help
```

### Script trong package.json

```json
{
  "scripts": {
    "css:check": "css-doctor check \"src/**/*.css\"",
    "css:check:ci": "css-doctor check \"src/**/*.css\" --json --threshold 500"
  }
}
```

```bash
pnpm css:check
```

## Bắt đầu nhanh

```bash
# Trợ giúp / phiên bản
css-doctor --help
css-doctor --version
css-doctor check --help
css-doctor health --help

# Một file
css-doctor check src/styles/app.css

# Nhiều file
css-doctor check src/a.css src/b.css

# Glob — nhớ quote để shell không expand trước
css-doctor check "src/**/*.css"

# Trộn path và glob
css-doctor check styles/global.css "components/**/*.css"

# CSS Health Score
css-doctor health "src/**/*.css"
css-doctor health "src/**/*.css" --json
css-doctor health "src/**/*.css" --fail-under 80
css-doctor check "src/**/*.css" --fail-under 85

# Baseline + regression
css-doctor baseline create "src/**/*.css"
css-doctor baseline show
css-doctor diff "src/**/*.css" --fail-on-regression

# Optimization intelligence
css-doctor optimize "src/**/*.css" --dry-run --explain --json
css-doctor fix --list
css-doctor fix "src/**/*.css" --dry-run --rule dead.empty-rule
```

## Lệnh: `check`

```text
css-doctor check [patterns...] [options]
```

| Tham số / tùy chọn | Mô tả |
| --- | --- |
| `patterns...` | Một hoặc nhiều đường dẫn file CSS hoặc glob. **Bắt buộc.** |
| `-j, --json` | In JSON `CheckReport` ra stdout (dùng cho CI) |
| `--threshold <n>` | Cảnh báo khi file có hơn `<n>` selector (`n` là số nguyên ≥ 0) |
| `--fail-under <n>` | Exit `1` khi Health Score tổng thể `< n` (0–100) |
| `-v, --version` | In phiên bản CLI |
| `-h, --help` | In trợ giúp |

### Mẹo dùng glob

- Luôn quote glob: `"src/**/*.css"`. Nếu không quote, shell có thể expand `*`
  trước khi css-doctor nhận pattern.
- Tự bỏ qua `node_modules` và `.git`.
- Path literal chứa ký tự glob (ví dụ `src/[slug].css`) vẫn hoạt động nếu file
  tồn tại và bạn truyền đúng đường dẫn file.

### Ví dụ output terminal

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
    …

 WARNING  src/legacy.css · 48.1 KB
  selectors 612 · rules 540 · declarations 1 204
  Diagnostics
    • empty-rule — Rule ".unused" has no declarations…
    • duplicate-selector — Selector ".btn" is defined in multiple rules…
────────────────────────────────────────────────────────────────
 files 2 · analyzed 2 · issues 2 · …
```

Trạng thái:

| Status | Khi nào |
| --- | --- |
| `SUCCESS` | Phân tích OK, không có issue |
| `WARNING` | Phân tích OK, có syntax / empty-rule / duplicate / threshold |
| `ERROR` | Không đọc/analyze được file, hoặc lỗi setup |

## CI và JSON

```bash
css-doctor check "src/**/*.css" --json
css-doctor check "src/**/*.css" -j --threshold 500
```

`--json` xuất `CheckReport` ổn định (`schemaVersion: 1`) gồm:

- `success` — `true` chỉ khi setup OK và mọi file khớp đều analyze được
- `errors` — lỗi setup nghiêm trọng (không có pattern, không khớp file, không
  load được binding, …)
- `files[]` — từng file: path, size, timing, `issues`, và `result` native khi `ok`
- `summary` — tổng hợp (files, selectors, warnings, timing, …)

Lưu report:

```bash
css-doctor check "src/**/*.css" --json > css-doctor-report.json
```

### Exit code (`check`)

| Code | Ý nghĩa |
| --- | --- |
| `0` | Setup OK và mọi file khớp đều đọc + analyze được (warning vẫn được phép) |
| `1` | Lỗi setup, không khớp file, không load binding, file đọc/analyze thất bại, hoặc `--fail-under` không đạt |

Warning / hint **không** làm fail process trừ khi bạn cũng đặt `--fail-under`.
Muốn gate CI theo warning, dùng `--json` rồi kiểm tra `summary.issues` /
`files[].issues`.

`check --json` còn kèm field `health` (CSS Health Score tổng hợp).

## Lệnh: `health`

```text
css-doctor health [patterns...] [options]
```

Tính **CSS Health Score** (0–100) theo năm chiều:

| Chiều | Trọng số | Đo lường |
| --- | ---: | --- |
| Selector Complexity | 20% | Specificity cao, combinator/nesting sâu, chuỗi dài |
| Duplicate Rules | 20% | Selector lặp / declaration trùng trong cùng rule |
| CSS Size Efficiency | 20% | Sheet lớn, rule nặng, áp lực số selector |
| Dead CSS | 25% | Rule rỗng, cú pháp bị bỏ qua khi recover |
| Variable Consistency | 15% | Định nghĩa trùng / `var()` thiếu (heuristic) |

Xếp hạng: **A** 90–100 · **B** 80–89 · **C** 70–79 · **D** 60–69 · **F** 0–59.

| Tùy chọn | Mô tả |
| --- | --- |
| `-j, --json` | JSON health ổn định (`schemaVersion: 1`) |
| `--threshold <n>` | Ánh xạ sang ngưỡng `manySelectors` |
| `--fail-under <n>` | Exit `1` khi overall `< n` (cổng CI) |

Điểm **không** đảm bảo CSS đúng về mặt hình ảnh runtime. Finding kiểu
unused-variable được gắn `heuristic` khi bằng chứng tĩnh chưa đủ.

### GitHub Actions (ví dụ)

```yaml
- name: CSS diagnostics
  run: pnpm exec css-doctor check "src/**/*.css" --json --threshold 800

- name: CSS health gate
  run: pnpm exec css-doctor health "src/**/*.css" --fail-under 80

- name: CSS regression gate
  run: pnpm exec css-doctor diff "src/**/*.css" --fail-on-regression --fail-on-new-errors
```

Hãy khởi tạo và commit `.css-doctor/baseline.json` trên nhánh mặc định trước khi
bật regression gate.

## Lệnh: `baseline`

```text
css-doctor baseline create|show|validate|remove [options]
```

Tạo baseline JSON có version (mặc định `.css-doctor/baseline.json`) gồm điểm
Health Score, fingerprint file/diagnostic (không lưu source CSS).

| Subcommand | Mục đích |
| --- | --- |
| `create [patterns...]` | Analyze CSS và ghi baseline (`-o/--output` để đổi path) |
| `show` | Hiển thị metadata và điểm |
| `validate` | Kiểm tra tương thích schema |
| `remove` | Xóa file baseline |

## Lệnh: `diff`

```text
css-doctor diff [patterns...] [options]
```

So sánh phân tích hiện tại với baseline; status:
`healthy` | `improved` | `regressed` | `mixed` | `inconclusive`.

| Tùy chọn | Mô tả |
| --- | --- |
| `-b, --baseline <path>` | Path baseline (mặc định `.css-doctor/baseline.json`) |
| `--fail-on-regression` | Exit `1` khi status `regressed` hoặc `mixed` |
| `--fail-on-new-errors` | Exit `1` khi có diagnostic error mới |
| `--fail-on-new-diagnostics` | Exit `1` khi có bất kỳ diagnostic mới |
| `--max-size-increase <n%>` | Fail khi tổng byte CSS tăng vượt phần trăm |
| `--max-new-errors <n>` / `--max-new-warnings <n>` | Giới hạn số issue mới |
| `--min-score <n>` | Fail khi overall hiện tại `< n` |
| `-v, --verbose` / `-j, --json` | Chi tiết / JSON ổn định (`schemaVersion: 1`) |

Diagnostic được khớp bằng fingerprint `code|path|selector|severity` nên lệch số
dòng không làm mọi finding trở thành “mới”.

Config tùy chọn: `.css-doctor/config.json`. **Thứ tự ưu tiên:** flag CLI >
config > mặc định.

## Lệnh: `optimize` / `split` / `fix`

- `optimize` / `split`: báo cáo tối ưu + giải thích quyết định; mặc định dry-run;
  `--write --out-dir` để ghi chunk.
- Metric tách byte loại bỏ khỏi byte phân tán do split.
- `fix --list` / `fix --dry-run` / `fix --write`: chỉ áp dụng fix **Safe**
  (`dead.empty-rule`, `duplicate.declaration`). Review/Unsafe không áp dụng im lặng.

## An toàn và giới hạn

- Tên binary: `css-doctor` (trường `bin` của package).
- CLI **phân tích** và **chấm điểm** CSS. Page-coverage split / size budget /
  tách biến cho bundle thuộc adapter framework.
- CSS Modules / class động nằm ngoài phạm vi check tĩnh.
- Cần binary native đúng nền tảng; không cần Rust toolchain khi đã có prebuild.

## Tài liệu đầy đủ

README dự án: [English](https://github.com/zealakit/css-doctor/blob/main/README.md) | [Tiếng Việt](https://github.com/zealakit/css-doctor/blob/main/README_VI.md) | [简体中文](https://github.com/zealakit/css-doctor/blob/main/README_CN.md)
