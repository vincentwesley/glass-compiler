import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Served from https://vincentwesley.github.io/glass-compiler/
  base: '/glass-compiler/',
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
