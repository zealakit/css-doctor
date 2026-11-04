---
name: css-doctor
description: Entry point for any css-doctor work across the Rust core, NAPI binding, CLI, Vite plugin, or Next.js integration. Routes to the focused canonical workflow for the task.
---

# css-doctor router (Claude Code)

Read `../../../AGENTS.md` first. Then read the canonical skill that matches the
task and follow it. Do not duplicate or edit these workflows inside
`.claude/skills`.

| Task | Canonical skill |
| --- | --- |
| Rust AST, selector extraction, usage matrix, splitter, DCE | `../../../.agents/skills/css-doctor-core/SKILL.md` |
| NAPI-RS types, JS/Rust mapping, rebuild, generated d.ts | `../../../.agents/skills/css-doctor-binding/SKILL.md` |
| CLI, Vite plugin, Next.js wrapper, page scanning | `../../../.agents/skills/css-doctor-integrations/SKILL.md` |
| Full verification, release checks, cache/graph checks | `../../../.agents/skills/css-doctor-verify/SKILL.md` |

Rules:

- Build the native binding before TypeScript integration tests.
- Use Turborepo: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm test:cargo`.
- Never edit generated `packages/binding/index.*`, `*.node`, `dist/`, `.next/`,
  or `target/` files.
- Preserve Vite/Next error boundaries; diagnostics must not crash builds.
- Common CSS is linked from HTML or `@import` wrappers; page CSS is loaded from
  a JS loader prepended to each page chunk.
