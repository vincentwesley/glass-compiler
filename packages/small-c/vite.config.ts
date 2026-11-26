import { defineConfig } from 'vitest/config';
import { glassPages } from '../glass-ui/vite/glass-pages.ts';

export default defineConfig({
  // Served from https://vincentwesley.github.io/glass-compiler/small-c/
  base: '/glass-compiler/small-c/',
  plugins: [glassPages()],
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
