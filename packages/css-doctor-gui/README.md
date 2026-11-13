# css-doctor-gui

Local **CSS Analysis & Optimization Report Viewer** for CSS Doctor.

Phase 7/8: CLI JSON envelopes are the source of truth. Install this package
optionally next to `@zealakit/css-doctor-cli`, then open the viewer with
`css-doctor gui`. See [`docs/report-contract.md`](../../docs/report-contract.md).

## Install

```bash
pnpm add -D @zealakit/css-doctor-gui
# with the CLI executable:
pnpm add -D @zealakit/css-doctor-cli css-doctor-gui
```

There is **no** npm package named `css-doctor`. The executable name is
`css-doctor` from `@zealakit/css-doctor-cli`.

## Usage

```bash
css-doctor gui
css-doctor gui --port 4173
css-doctor gui --no-open
css-doctor gui --strict-port
css-doctor gui --report ./report.json
css-doctor gui --desktop
```

You can also run the package binary directly:

```bash
pnpm exec css-doctor-gui --help
```

## Architecture

```
React SPA (src/)  --HTTP-->  Node server (server/)  --NAPI-->  binding/core
                ^
                |
         Tauri webview (optional desktop shell)
                |
         spawns Node sidecar, kills on exit
```

- Frontend never imports Node, NAPI, or Tauri APIs.
- Web mode does **not** require Tauri.
- Desktop mode reuses the same production Node server + SPA (Option B).
- Core/CLI analysis logic is not duplicated in the GUI.

### Public API (for CLI)

Package exports (`@zealakit/css-doctor-gui` / `@zealakit/css-doctor-gui/server`):

| Export | Role |
| --- | --- |
| `startGuiServer(options)` | Start Web runtime; returns `{ url, host, port, close }` |
| `launchDesktopApp()` | Launch Desktop binary/app when built |
| `resolveDesktopApp()` | Resolve Desktop path without launching |

Assets resolve from the installed package directory (`dist/` next to
`dist-server/`), not from the consumer working directory.

## Web mode (default)

```bash
pnpm --filter @zealakit/css-doctor-gui build   # monorepo
css-doctor gui
css-doctor gui --port 4200 --no-open --strict-port
```

- Binds `127.0.0.1` (default port `4193`, fallback `4194–4293` unless strict/custom).
- Serves production `dist/` + JSON APIs from `dist-server/`.
- Graceful shutdown on Ctrl+C.

## Desktop mode (optional)

Requires Rust toolchain + Tauri CLI, then:

```bash
pnpm --filter @zealakit/css-doctor-gui add -D @tauri-apps/cli@2   # once
pnpm --filter @zealakit/css-doctor-gui desktop:build
css-doctor gui --desktop
```

- `--desktop` launches a built app/binary; it does **not** fall back to Web.
- Set `CSS_DOCTOR_GUI_DESKTOP` to override the app path.
- Sidecar needs Node.js on `PATH` (or `CSS_DOCTOR_GUI_NODE`).
- Platform packaging configs exist for macOS/Windows/Linux; only the host you
  build on is verified.

## Security model

- Loopback Host required.
- No CORS (`Access-Control-Allow-Origin` never set).
- Mutating APIs reject non-loopback `Origin` / `Referer` and `Sec-Fetch-Site: cross-site`.
- Static path traversal blocked.
- Upload body capped at 8 MiB; other JSON bodies smaller.
- Logs never include report contents; paths are basename-redacted.
- Tauri capabilities are least-privilege (no shell/FS IPC for the frontend).

## Report compatibility

| Command JSON | Sections |
| --- | --- |
| `check` | Overview, Diagnostics, Analysis, Files |
| `health` | Overview, Diagnostics |
| `optimize` / `split` | Optimization, Splitting, Files |
| `diff` | Regression, Files |

Persist from CLI (opt-in):

```bash
css-doctor check 'src/**/*.css' --json --save
# → .css-doctor/reports/check-latest.json (success only)
css-doctor optimize 'src/**/*.css' --json --out ./run.json
```

GUI Overview discovers `*-latest.json` under `.css-doctor/reports/` for the
project cwd; open/reload still requires an explicit load (no silent swap).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `CSS Doctor GUI is not installed` | `pnpm add -D @zealakit/css-doctor-gui` |
| Frontend build not found | Rebuild/reinstall so packaged `dist/` exists |
| Port in use | omit `--port` for fallback, or `--strict-port` + free the port |
| `--desktop` fails | build desktop app, or omit `--desktop` for Web |
| Want analysis data | run `css-doctor check|optimize|…` first; GUI does not re-analyze |

## Compatibility

- CLI report JSON `schemaVersion: 1` only (unsupported versions fail closed).
- Pair with `@zealakit/css-doctor-cli` / `@zealakit/css-doctor-binding` at the
  same minor line when possible (`1.1.x`).
- Adapters (`@zealakit/css-doctor-vite`, Next, …) are independent of this package.

## Release readiness

- Checklist: [`docs/gui-release-checklist.md`](../../docs/gui-release-checklist.md)
- Readiness decision: [`docs/gui-release-readiness.md`](../../docs/gui-release-readiness.md)
- Changelog: [`docs/gui-changelog.md`](../../docs/gui-changelog.md)
- Pack consumer smoke (no publish):
  `node packages/css-doctor-gui/scripts/verify-consumer-pack.mjs`
