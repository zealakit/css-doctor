# @zealakit/css-doctor-shared

Pure helpers shared by css-doctor framework adapters.

This package does **not** hook bundlers and does **not** call the native
binding. It only holds logic that Vite, Next, and Rsbuild already shared
verbatim:

- literal `class` / `className` / `classList` scanning
- include/exclude pattern matching
- `minPageRatio` / `maxChunkSize` clamping
- error stringification

Adapter packages keep ownership of lifecycle, asset emission, and route graphs.
