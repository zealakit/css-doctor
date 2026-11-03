<div align="center">

# css-doctor（已弃用的 scope）

> **DEPRECATED：** `@zealamic/css-doctor*` 包已迁移到
> **`@zealakit/css-doctor*`**。
>
> 新仓库：[github.com/zealakit/css-doctor](https://github.com/zealakit/css-doctor) ·
> npm scope [`@zealakit`](https://www.npmjs.com/org/zealakit)

[English](./README.md) | [Tiếng Việt](./README_VI.md) | [简体中文](./README_CN.md)

</div>

---

## 为什么弃用此 scope？

项目已将 npm scope 从 `@zealamic` 更改为 **`@zealakit`**。

旧的 `@zealamic/css-doctor*` 包仍保留在 npm 上，因为它们已有下载量，
**无法安全删除/unpublish**。它们仍可安装，以免破坏现有 lockfile，
但**不再接收新功能或修复**。

请迁移到新包。

## 包名对照

| 已弃用（`@zealamic`） | 替代（`@zealakit`） |
| --- | --- |
| `@zealamic/css-doctor-binding` | [`@zealakit/css-doctor-binding`](https://www.npmjs.com/package/@zealakit/css-doctor-binding) |
| `@zealamic/css-doctor-cli` | [`@zealakit/css-doctor-cli`](https://www.npmjs.com/package/@zealakit/css-doctor-cli) |
| `@zealamic/css-doctor-vite` | [`@zealakit/css-doctor-vite`](https://www.npmjs.com/package/@zealakit/css-doctor-vite) |
| `@zealamic/css-doctor-next` | [`@zealakit/css-doctor-next`](https://www.npmjs.com/package/@zealakit/css-doctor-next) |
| `@zealamic/css-doctor-nuxt` | [`@zealakit/css-doctor-nuxt`](https://www.npmjs.com/package/@zealakit/css-doctor-nuxt) |
| `@zealamic/css-doctor-remix` | [`@zealakit/css-doctor-remix`](https://www.npmjs.com/package/@zealakit/css-doctor-remix) |
| `@zealamic/css-doctor-rsbuild` | [`@zealakit/css-doctor-rsbuild`](https://www.npmjs.com/package/@zealakit/css-doctor-rsbuild) |

（各平台 binding `*-darwin-*`、`*-linux-*`、`*-win32-*` 同样更换 scope。）

## 如何迁移

```bash
pnpm remove @zealamic/css-doctor-vite
pnpm add -D @zealakit/css-doctor-vite
```

```diff
- import { cssDoctor } from "@zealamic/css-doctor-vite";
+ import { cssDoctor } from "@zealakit/css-doctor-vite";
```

## 当前文档

- 源码与文档：https://github.com/zealakit/css-doctor
- Issues：https://github.com/zealakit/css-doctor/issues

## License

MIT。见 [LICENSE](./LICENSE)。
