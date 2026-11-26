import { defineConfig } from 'vitest/config';
import { glassPages } from '../glass-ui/vite/glass-pages';

export default defineConfig({
  // Served from https://vincentwesley.github.io/glass-compiler/ (the series root; see docs/DECISIONS.md S2)
  base: '/glass-compiler/',
  plugins: [glassPages()],
  build: {
    target: 'es2022',
    sourcemap: false,
    // Keep fonts as files so the CSP font-src 'self' covers them.
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
