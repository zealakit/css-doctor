<div align="center">

# css-doctor (deprecated scope)

> **DEPRECATED:** The `@zealamic/css-doctor*` packages have moved to
> **`@zealakit/css-doctor*`**.
>
> New home: [github.com/zealakit/css-doctor](https://github.com/zealakit/css-doctor) ·
> npm scope [`@zealakit`](https://www.npmjs.com/org/zealakit)

[English](./README.md) | [Tiếng Việt](./README_VI.md) | [简体中文](./README_CN.md)

</div>

---

## Why this repository / scope is deprecated

The project was renamed from the `@zealamic` npm scope to **`@zealakit`**.

The old `@zealamic/css-doctor*` packages remain on npm because they already have
downloads and **cannot be safely deleted/unpublished**. They are kept installable
for existing lockfiles, but **no longer receive features or fixes**.

Please migrate to the new packages.

## Package mapping

| Deprecated (`@zealamic`) | Replacement (`@zealakit`) |
| --- | --- |
| `@zealamic/css-doctor-binding` | [`@zealakit/css-doctor-binding`](https://www.npmjs.com/package/@zealakit/css-doctor-binding) |
| `@zealamic/css-doctor-binding-darwin-arm64` | `@zealakit/css-doctor-binding-darwin-arm64` |
| `@zealamic/css-doctor-binding-darwin-x64` | `@zealakit/css-doctor-binding-darwin-x64` |
| `@zealamic/css-doctor-binding-linux-x64-gnu` | `@zealakit/css-doctor-binding-linux-x64-gnu` |
| `@zealamic/css-doctor-binding-linux-x64-musl` | `@zealakit/css-doctor-binding-linux-x64-musl` |
| `@zealamic/css-doctor-binding-win32-x64-msvc` | `@zealakit/css-doctor-binding-win32-x64-msvc` |
| `@zealamic/css-doctor-cli` | [`@zealakit/css-doctor-cli`](https://www.npmjs.com/package/@zealakit/css-doctor-cli) |
| `@zealamic/css-doctor-vite` | [`@zealakit/css-doctor-vite`](https://www.npmjs.com/package/@zealakit/css-doctor-vite) |
| `@zealamic/css-doctor-next` | [`@zealakit/css-doctor-next`](https://www.npmjs.com/package/@zealakit/css-doctor-next) |
| `@zealamic/css-doctor-nuxt` | [`@zealakit/css-doctor-nuxt`](https://www.npmjs.com/package/@zealakit/css-doctor-nuxt) |
| `@zealamic/css-doctor-remix` | [`@zealakit/css-doctor-remix`](https://www.npmjs.com/package/@zealakit/css-doctor-remix) |
| `@zealamic/css-doctor-rsbuild` | [`@zealakit/css-doctor-rsbuild`](https://www.npmjs.com/package/@zealakit/css-doctor-rsbuild) |

## Migrate

Swap the scope in `package.json` / imports, then reinstall:

```bash
# example: Vite adapter
pnpm remove @zealamic/css-doctor-vite
pnpm add -D @zealakit/css-doctor-vite

# example: CLI
pnpm remove @zealamic/css-doctor-cli
pnpm add -D @zealakit/css-doctor-cli
```

Update imports the same way:

```diff
- import { cssDoctor } from "@zealamic/css-doctor-vite";
+ import { cssDoctor } from "@zealakit/css-doctor-vite";

- import { withCssDoctor } from "@zealamic/css-doctor-next";
+ import { withCssDoctor } from "@zealakit/css-doctor-next";
```

API and behavior are the same project — only the npm scope and repository home
changed.

## Documentation

Use the active repository:

- Docs & source: https://github.com/zealakit/css-doctor
- Issues: https://github.com/zealakit/css-doctor/issues

## npm status

All `@zealamic/css-doctor*` packages are already marked **deprecated** on the
npm registry. Installs still work, but print a warning pointing to the matching
`@zealakit/css-doctor*` package.

## License

MIT. See [LICENSE](./LICENSE).
