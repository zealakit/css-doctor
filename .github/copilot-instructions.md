# css-doctor Copilot instructions

Read `AGENTS.md` first. For focused work, follow the skills in
`.agents/skills/`:

- `css-doctor-core` — Rust core/splitter
- `css-doctor-binding` — NAPI-RS
- `css-doctor-integrations` — CLI/Vite/Next
- `css-doctor-verify` — verification

Key guardrails:

- Do not edit generated `packages/binding/index.*`, `*.node`, `dist/`, `.next/`,
  or `target/` files.
- Build the native binding before TypeScript integration tests.
- Use Turborepo: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm test:cargo`.
- Task graph: binding → CLI/Vite/Next → examples/vite-react-tailwind.
- NAPI 2.x: use `f64`, not `f32`.
- Preserve error boundaries; diagnostics must not crash Vite/Next builds.
- Common CSS is linked from HTML or `@import` wrappers; page CSS is loaded from
  a JS loader prepended to each page chunk.
- Run the commands in `AGENTS.md` before proposing a change as complete.
