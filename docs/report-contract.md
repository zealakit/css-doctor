# CSS Doctor report contract (Phase 7)

Shared contract between CLI analysis runs and the GUI viewer. Prefers reuse of
existing CLI JSON envelopes over a second schema.

## 1. Architecture (audited + implemented)

### Pipeline

```
Adapters (Vite/Next/…)  →  pageUsage / CSS assets  →  Core via binding
CLI commands            →  Core via binding         →  JSON/terminal stdout
                                                  →  optional --save / --out
                                                  →  baseline under .css-doctor/
GUI                     →  discover / load / upload CLI JSON
                        →  normalize → GuiReport (presentation)
                        →  optional generate-check via binding (user action)
```

| Layer | Role |
| --- | --- |
| Adapters | Build-time optimize/split; **do not** write GUI/CLI report files |
| Core | Sole CSS analysis / health / optimize / regression engine |
| Binding | NAPI expose of Core results |
| CLI | Orchestrates runs; emits per-command JSON; optional atomic persist |
| GUI | Viewer: discover/load/validate/display; does not re-analyze to view |

### Persistence

| Artifact | Path | Writer | Atomic? |
| --- | --- | --- | --- |
| Baseline fingerprint | `.css-doctor/baseline.json` | `baseline create` | Yes |
| CLI config | `.css-doctor/config.json` | user / tooling | N/A |
| Latest analysis envelope | `.css-doctor/reports/<command>-latest.json` | CLI `--save` on success | Yes |
| Explicit run envelope | path from `--out` / optimize `--report` | CLI | Yes |
| GuiReport session | in-memory HTTP session | GUI server | N/A |
| Recent history | browser `localStorage` metadata | GUI | N/A |

## 2. Shared contract (reuse)

**Canonical source for the GUI:** CLI JSON envelopes with:

- `schemaVersion` (number; currently `1`)
- `command` (`check` | `health` | `optimize` | `split` | `diff`)
- Core-derived payloads already present on those envelopes

**Presentation projection:** `GuiReport` (`GUI_REPORT_SCHEMA_VERSION = 1`) via
`normalizeUnknownReport` in `packages/css-doctor-gui/shared/`. It is a
projection, not a second analysis schema.

Command shapes differ (not one mega-report):

- `check` — files + `analyzeCss` results + optional aggregated `health`
- `health` — health envelope (+ optional fail-under)
- `optimize` / `split` — per-file optimization reports + chunks
- `diff` — regression payload vs baseline
- `baseline` / `fix` — not loaded by GUI normalize today

### Missing / empty / unavailable

| Case | Representation |
| --- | --- |
| Section not in this command | `GuiReport` field `null` |
| Present but empty list | `[]` / empty object from Core/CLI |
| Unsupported CLI schema | load error `incompatible_schema` / `unsupported_format` |
| Incomplete / unreadable file | load error; previous session kept |

### Compatibility policy

- GUI accepts CLI `schemaVersion === 1` only.
- Unknown future versions fail closed (no silent migrate).
- Older envelopes missing optional sections stay viewable with `null` sections.
- CLI `schemaVersion` and GUI presentation `schemaVersion` are separate
  namespaces (both currently `1`).

## 3. Write lifecycle

`packages/cli/src/utils/report-io.ts` + `atomic-write.ts`:

1. Serialize envelope JSON.
2. Write temp file on the same filesystem.
3. Rename into place.
4. `--out` writes success **or** failure envelopes.
5. `--save` refreshes `<command>-latest.json` **only when** `success === true`
   (failed runs do not clobber the last good latest).

Stdout behavior is unchanged unless `--json` is set. Persist is opt-in.

## 4. GUI discovery & read

- `GET /api/report/discover?cwd=` lists `.css-doctor/reports/*-latest.json`
  (metadata only; bodies are not parsed until load).
- `POST /api/report/load` / upload / reload read a consistent file snapshot.
- Overview lists discovered project reports; user must open one explicitly
  (no silent swap of the viewed session).
- Generate-check remains an **optional** second analysis via binding; viewing
  a saved report never requires it.

## 5. CLI ↔ GUI package integration (Phase 8)

- Executable: `css-doctor` from `@zealakit/css-doctor-cli`.
- Optional package: `@zealakit/css-doctor-gui` (peerDependency of the CLI, optional).
- `css-doctor gui` resolves `@zealakit/css-doctor-gui/server` from the **project**
  `node_modules` (then ancestors / CLI location). No hardcoded monorepo paths.
- Missing package → install hint (`pnpm add -D @zealakit/css-doctor-gui`, adapted by PM).
- GUI is loaded only when the `gui` command runs.

## 6. Non-goals (Phase 7–8)

- New GUI pages / editor / autofix execution
- Adapter GUI options (`gui.enabled`, hooks, …)
- Replacing CLI JSON with a new mega-schema
- Requiring Tauri for Web
- Database or background report service
- Making GUI a required CLI dependency
