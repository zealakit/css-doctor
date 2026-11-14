# @zealakit/css-doctor-shared

Internal-only pure helpers shared by css-doctor framework adapters.

**This package is not published to npm.** It stays a private workspace package:
monorepo builds use `workspace:*`, and publishable consumers (CLI, Vite, Next,
Rsbuild) bundle the helpers into their own `dist/` output. Downstream installs
never need to resolve `@zealakit/css-doctor-shared`.

This package does **not** hook bundlers and does **not** call the native
binding. It only holds logic that Vite, Next, and Rsbuild already shared
verbatim:

- literal `class` / `className` / `classList` scanning
- include/exclude pattern matching
- `minPageRatio` / `maxChunkSize` clamping
- error stringification

Adapter packages keep ownership of lifecycle, asset emission, and route graphs.

## Development

```bash
pnpm --filter @zealakit/css-doctor-shared build
pnpm --filter @zealakit/css-doctor-shared test
```

Consumers list this package under `devDependencies` (`workspace:*`) and mark it
`noExternal` in tsup so production bundles remain self-contained.
