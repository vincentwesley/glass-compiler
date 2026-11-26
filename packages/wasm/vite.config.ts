import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import { glassPages } from '../glass-ui/vite/glass-pages.ts';
import { recordedTable, type SpecRecord } from './src/recorded.ts';

const results = fileURLToPath(new URL('results.json', import.meta.url));

/** Renders the recorded spec results into the page at build time, so they show without JavaScript. */
function recordedResults(): Plugin {
  return {
    name: 'wasm-recorded-results',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => {
        const rec: SpecRecord | null = existsSync(results) ? (JSON.parse(readFileSync(results, 'utf8')) as SpecRecord) : null;
        return html.replace('<!-- wasm:recorded -->', recordedTable(rec));
      },
    },
  };
}

export default defineConfig({
  // Served from https://vincentwesley.github.io/glass-compiler/wasm/ (docs/DECISIONS.md S2)
  base: '/glass-compiler/wasm/',
  plugins: [glassPages({ extraPublic: fileURLToPath(new URL('public', import.meta.url)) }), recordedResults()],
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
