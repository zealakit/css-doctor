# Naming and coding conventions

## Rule 1: kebab-case everywhere

All new files and directories use kebab-case:

```text
nav-bar.tsx
page-dashboard.vue
island-react.tsx
styles-global.scss
module-react.module.scss
css-doctor-vite
vite-react-tailwind
```

Do not use PascalCase or camelCase for file or folder names, including React,
Vue, Svelte, Solid, and Preact components. Component identifiers remain
PascalCase inside code.

Framework/tool-mandated exceptions:

- `package.json`, `tsconfig.json`, `turbo.json`, `pnpm-lock.yaml`, `Cargo.toml`,
  `Cargo.lock`, `biome.json`, `.gitignore`, `README.md`, `AGENTS.md`.
- `vite.config.*`, `tsup.config.*`, `next.config.*`, `postcss.config.*`,
  `tailwind.config.*`, `cssd.config.*`.
- Next.js route files: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`,
  `not-found.tsx`, `route.ts`, `template.tsx`.
- Rust module files: snake_case (`lib.rs`, `splitter.rs`, `build.rs`).
- Generated files: `index.js`, `index.d.ts`, `index.d.cts`, `*.node`.
- Skill contract files: `SKILL.md` is permitted by the agent-skill convention.

When adding a file or folder outside these exceptions, rename it and update all
imports/configs in the same change.

## Rule 2: type-only TypeScript

Use `type` aliases for object shapes. Never use `interface` in project source.

```ts
export type CssDoctorRemixOptions = {
  sizeBudget?: SizeBudgetOptions;
  minify?: boolean;
};
```

Use type-only imports and exports explicitly:

```ts
import type { CssDoctorRemixOptions } from "./types";

export type * from "./types";
```

Biome enforces `style/useConsistentTypeDefinitions` with `"style": "type"`.

Generated NAPI declarations may contain interfaces; do not edit or rewrite them.

## Rule 3: CSS variable prefixes

Internal engine/UI variables use the `--zl-*` prefix:

```css
:root {
  --zl-app-bg: #090d16;
  --zl-panel-border: rgba(255, 255, 255, 0.08);
}
```

Do not introduce unprefixed internal variables in new engine code. Existing
consumer/example variables may keep their semantic names when they are part of
the fixture contract.

## Rule 4: package names and imports

- Published packages: `@zealakit/css-doctor-*`.
- Local workspace dependencies: `"workspace:*"`.
- Adapter packages expose ESM (and CJS where already established) through
  `package.json` `exports`.
- Prefix integration warnings/logs with `[css-doctor]` or
  `[css-doctor:<adapter>]`.
- Public option types live in `src/types.ts`; never inline a duplicate public
  option shape in an adapter.

## Rule 5: code style

- ESM, strict TypeScript, `moduleResolution: Bundler` for consumers.
- Two-space indentation, double quotes in JS/TS/JSON.
- Avoid barrel files unless the package already uses one.
- Keep error handling at boundaries; do not throw from CSS optimization hooks.
- Tests use `tsx --test` or the package's established runner.
- Do not add hand-written `.js`/`.cjs`/`.mjs` project source. Tool configs and
  generated NAPI loaders are exceptions.
