# rsbuild-react-tailwind

Rsbuild 2 + React 19 + React Router 7 + Tailwind CSS v4 example for
`@zealakit/css-doctor-rsbuild`.

## Commands

```bash
pnpm --filter rsbuild-react-tailwind dev
pnpm --filter rsbuild-react-tailwind build
pnpm --filter rsbuild-react-tailwind preview
```

## Routes

- `/` — Home, lazy-loaded hero page.
- `/dashboard` — Dashboard, CSS Module metric cards.
- `/settings` — Settings, page-specific custom CSS.

## What it exercises

- Rsbuild production Rspack compilation
- React 19 with React Compiler
- React Router lazy route chunks
- Tailwind CSS v4 via `@import "tailwindcss"` and `@theme`
- css-doctor page-coverage and size-budget analysis
- CSS Module safety for `dashboard.module.css`
- Dead-code elimination for `.legacy-unused-table`
- Content-hashed CSS assets under `dist/static/css/`
