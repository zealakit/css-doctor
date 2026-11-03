<div align="center">

# css-doctor (scope đã deprecated)

> **DEPRECATED:** Các package `@zealamic/css-doctor*` đã chuyển sang
> **`@zealakit/css-doctor*`**.
>
> Repo mới: [github.com/zealakit/css-doctor](https://github.com/zealakit/css-doctor) ·
> npm scope [`@zealakit`](https://www.npmjs.com/org/zealakit)

[English](./README.md) | [Tiếng Việt](./README_VI.md) | [简体中文](./README_CN.md)

</div>

---

## Vì sao scope này bị deprecated?

Dự án đã đổi npm scope từ `@zealamic` sang **`@zealakit`**.

Các package `@zealamic/css-doctor*` cũ vẫn còn trên npm vì đã có lượt download
và **không thể xóa/unpublish an toàn**. Chúng vẫn cài được để không phá lockfile
cũ, nhưng **không còn nhận tính năng hay bản sửa lỗi mới**.

Hãy chuyển sang package mới.

## Bảng mapping

| Deprecated (`@zealamic`) | Thay thế (`@zealakit`) |
| --- | --- |
| `@zealamic/css-doctor-binding` | [`@zealakit/css-doctor-binding`](https://www.npmjs.com/package/@zealakit/css-doctor-binding) |
| `@zealamic/css-doctor-cli` | [`@zealakit/css-doctor-cli`](https://www.npmjs.com/package/@zealakit/css-doctor-cli) |
| `@zealamic/css-doctor-vite` | [`@zealakit/css-doctor-vite`](https://www.npmjs.com/package/@zealakit/css-doctor-vite) |
| `@zealamic/css-doctor-next` | [`@zealakit/css-doctor-next`](https://www.npmjs.com/package/@zealakit/css-doctor-next) |
| `@zealamic/css-doctor-nuxt` | [`@zealakit/css-doctor-nuxt`](https://www.npmjs.com/package/@zealakit/css-doctor-nuxt) |
| `@zealamic/css-doctor-remix` | [`@zealakit/css-doctor-remix`](https://www.npmjs.com/package/@zealakit/css-doctor-remix) |
| `@zealamic/css-doctor-rsbuild` | [`@zealakit/css-doctor-rsbuild`](https://www.npmjs.com/package/@zealakit/css-doctor-rsbuild) |

(Các platform binding `*-darwin-*`, `*-linux-*`, `*-win32-*` cũng đổi scope tương tự.)

## Cách migrate

```bash
pnpm remove @zealamic/css-doctor-vite
pnpm add -D @zealakit/css-doctor-vite
```

```diff
- import { cssDoctor } from "@zealamic/css-doctor-vite";
+ import { cssDoctor } from "@zealakit/css-doctor-vite";
```

## Tài liệu hiện hành

- Source & docs: https://github.com/zealakit/css-doctor
- Issues: https://github.com/zealakit/css-doctor/issues

## License

MIT. Xem [LICENSE](./LICENSE).
