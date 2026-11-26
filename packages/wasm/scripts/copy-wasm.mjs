#!/usr/bin/env node
// Copies the release build of the VM where the page and tests import it from.
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const from = resolve(root, 'target/wasm32-unknown-unknown/release/glass_wasm.wasm');
const to = resolve(import.meta.dirname, '../generated/glass_wasm.wasm');
mkdirSync(resolve(to, '..'), { recursive: true });
copyFileSync(from, to);
console.log(`copied ${from} -> ${to}`);
