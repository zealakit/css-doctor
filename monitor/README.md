# Dependency Monitor

Local web dashboard for viewing, comparing, and updating dependency versions in the **css-doctor** pnpm monorepo.

This folder is designed to be **copied into other repositories** with small, explicit adaptations. It has no framework UI (vanilla HTML + Pico CSS) and no extra npm dependencies beyond what the host repo already uses for Node/TypeScript.

It is synced with the Zealakit Overlay monitor (same architecture, check + auto-upgrade
prompts, multi-section lockfile parsing). css-doctor-specific adaptations: the repository name,
package names, and stack notes in the AI prompt templates; Cargo/`crates/**` kept out of scope;
`catalog:` specs treated as local; and the post-write lockfile refresh uses
`pnpm install --lockfile-only --ignore-scripts` so the native `prepare` build does not run.

## What it does

- Scans **root** `package.json` and every **`packages/*/package.json`**
- Shows declared ranges, lockfile-resolved versions (when available), and npm registry latest/patch/minor/major
- Groups dependencies into **one card per manifest** (Root, then each package)
- Lets you pick a target version per row and update individually or in bulk
- Generates an **AI check prompt** and an **AI auto-upgrade prompt** (copy/paste into an external coding agent) — never calls an AI API itself

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
.gitignore          # optionally ignore generated reports if you add them later
```

## Requirements

- Node.js 18+ (css-doctor runs the server via `tsx`; `node --strip-types` also works on Node 22.18+)
- pnpm workspace (this implementation refreshes the lockfile with `pnpm install --lockfile-only --ignore-scripts`)
- Root `package.json` + `packages/*` (or adapt discovery — see [Porting](#porting-to-another-project))

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
| **Get AI Check Prompt** | Builds a copyable check prompt from selected outdated rows, or outdated rows in the **current filter view** if none selected. Includes each row’s selected target version. Does not modify packages. |
| **Get AI Upgrade Prompt** | Builds a copyable prompt that tells the agent to **apply** upgrades to the latest stable versions (majors included), then verify with build/typecheck/test/lint (plus cargo tests when the binding changes). Same row scope. The monitor still does not write files. |
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

Both prompts are generated **client-side** from current monitor data. The monitor never calls
an AI API itself, and it writes nothing until an external agent acts on the pasted text.

### Check prompt (`Get AI Check Prompt`)

It asks an external agent to:

1. Inspect the real repository (do not assume the prompt already did)
2. Check breaking changes, peers, workspace impact, tooling compatibility (NAPI-RS, Next/Vite/Rsbuild peers, lightningcss, tsup outputs)
3. Return structured recommendations: safe / safe with changes / needs investigation / not recommended

It must **not** auto-apply upgrades.

### Auto-upgrade prompt (`Get AI Upgrade Prompt`)

The opt-in counterpart: same inventory, but the agent is explicitly told to apply the upgrades
instead of only reviewing them.

1. Target the **Latest** stable version of every row, majors included, instead of the conservative proposed target
2. Edit only the monitored manifests (root `package.json`, `packages/*/package.json`), then run `pnpm install`
3. Iterate `pnpm build`, `pnpm typecheck`, `pnpm test`, and `pnpm lint` until green (plus `pnpm test:cargo` and a binding rebuild when `@zealakit/css-doctor-binding` or NAPI-RS tooling changes)
4. Revert only the dependency that cannot stay green, keeping the rest at their latest versions
5. Report every row as upgraded / kept / blocked with the reason

Hard guardrails baked into the prompt: no `examples/**` or `Cargo.toml`/`crates/**` edits, no
hand-edited generated artifacts, dependency direction core → binding → CLI/adapters, NAPI-RS 2.x,
peer ranges that are broader than pinned devDependencies stay broad, no commit/push/publish, pnpm only.

### Scope rules (both modes)

- If checkboxes are selected → selected outdated rows only
- Else → outdated rows matching the current filters (not necessarily the entire repo)
- Check prompt’s **Proposed target** column comes from each row’s target `<select>` (falls back to the conservative default)
- Upgrade prompt’s **Proposed target** column is each row’s **Latest** stable version

Package names in the prompt header are taken from `/api/packages` when available (so adding a new `packages/css-doctor-*` adapter stays current).

When porting, edit the prompt template in `index.html` (`buildPrompt` / `publishedPackageList`) so repository name, package names, and stack notes match the target project. The `mode` option (`"check"` / `"upgrade"`) switches the directive and constraint sections.

### Template anatomy (for ports)

Everything the agent reads comes from `buildPrompt()`. This table maps each block to what a port must change.

| Block in `buildPrompt()` | css-doctor value | Change when porting |
| --- | --- | --- |
| Opening line | “senior monorepo dependency-upgrade engineer working on the css-doctor repository” | New repo name and role |
| Repository + architecture bullets | Rust core → NAPI binding → CLI/adapters; NAPI-RS 2.x; `css-doctor-shared` bundled and private | The dependency-direction rules the agent must preserve |
| `publishedPackageList()` | names from `/api/packages`, fallback list of the seven published `@zealakit/css-doctor-*` packages | Replace the fallback array with the port’s package set |
| Tooling stack bullet | TypeScript, Biome, Turborepo, tsx/tsup, Vite/Next/Rsbuild/Remix/Nuxt, lightningcss, NAPI-RS | Host framework, build tool, type checker, formatter, test runner |
| Session mode line | derived from `mode` (`advisory only` vs `auto-upgrade`) | Keep as-is; it is what distinguishes the two prompts |
| Inventory table | 14 columns from server rows | Keep unless you change the row shape in `server.ts` |
| Required investigation | 9 checks tuned to bundler peers, the native binding, and tsup outputs | Replace framework/CDN specifics with the port’s real risks |
| Execution directive (upgrade) | latest stable, majors allowed, edit manifests, `pnpm install`, verify loop, per-dependency fallback, final report | New commands, manifest scope, and registry policy |
| Recommendation format (check) | 4 outcome buckets | Keep unless the project wants different buckets |
| Constraints (both) | no `examples/**` / Cargo edits, no generated-artifact edits, dependency direction, broad peers, no publish | The port’s hard boundaries and excluded trees |
| Final report (upgrade) | upgraded / kept / blocked table + commands run | Keep; extend only for project-specific evidence |

Practical constraints of the template:

- The verification chain (`pnpm build` → `pnpm typecheck` → `pnpm test` → `pnpm lint`) is hardcoded in the execution directive, the constraints, and the final report. Replace all occurrences with the host repo’s real commands and keep the same order: build, typecheck, test, lint.
- The `examples/**` guardrail is project-specific too. Swap it for the port’s excluded tree (for example `fixtures/**`, `docs/**`, `templates/**`).
- Prompts are written in English so any coding agent reads them consistently. Translating the static text is fine; keep the directive explicit — one target, one write path, one verification loop, one fallback rule.
- Only `mode: "upgrade"` may tell the agent to write files. Never add write permissions to the check section.

Find leftover project-specific strings before shipping a port:

```bash
grep -n "overlay\|vanilla\|examples/\|pnpm build\|pnpm typecheck\|pnpm test\|pnpm lint" monitor/index.html
```

Every hit should be a deliberate part of the new project’s template.

## Security model

- Bind `127.0.0.1` only
- Reject non-local `Host` headers
- Resolve packages only via discovered manifest ids (no client-supplied absolute paths)
- `execFile` with fixed argv (`pnpm install`) — no user-controlled shell strings
- Registry failures surface as `registry-check-failed`, never as “up to date”

## Porting to another project

The monitor is one server file, one UI file, and this README. A port is a copy plus a fixed set
of edits. Work in this order so each failure stays local and testable.

### 1. Copy and wire the root script

Copy `monitor/` into the target repository, then add the script:

```json
{
  "scripts": {
    "monitor": "tsx monitor/server.ts"
  }
}
```

If the host repo prefers `node --strip-types`, `ts-node`, or a compiled binary, change only this script — keep `server.ts` / `index.html` logic.

### 2. Define scope and discovery (`server.ts` → `discoverManifests`)

Default behavior:

- Always include root `package.json`
- Include each immediate child of `packages/` that has a `package.json`
- Skip any directory named `examples`

For other layouts, change **only** this function (and the matching allowlist in update validation), for example:

- `apps/*` + `packages/*`
- Single-package repo (root only)
- Extra exclude dirs: `fixtures/`, `templates/`, `e2e/`

Keep the rule: **UI/API never invents paths**; they only reference discovered ids.

### 3. Adapt the write path (package manager + lockfile)

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

### 4. Rewrite the AI prompt template

This is the step that changes the most per project, because the prompt encodes the host repo's
rules. Edit these blocks in `buildPrompt()` and `publishedPackageList()` in `index.html` (see
[Template anatomy](#template-anatomy-for-ports) for the full map):

- **Identity** — opening line, repository/architecture bullet, tooling-stack bullet.
- **Package inventory** — `publishedPackageList()` fallback array.
- **Execution directive (upgrade mode)** — registry policy (latest stable? majors allowed?), which manifests the agent may write, the install command, the verification chain, the per-dependency fallback rule, and the final report format.
- **Constraints (both modes)** — excluded trees, architecture boundaries, peer-range policy, and the no-commit/no-publish rule.
- **Check mode** — outcome buckets and the explicit “do not apply” instruction.

Then generate both prompts against at least one outdated row and verify:

| Check | Expected |
| --- | --- |
| Check prompt | Has a recommendation section, forbids applying upgrades, and its **Proposed target** follows the row’s selected/conservative version |
| Upgrade prompt | Has the execution directive, targets the **Latest** column, and names the host repo’s real install and verification commands |
| Guardrails | Lists the port’s excluded trees and architecture rules, with no leftover css-doctor strings |
| Leftovers | `grep -n "overlay\|vanilla\|examples/\|pnpm build\|pnpm typecheck\|pnpm test\|pnpm lint" monitor/index.html` returns only deliberate template hits |

### 5. Branding and port

| Knob | Where |
| --- | --- |
| Port `4177` | `PREFERRED_PORT` in `server.ts` |
| Page title / header copy | `index.html` |
| AI prompt repo name, stack & upgrade rules | `buildPrompt()` in `index.html` (`mode: "check"` / `"upgrade"`) |
| Ecosystem list | `ecosystem: "node"` on rows + `summary.ecosystems` — extend if you add Cargo/etc. |

### 6. TypeScript project

`monitor/tsconfig.json` is standalone (`noEmit`, Node types). If the host has a base config, you may `extends` it instead.

### 7. Acceptance checklist after porting

1. `pnpm monitor` serves the UI on localhost
2. Root + expected packages appear; excluded trees do not
3. Shared deps show once per manifest card
4. `POST /api/update` with `"dryRun": true` returns `from`/`to` without writing
5. Real update (optional) changes only the chosen declaration and refreshes the lockfile
6. Failed `pnpm install` restores the previous manifest
7. Non-local `Host` → 403
8. Both prompt modes copy text and do not mutate files
9. The upgrade prompt’s verification commands and guardrails match the target repo, not this one

Hand this section plus [Template anatomy](#template-anatomy-for-ports) to the agent or engineer
doing the port; together they cover every file and knob.

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
