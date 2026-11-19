# css-doctor-gui

Local **CSS class usage report viewer** for CSS Doctor.

Single-page UI focused on class frequency and per-file occurrence counts from
CLI check JSON. Install optionally next to `@zealakit/css-doctor-cli`, then
open with `css-doctor gui`. See
[`docs/report-contract.md`](../../docs/report-contract.md).

## Install

```bash
pnpm add -D @zealakit/css-doctor-gui
# with the CLI executable:
pnpm add -D @zealakit/css-doctor-cli @zealakit/css-doctor-gui
```

There is **no** npm package named `css-doctor`. The executable name is
`css-doctor` from `@zealakit/css-doctor-cli`.

## Usage

```bash
css-doctor gui
css-doctor gui "src/**/*.css"
css-doctor gui --port 4173
css-doctor gui --no-open
css-doctor gui --strict-port
css-doctor gui --desktop
```

`css-doctor gui` always runs the existing CLI `check` once (unless you pass
`--report` to preload a JSON file without analyzing), then opens the viewer
with that run's report.

### CSS pattern resolution

Same project-aware contract as other CLI commands that read config, then
file discovery through the existing `resolveCssFiles` helper:

1. Patterns passed to `css-doctor gui …`
2. Else `patterns` in `.css-doctor/config.json`
3. Else `config.patterns` stored in the project baseline (when present)
4. Else the first documented candidate that matches files:
   `src/**/*.css`, `styles/**/*.css`, `*.css`, then `**/*.css`
   (same ignores as `check`: `node_modules`, `.git`)

If still nothing matches, the startup check fails with an actionable error.
The dashboard shows that error — it does not silently show an older report as
the current run.

You can also run the package binary directly (viewer only; no auto-check):

```bash
pnpm exec css-doctor-gui --help
```

## Architecture

```
css-doctor gui (CLI)
  → runCheck once
  → write .css-doctor/reports/check-gui-startup.json (+ check-latest on success; gitignored)
  → startGuiServer({ reportPath })
       → React SPA reads GET /api/report
```

- Frontend never imports Node, NAPI, or Tauri APIs.
- GUI does not generate or upload reports.
- Web mode does **not** require Tauri.
- Desktop mode reuses the same production Node server + SPA; analysis still
  runs once in the CLI before launch.

### Public API (for CLI)

| Export | Role |
| --- | --- |
| `startGuiServer(options)` | Start Web runtime; returns `{ url, host, port, close }` |
| `launchDesktopApp()` | Launch Desktop binary/app when built |
| `resolveDesktopApp()` | Resolve Desktop path without launching |

## Web mode (default)

```bash
pnpm --filter @zealakit/css-doctor-gui build   # monorepo
css-doctor gui "src/**/*.css"
css-doctor gui --port 4200 --no-open --strict-port
```

- Binds `127.0.0.1` (default port `4193`, fallback `4194–4293` unless strict/custom).
- Serves production `dist/` + JSON APIs from `dist-server/`.
- Graceful shutdown on Ctrl+C.

## Desktop mode (optional)

```bash
pnpm --filter @zealakit/css-doctor-gui desktop:build
css-doctor gui "src/**/*.css" --desktop
```

- `--desktop` launches a built app/binary; it does **not** fall back to Web.
- Analysis still runs once in the CLI before launch (no second check).

## Security model

- Loopback Host required.
- No CORS (`Access-Control-Allow-Origin` never set).
- Mutating APIs are not exposed for report management.
- Static path traversal blocked.
- Logs never include report contents; paths are basename-redacted.

## Report table

| Column | Source |
| --- | --- |
| Selector / Type | Symbol projection of Core `classes` / `ids` / `tags` / `attributes` |
| Created In | `analyzeCss` definition file paths (never inferred from usage) |
| Used In / Usages / Files | `classUsage.byClass|byId|byTag|byAttribute` from `css-doctor gui` markup scan |

Literal class / id / tag / attribute hits are confirmed. Pseudo-states (`:hover`, `:focus`), `cn`/`clsx`, and CSS Modules locals are not claimed as usage.

Refresh in the UI only re-fetches the session report. It does not re-analyze CSS.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `No CSS files or glob patterns were provided` | Pass globs or set `patterns` in `.css-doctor/config.json` |
| `CSS Doctor GUI is not installed` | `pnpm add -D @zealakit/css-doctor-gui` |
| Frontend build not found | Rebuild/reinstall so packaged `dist/` exists |
| Port in use | omit `--port` for fallback, or `--strict-port` + free the port |
| `--desktop` fails | build desktop app, or omit `--desktop` for Web |

## Compatibility

- CLI report JSON `schemaVersion: 1` only (unsupported versions fail closed).
- Pair with `@zealakit/css-doctor-cli` at the same minor when possible.
