# css-doctor-gui changelog

## 1.1.1 (first public GUI release — candidate)

Not published yet. Version matches the current monorepo workspace (`1.1.1`).
npm registry currently has Core/CLI/adapters at `1.1.0`; `@zealakit/css-doctor-gui` has
never been published.

### Highlights

- Local **Web** report viewer for CSS Doctor CLI JSON (`check`, `health`,
  `optimize`, `split`, `diff`).
- Launch via optional package + CLI:
  - Install: `pnpm add -D @zealakit/css-doctor-gui` (with `@zealakit/css-doctor-cli`)
  - Run: `css-doctor gui` (executable from the CLI package — there is no npm
    package named `css-doctor`)
- Shared report contract with CLI (`schemaVersion: 1` envelopes; optional
  `--save` / `--out` → `.css-doctor/reports/<command>-latest.json`)
- Discover/load/upload/reload of reports; presentation projection (`GuiReport`)
  without inventing metrics
- Loopback-only HTTP server (`127.0.0.1`), Host/Origin guards, path-traversal
  protection, upload size limits
- Optional **Desktop** Tauri shell (Option B Node sidecar) — **not** claimed as
  production-ready for this first release unless built and verified on the
  target host

### Requirements

- Node.js `^20.19.0 || >=22.12.0` for the GUI package
- `@zealakit/css-doctor-binding` (native) for optional generate-check
- Web users do **not** need Rust or Tauri

### Non-goals / not included

- No CSS editor, live preview, or autofix execution from the GUI
- No cloud, accounts, telemetry, or AI
- Desktop installers are not shipped via npm; Web package has no Tauri runtime
  dependency

### Compatibility

| Component | Version / policy |
| --- | --- |
| CLI JSON report `schemaVersion` | `1` only (fail closed on unknown) |
| GUI presentation `schemaVersion` | `1` (separate namespace) |
| `@zealakit/css-doctor-cli` peer | optional `^1.1.1` |
| Adapters | Independent of GUI; no GUI options |

### Known limitations

- CSS Modules / dynamic class helpers may be incomplete in source scanning
  (same Core/CLI limitations)
- Desktop packaging requires a separate `desktop:build` and host toolchain
- First npm publish of `@zealakit/css-doctor-gui` still requires an explicit approve step
