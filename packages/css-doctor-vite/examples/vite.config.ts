import { defineConfig } from 'vite';

import { cssDoctor } from '@zealakit/css-doctor-vite';

export default defineConfig({
  plugins: [
    cssDoctor({
      minPageRatio: 0.5,
      report: true,
      forceCommonSelectors: [':root', '.app-shell'],
      // include: ['**/*.css'],
      // exclude: ['**/vendor-*.css'],
      // Explicit usage for pages rendered outside the Vite module graph:
      // pageUsage: { home: ['hero', 'nav'], about: ['team-card'] },
      onDiagnostics: (diagnostics) => {
        // Optional: forward diagnostics to CI, a dashboard, or custom tooling.
        void diagnostics;
      },
    }),
  ],
});
