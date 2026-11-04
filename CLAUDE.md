@AGENTS.md

## Claude Code specifics

- Use the single Claude router skill at `.claude/skills/css-doctor/SKILL.md`.
  It routes to the four canonical, vendor-neutral workflows in
  `.agents/skills/`:
  - `css-doctor-core` — Rust AST/splitter
  - `css-doctor-binding` — NAPI-RS bridge
  - `css-doctor-integrations` — CLI/Vite/Next
  - `css-doctor-verify` — full verification
- Keep `.claude/skills` to this one router. Edit workflows only in
  `.agents/skills`; do not duplicate them under `.claude`.
- Before changing a public Rust API, read the core and binding skills; the
  binding must be rebuilt before TypeScript tests.
- Keep generated files (`packages/binding/index.*`, `*.node`, `dist/`, `.next/`,
  `target/`) out of edits and commits.
- When done, report exact commands run and any known limitations. Common CSS is
  linked from HTML or `@import` wrappers; page CSS is loaded from a JS loader
  prepended to each page chunk (not every-route HTML preload links).
