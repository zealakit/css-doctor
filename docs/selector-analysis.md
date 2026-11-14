# Selector analysis (static)

Canonical reference for CSS Doctor’s **static** selector analysis (Phases 1–5).
This is **not** browser runtime matching. Pseudo-states such as `:hover` may
structurally attach to an element and still be reported as **partial**, never
**confirmed**.

Source of truth: Rust Core (`crates/core` → `analyze_css`,
`match_selectors_against_markup`). The NAPI binding exposes results faithfully.
`css-doctor-shared` / CLI / GUI assemble and display the Phase 4
`selectorAnalysis` contract; they do **not** re-match selectors.

Full report envelope details: [`report-contract.md`](./report-contract.md).

## Pipeline

```text
CSS files  +  HTML/JSX/TSX/Vue/Svelte/Astro sources
        ↓
Rust Core (parse, extract, match, metrics)
        ↓
NAPI (`analyzeCss`, `matchSelectorsAgainstMarkup`)
        ↓
CLI `css-doctor gui` (scan sources → Core match → JSON)
        ↓
GUI Selector Explorer (presentation only)
```

Framework adapters (Vite/Next/…) still use **class-token `pageUsage`** for
page-coverage splitting. They do not author the GUI selector report.

## Metric definitions

| Metric | Meaning |
| --- | --- |
| Total distinct selectors | Unique selector texts |
| Total definitions | Sum of definition occurrence counts (not usages) |
| Confirmed usages | Sum of `usageOccurrences` where `confidence === "confirmed"` |
| Confirmed matched elements | Sum of `matchedElements` for confirmed rows |
| Distinct usage files | Unique paths from confirmed `usageByFile` hits; `null` only if paths absent |
| Partial matches | Count of selectors with `status === "partial"` |
| Unresolved | Count of selectors with `status === "unknown"` |
| Unused | Count of selectors with `status === "unused"` |

Rules:

- Definitions are never counted as usages.
- Partial matches are never confirmed usages.
- Combinator matching does not cross source files.
- PascalCase components are not native HTML tags.

## Selector category coverage

| Category | Example | Parsed | Static match | Typical status | Runtime needed | GUI |
| --- | --- | --- | --- | --- | --- | --- |
| Class | `.button` | Yes | Yes | used / unused | No | Yes |
| ID | `#app` | Yes | Yes | used / unused | No | Yes |
| Element | `button`, `h1` | Yes | Yes (native tags) | used / unused / partial | No | Yes |
| Attribute | `[disabled]` | Yes | Yes | used / unused | No | Yes |
| Attribute value | `[type="text"]`, `[href^="/"]`, `[class*="btn"]` | Yes | Yes (`=`, `~=`, `|=`, `^=`, `*=`, `$=`) | used / unused | No | Yes |
| Compound | `.card.active` | Yes | Yes (all parts) | used / **partial** if incomplete | No | Yes |
| Descendant | `.card p` | Yes | Yes (same file) | used / unused | No | Yes |
| Child | `.menu > li` | Yes | Yes (same file) | used / unused | No | Yes |
| Adjacent sibling | `.item + .item` | Yes | Yes (same file) | used / unused | No | Yes |
| General sibling | `.item ~ .item` | Yes | Yes (same file) | used / unused | No | Yes |
| Pseudo-class | `:hover`, `:focus` | Yes | Structural only | **partial** | Yes for confirmed | Yes |
| Pseudo-element | `::before`, `::after` | Yes (LightningCSS may emit `:before`) | Not confirmed alone (runtime/pseudo-only → partial/unsupported) | **partial** / unknown | Yes | Yes |
| Functional | `:not()`, `:is()`, `:where()`, `:has()` | Yes | Supported for common static cases | used / partial / unknown | Depends | Yes |

“Parsed” means LightningCSS can analyze the selector. “Static match” means Core
can confirm usage from scanned markup evidence without a browser.

## Source / framework coverage

| Surface | Selector-report source scan | Page-coverage split |
| --- | --- | --- |
| HTML | Yes (CLI gui scan) | Via adapters when class tokens found |
| JSX / TSX | Yes | Vite / Next / Rsbuild class scan |
| Vue SFC | Yes (static + unresolved dynamics) | Via Nuxt → Vite plugin (classes) |
| Svelte | Yes (static + unresolved dynamics) | Via Vite class scan |
| Astro | Yes (template attrs) | Via Vite/Astro plugin (classes) |
| Vite adapter | No selector report; class `pageUsage` | Yes |
| Next adapter | No selector report; class `pageUsage` | Yes |
| Nuxt module | Wraps Vite plugin | Yes (class) |
| Remix middleware | Size budget path; no page coverage | No page coverage |
| Rsbuild adapter | No selector report; class `pageUsage` | Yes |

## Known limitations

- `cn` / `clsx` / dynamic expressions are unresolved, not confirmed.
- CSS Modules local names are not fully resolved.
- No cross-file DOM tree for combinators.
- `classList.*` string hits update symbol bags but do not create element trees
  for Core matching (bags can diverge from match rows).
- Source scanning follows symlinks under the project cwd; treat linked trees as
  in-scope.
- Adapters do not emit `selectorAnalysis` JSON; use `css-doctor gui` / CLI.
- Content-hash filenames may not match rewritten CSS bodies (see AGENTS.md).
