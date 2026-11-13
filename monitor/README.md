# Dependency Monitor

Local web dashboard for viewing, comparing, and updating dependency versions in the **css-doctor** pnpm monorepo.

This folder is designed to be **copied into other repositories** with small, explicit adaptations. It has no framework UI (vanilla HTML + Pico CSS) and no extra npm dependencies beyond what the host repo already uses for Node/TypeScript.

## What it does

- Scans **root** `package.json` and every **`packages/*/package.json`**
- Shows declared ranges, lockfile-resolved versions (when available), and npm registry latest/patch/minor/major
- Groups dependencies into **one card per manifest** (Root, then each package)
- Lets you pick a target version per row and update individually or in bulk
- Generates an **AI upgrade prompt** (copy/paste into an external coding agent) — never calls an AI API itself

## What it never does

- Scan or modify `examples/**`
- Scan or modify Cargo/`crates/**` (Node manifests only in this port)
- Publish to npm
- Auto-upgrade on server start
- Accept arbitrary filesystem paths or shell commands from the browser
- Edit lockfiles by hand (lockfile refresh goes through `pnpm install --lockfile-only --ignore-scripts`)

## Layout

```text
monitor/
├── index.html      # Dashboard UI (served at GET /)
├── server.ts       # Local HTTP API + filesystem / registry / pnpm ops
├── tsconfig.json   # Typecheck for server.ts
└── README.md       # This file
```

Optional companion (repo-level):

```text
package.json        # script: "monitor": "tsx monitor/server.ts"
```

## Requirements

- Node.js 18+ (css-doctor runs the server via `tsx`; `node --strip-types` also works on Node 22+)
- pnpm workspace (this implementation refreshes the lockfile with `pnpm install --lockfile-only --ignore-scripts`)
- Root `package.json` + `packages/*`

## Start

From the repository root:

```bash
pnpm monitor
```

Open **http://127.0.0.1:4177** (binds to localhost only). If the port is taken, the server tries the next ports up to `+20`.

Typecheck:

```bash
pnpm exec tsc -p monitor/tsconfig.json --noEmit
```

## Monitoring scope

| Included | Excluded |
| --- | --- |
| Root `package.json` | `examples/**` |
| `packages/*/package.json` (immediate children only) | `packages/binding/npm/**` platform stubs |
| `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies` | `Cargo.toml` / `crates/**` |
| | `node_modules/`, `dist/`, build output |

Manifest ids used by the API/UI:

| Id | Meaning |
| --- | --- |
| `.` | Repository root |
| `packages/<name>` | Workspace package under `packages/` |

Discovery is **explicit** (root + readdir of `packages/`). Do not replace this with a recursive “find every package.json” walk unless you also hard-block `examples/`, `packages/*/npm/`, and other non-product trees.

## Architecture

```text
Browser (index.html)
    │  fetch /api/*
    ▼
server.ts  ──► read/write approved package.json files
           ──► query registry.npmjs.org (cached per process)
           ──► execFile("pnpm", ["install", "--lockfile-only", "--ignore-scripts"]) after successful writes
```

- **UI** never talks to the filesystem, registry, or package manager directly.
- **Server** validates every mutation against the known manifest list.
- On package-manager failure after a write, the previous `package.json` content is restored.
- css-doctor uses `--lockfile-only --ignore-scripts` so updates do not re-run the heavy `prepare`/native build hooks.

## Data model (API rows)

Each dependency declaration becomes one row:

| Field | Description |
| --- | --- |
| `id` | Stable key: `{manifestId}::{depType}::{dependency}` |
| `dependency` | Package name on npm |
| `manifestId` | `.` or `packages/<name>` |
| `packageName` | `name` from that manifest |
| `depType` | `dependencies` \| `devDependencies` \| `peerDependencies` \| `optionalDependencies` |
| `declared` | Version range/string in the manifest |
| `resolved` | Lockfile version when parsed from `pnpm-lock.yaml` |
| `ecosystem` | Currently always `"node"` in this port |
| `local` | `true` for `workspace:` / `file:` / `link:` / `portal:` / `catalog:` / git-url style specs |
| `registry` | Latest/patch/minor/major, version list, deprecated flag, classification, optional error |

### Update classifications

| Classification | Meaning |
| --- | --- |
| `up-to-date` | Declared base ≥ latest stable |
| `patch-available` | Newer patch within same major.minor |
| `minor-available` | Newer minor within same major |
| `major-available` | Newer major exists |
| `deprecated` | Registry marks package/version deprecated |
| `registry-check-failed` | Network/HTTP/parse failure (not treated as up-to-date) |
| `skipped` | Non-registry / local spec |

Summary cards count **unique dependency names** (worst classification wins across locations), not raw declaration rows — so a shared `typescript` in four manifests does not inflate “Total” to four.

## HTTP API

All JSON. Local `Host` only (`127.0.0.1` / `localhost`).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Serve `index.html` |
| `GET` | `/api/packages` | Monitored manifests |
| `GET` | `/api/dependencies` | All rows + `summary` |
| `GET` | `/api/summary` | Counters only |
| `POST` | `/api/refresh` | Clear registry cache, reload rows |
| `GET` | `/api/versions?name=` | Registry info for one package |
| `POST` | `/api/update` | Update one declaration |
| `POST` | `/api/update-bulk` | Update many declarations |

### Update payload

```json
{
  "manifestId": "packages/css-doctor-vite",
  "dependency": "vite",
  "depType": "peerDependencies",
  "targetVersion": "6.0.0",
  "preserveRange": true,
  "dryRun": false,
  "allowMajor": false
}
```

| Field | Notes |
| --- | --- |
| `manifestId` | Must match a discovered manifest; `examples/*` rejected |
| `targetVersion` | Exact semver (no path/`..`/whitespace); range prefix re-applied when `preserveRange` is true (`^` / `~`) |
| `dryRun` | Plan only; no writes |
| `allowMajor` | Bulk/major bumps refused unless `true` |

Update flow:

1. Validate request against discovered manifests
2. Backup current manifest text
3. Write new declared version
4. Run `pnpm install --lockfile-only --ignore-scripts` at repo root
5. On failure → restore backup and return error

## UI behavior

### Header actions

| Action | Behavior |
| --- | --- |
| **Refresh Data** | `POST /api/refresh` |
| **Get AI Prompt** | Builds a copyable prompt from selected outdated rows, or outdated rows in the **current filter view** if none selected. Includes each row’s selected target version. Does not modify packages. |
| **Update All Outdated** | Opens a **review dialog** (not an immediate upgrade). Targets default to conservative patch/minor. User can change/remove rows, then confirm. |

### Cards / filters

- One **card per package manifest** (Root first, then `packages/*` sorted)
- Filters: ecosystem · package/workspace · search · only outdated
- Per-row **target `<select>`** (safe → patch → minor → latest stable → specific versions)
- Majors are never the silent default

### Typography / layout conventions (for ports)

- Base `14px`, minimum `12px`, dependency names `16px`
- Container `max-width: 1920px`, horizontal padding `32px`
- Dark developer dashboard (Pico `data-theme="dark"`)
- Action column right-aligned

## AI prompt feature

The prompt is generated **client-side** from current monitor data. It asks an external agent to:

1. Inspect the real repository (do not assume the prompt already did)
2. Check breaking changes, peers, workspace impact, tooling compatibility (NAPI-RS, Next/Vite peers, lightningcss)
3. Return structured recommendations: safe / safe with changes / needs investigation / not recommended

Scope rules:

- If checkboxes are selected → selected outdated rows only
- Else → outdated rows matching the current filters (not necessarily the entire repo)
- Inventory includes a **Proposed target** column from each row’s target `<select>` (falls back to the conservative default)

Package names in the prompt header are taken from `/api/packages` when available.

It must **not** auto-apply upgrades. Copy via the dialog’s **Copy Prompt** button.

When porting, edit the prompt template in `index.html` (`buildPrompt` / `publishedPackageList`) so repository name, package names, and stack notes match the target project.

## Security model

- Bind `127.0.0.1` only
- Reject non-local `Host` headers
- Resolve packages only via discovered manifest ids (no client-supplied absolute paths)
- `execFile` with fixed argv (`pnpm install --lockfile-only --ignore-scripts`) — no user-controlled shell strings
- Registry failures surface as `registry-check-failed`, never as “up to date”

## Porting to another project

Copy the `monitor/` folder, then adjust these touch points:

### 1. Root script

```json
{
  "scripts": {
    "monitor": "tsx monitor/server.ts"
  }
}
```

If the host repo prefers `node --strip-types`, `ts-node`, or a compiled binary, change only this script — keep `server.ts` / `index.html` logic.

### 2. Discovery (`server.ts` → `discoverManifests`)

Today:

- Always include root `package.json`
- Include each immediate child of `packages/` that has a `package.json`
- Skip any directory named `examples`

For other layouts, change **only** this function (and the matching allowlist in update validation), for example:

- `apps/*` + `packages/*`
- Single-package repo (root only)
- Extra exclude dirs: `fixtures/`, `templates/`, `e2e/`

Keep the rule: **UI/API never invents paths**; they only reference discovered ids.

### 3. Package manager

Replace the post-write command if the host is not pnpm:

```ts
await execFileAsync(
  "pnpm",
  ["install", "--lockfile-only", "--ignore-scripts"],
  { cwd: ROOT },
);
```

Examples: `npm install`, `yarn install`. Prefer install-from-manifests over blind `update` of unrelated packages.

If the lockfile format differs, adapt or disable `readResolvedFromLockfile()` (resolved column becomes `null`).

### 4. Port / branding

| Knob | Where |
| --- | --- |
| Port `4177` | `PREFERRED_PORT` in `server.ts` |
| Page title / header copy | `index.html` |
| AI prompt repo name & stack | `buildPrompt()` in `index.html` |
| Ecosystem list | `ecosystem: "node"` on rows + `summary.ecosystems` — extend if you add Cargo/etc. |

### 5. TypeScript project

`monitor/tsconfig.json` is standalone (`noEmit`, Node types). If the host has a base config, you may `extends` it instead.

### 6. Smoke checklist after porting

1. `pnpm monitor` serves the UI on localhost
2. Root + expected packages appear; excluded trees do not
3. Shared deps show once per manifest card
4. `POST /api/update` with `"dryRun": true` returns `from`/`to` without writing
5. Real update (optional) changes only the chosen declaration and refreshes the lockfile
6. Failed `pnpm install` restores the previous manifest
7. Non-local `Host` → 403
8. Get AI Prompt copies text and does not mutate files

## Design principles (keep when extending)

1. **Explicit scope beats clever scanning.**
2. **Conservative defaults** for targets (patch/minor before major).
3. **Confirm before write**; review dialog for bulk.
4. **Restore on package-manager failure.**
5. **No AI provider coupling** — prompt export only.
6. **One card per ownership boundary** (root / package), not one giant mixed table.

## Current css-doctor defaults

| Setting | Value |
| --- | --- |
| Package manager | pnpm (`packageManager` in root `package.json`) |
| Scope | root + `packages/{binding,cli,css-doctor-*}` |
| Excluded | `examples/**`, Cargo/`crates/**`, `packages/binding/npm/**` |
| URL | http://127.0.0.1:4177 |
| Stack | Node-only (`ecosystem: "node"`) |
| Post-write | `pnpm install --lockfile-only --ignore-scripts` |
