# CSS Doctor report contract (Phase 7)

Shared contract between CLI analysis runs and the GUI viewer. Prefers reuse of
existing CLI JSON envelopes over a second schema.

## 1. Architecture (audited + implemented)

### Pipeline

```
Adapters (Vite/Next/…)  →  pageUsage / CSS assets  →  Core via binding
CLI `check` / other     →  Core via binding         →  JSON/terminal stdout
                                                  →  optional --save / --out
CLI `gui`               →  runCheck once            →  check-gui-startup.json
                        →  startGuiServer(reportPath)
GUI                     →  GET /api/report (session) →  normalize → GuiReport
```

| Layer | Role |
| --- | --- |
| Adapters | Build-time optimize/split; **do not** write GUI/CLI report files |
| Core | Sole CSS analysis / health / optimize / regression engine |
| Binding | NAPI expose of Core results |
| CLI | Orchestrates runs (including `gui` auto-check); optional atomic persist |
| GUI | Read-only viewer of the CLI-preloaded report; does not re-analyze |

### Persistence

| Artifact | Path | Writer | Atomic? | Git |
| --- | --- | --- | --- | --- |
| Baseline fingerprint | `.css-doctor/baseline.json` | `baseline create` | Yes | Commit for regression gates |
| CLI config | `.css-doctor/config.json` | user / tooling | N/A | Optional commit |
| Latest analysis envelope | `.css-doctor/reports/<command>-latest.json` | CLI `--save` on success | Yes | Ignored (`**/.css-doctor/reports/`) |
| GUI startup envelope | `.css-doctor/reports/check-gui-startup.json` | `css-doctor gui` (every run) | Yes | Ignored |
| Explicit run envelope | path from `--out` / optimize `--report` | CLI | Yes | Depends on path |
| GuiReport session | in-memory HTTP session | GUI server preload | N/A | N/A |

Do **not** gitignore the entire `.css-doctor/` directory: baselines and config
are intentional project inputs. Only generated `reports/` (and temp/backup
siblings) belong in `.gitignore`.

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

## 4. GUI startup & read

- `css-doctor gui` resolves CSS patterns like other project-aware CLI commands
  (CLI args → `.css-doctor/config.json` `patterns` → baseline `config.patterns`),
  then probes documented candidates via `resolveCssFiles` only when they match
  real stylesheets.
- The CLI runs `runCheck` once, writes `check-gui-startup.json`, updates
  `check-latest.json` only on success, then starts the GUI with that path.
- GUI exposes `GET /api/report` for the preloaded session only.
- Manual load/upload/generate/discover routes are not part of the viewer API.
- Browser refresh re-fetches the session; it does not re-run check.

## 5. CLI ↔ GUI package integration (Phase 8)

- Executable: `css-doctor` from `@zealakit/css-doctor-cli`.
- Optional package: `@zealakit/css-doctor-gui` (peerDependency of the CLI, optional).
- `css-doctor gui` resolves `@zealakit/css-doctor-gui/server` from the **project**
  `node_modules` (then ancestors / CLI location). No hardcoded monorepo paths.
- Missing package → install hint (`pnpm add -D @zealakit/css-doctor-gui`, adapted by PM).
- GUI is loaded only when the `gui` command runs.

## 6. Selector analysis contract (Phase 4)

Nested under check envelopes as `selectorAnalysis` (independent of CLI
`schemaVersion`):

| Field | Notes |
| --- | --- |
| `schemaVersion` | Currently `1` (`SELECTOR_ANALYSIS_SCHEMA_VERSION`) |
| `completeness` | `full` \| `symbols-only` \| `legacy-class-only` \| `absent` |
| `metrics` | Aggregate counts from Core match rows (see below) |
| `selectors[]` | Per-selector definition + usage records (independent) |
| `symbols` | Optional class/id/tag/attribute bags for GUI columns |
| `scannedFiles` / `elementsScanned` / `notes` | Scan context |

### Metric counting rules

- **totalSelectors** — distinct selector texts.
- **totalDefinitions** — sum of definition occurrence counts (not usages).
- **confirmedUsages** / **confirmedMatchedElements** — only
  `confidence === "confirmed"`; partial/unresolved/unused contribute 0.
- **distinctUsageFiles** — unique paths from `usageByFile`; `null` when
  per-file paths are unavailable.
- **partialMatches** / **unresolvedSelectors** / **unusedSelectors** —
  selector counts by `status`.
- Definitions are never counted as usages. Partial matches are never confirmed
  usages. One source occurrence is not double-counted via overlapping extractors.

### Compatibility

| Envelope | GUI behavior |
| --- | --- |
| Has `selectorAnalysis` v1 | Normalize into `GuiCssAnalysis.selectorAnalysis` |
| Has only `classUsage.byClass` | `completeness: "legacy-class-only"`; empty `selectors[]` |
| Missing both | `selectorAnalysis: null` |
| Future `selectorAnalysis.schemaVersion` | Fail closed: `completeness: "absent"`, actionable note, no invented rows |

Canonical TypeScript helpers live in `@zealakit/css-doctor-shared`
(`buildSelectorAnalysisReport`, `parseSelectorAnalysis`). Rust Core remains
the source of truth for matching; CLI/GUI must not re-match.

### Adapters

Vite / Next / Rsbuild / Remix / Nuxt still pass **class token** `pageUsage` into
`optimizeCss` / `splitCssByPages` for page-coverage splitting. That path is
intentionally class-based and does **not** write CLI/GUI selector reports.
No adapter-local selector matching was added in Phase 4.

## 7. GUI Selector Explorer (Phase 5)

The GUI dashboard projects `selectorAnalysis` into a Selector Explorer:

- Overview metrics come from canonical `metrics` (no React recalculation).
- One unified table: Selector, Type, Status, Usages, Files, Created In, Used In.
- Expandable row details for partial/unresolved notes and limitations.
- Client-side search / category / status filters and sortable columns.
- Legacy `classUsage`-only reports remain viewable with
  `completeness: "legacy-class-only"` and an explicit limited-coverage banner.
- Refresh re-fetches the session report only; it does not re-run analysis.

## 8. Validation notes (Phase 6)

- Aggregate `selectorAnalysis.metrics` must reconcile with per-selector rows
  (confirmed usages only where `confidence === "confirmed"`).
- Core emits `usageByFile` paths for confirmed matches; aggregate
  `distinctUsageFiles` is derived from those paths (null only when paths are
  absent).
- Adapters are not required to emit `selectorAnalysis`; GUI startup does.

Coverage matrices: [`selector-analysis.md`](./selector-analysis.md).

## 9. Non-goals (Phase 7–8 / Phase 4–5)

- New GUI pages / editor / autofix execution
- Adapter GUI options (`gui.enabled`, hooks, …)
- Replacing CLI JSON with a new mega-schema
- Requiring Tauri for Web
- Database or background report service
- Making GUI a required CLI dependency
- Migrating page-coverage split off class tokens in this phase
