# css-doctor-gui

Local **CSS Analysis & Optimization Report Viewer** for CSS Doctor.

Phase 6 focuses on release readiness: production Web packaging, Tauri Desktop
(Option B Node sidecar), security hardening, and distribution docs.

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

## Web mode (default, verified)

```bash
pnpm --filter css-doctor-gui build
css-doctor gui
css-doctor gui --port 4200 --no-open --strict-port
css-doctor gui --report ./report.json
```

- Binds `127.0.0.1` (default port `4193`, fallback `4194–4293` unless strict/custom).
- Serves production `dist/` + JSON APIs from `dist-server/`.
- Graceful shutdown on Ctrl+C.

## Desktop mode (partially verified)

Requires Rust toolchain + Tauri CLI, then:

```bash
pnpm --filter css-doctor-gui add -D @tauri-apps/cli@2   # once
pnpm --filter css-doctor-gui desktop:build
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

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Frontend build not found | `pnpm --filter css-doctor-gui build` |
| Port in use | omit `--port` for fallback, or `--strict-port` + free the port |
| `--desktop` fails | build desktop app, or omit `--desktop` for Web |
| Sidecar health timeout | ensure `node` works; rebuild GUI; check firewall on loopback |

## Known limitations

- Desktop end-user installers are not CI-published yet.
- Desktop still depends on a local Node runtime for the sidecar.
- Native file dialogs are not required (browser file input works in webview).
- No telemetry, accounts, or cloud sync.

## Release checklist

See [`docs/gui-release-checklist.md`](../../docs/gui-release-checklist.md).
