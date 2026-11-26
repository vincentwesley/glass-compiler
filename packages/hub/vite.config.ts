import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vitest/config';
import { glassPages } from '../glass-ui/vite/glass-pages.ts';
import { MEMBERS } from '../../site.config.mjs';
import { HUB_BASE, gradeTable, membersList, pipeline, type Results } from './build/render.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** A member's committed results.json (written by scripts/record-results.mjs), if it has one. */
function resultsFor(slug: string): Results | null {
  const m = MEMBERS.find((x) => x.slug === slug);
  if (!m) throw new Error(`Unknown member "${slug}"`);
  const file = `${root}${m.pkg}/results.json`;
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Results) : null;
}

const HUB_MARKER = /<!--\s*hub:([a-z-]+)(?:\s+member="([a-z-]+)")?\s*-->/g;

/** Fills the hub's data-driven markers with static HTML. */
function hubPages(): Plugin {
  return {
    name: 'hub-pages',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replace(HUB_MARKER, (_, kind: string, member?: string) => {
          if (kind === 'members') return membersList((m) => resultsFor(m.slug));
          if (kind === 'pipeline') return pipeline();
          if (kind === 'grade' && member) return gradeTable(resultsFor(member));
          throw new Error(`Unknown hub marker <!-- hub:${kind} -->`);
        }),
    },
  };
}

export default defineConfig({
  // Served from https://vincentwesley.github.io/glass-compiler/series/ (docs/DECISIONS.md S2)
  base: HUB_BASE,
  plugins: [glassPages(), hubPages()],
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        compiler: fileURLToPath(new URL('compiler/index.html', import.meta.url)),
        wasm: fileURLToPath(new URL('wasm/index.html', import.meta.url)),
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
