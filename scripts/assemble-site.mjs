#!/usr/bin/env node
// Merges each package's dist/ into one GitHub Pages artefact in _site/, laid out
// as the live site: _site/glass-compiler/ is what https://vincentwesley.github.io/glass-compiler/
// serves. The deploy uploads _site/glass-compiler/. See docs/DECISIONS.md S2.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { HUB_PATH, MEMBERS, SITE } from '../site.config.mjs';

const root = resolve(import.meta.dirname, '..');
const out = join(root, '_site', SITE.base);
rmSync(join(root, '_site'), { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const mounts = [
  ...MEMBERS.filter((m) => m.status === 'live').map((m) => ({ from: join(root, m.pkg, 'dist'), at: m.path, name: m.name })),
  { from: join(root, 'packages/hub/dist'), at: HUB_PATH, name: 'hub' },
];

// Mount the root last-checked: a member mounted at '' must not own a folder another member mounts into.
const claimed = new Set(mounts.filter((m) => m.at !== '').map((m) => m.at.replace(/\/$/, '')));
for (const m of mounts) {
  if (!existsSync(m.from)) throw new Error(`${m.name}: ${m.from} is missing. Build it first (npm run build).`);
  if (m.at === '') {
    const clash = readdirSync(m.from).filter((f) => claimed.has(f));
    if (clash.length) throw new Error(`${m.name} would overwrite ${clash.join(', ')}`);
  }
  cpSync(m.from, join(out, m.at), { recursive: true });
  console.log(`  ${m.name.padEnd(16)} -> ${SITE.base}${m.at}`);
}
console.log(`Site assembled in _site${SITE.base}`);
