import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node18',
  platform: 'node',
  splitting: false,
  outDir: 'dist',
  // Bundle internal shared helpers; keep binding + vite as runtime externals.
  noExternal: ['@zealakit/css-doctor-shared'],
  external: ['vite', '@zealakit/css-doctor-binding'],
});
