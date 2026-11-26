#!/usr/bin/env node
// Records a member's test results into packages/<member>/results.json, which the
// hub shows. Never edit results.json by hand: run this instead.
//   node scripts/record-results.mjs compiler          write results.json
//   node scripts/record-results.mjs compiler --check  fail if results.json is stale
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [member, flag] = process.argv.slice(2);
const root = resolve(import.meta.dirname, '..');
const pkg = join(root, 'packages', member ?? '');
if (!member) {
  console.error('usage: record-results.mjs <member> [--check]');
  process.exit(2);
}

/** Vitest's JSON report reduced to the numbers the hub shows. */
function vitestSuite(name) {
  const dir = mkdtempSync(join(tmpdir(), 'glass-results-'));
  const out = join(dir, 'vitest.json');
  try {
    execFileSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${out}`], { cwd: pkg, stdio: ['ignore', 'ignore', 'inherit'] });
    const r = JSON.parse(readFileSync(out, 'utf8'));
    return { name, passed: r.numPassedTests, failed: r.numFailedTests, skipped: r.numPendingTests + r.numTodoTests, total: r.numTotalTests };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const RECORDERS = {
  compiler: () => ({ member: 'compiler', suites: [vitestSuite('Unit tests: lexer, parser, compiler, VM and UI logic')] }),
};

const record = RECORDERS[member];
if (!record) {
  console.error(`No results recorder for "${member}". Known: ${Object.keys(RECORDERS).join(', ')}`);
  process.exit(2);
}
const next = JSON.stringify(record(), null, 2) + '\n';
const file = join(pkg, 'results.json');
if (flag === '--check') {
  let current = '';
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    // missing counts as stale
  }
  if (current !== next) {
    console.error(`${file} is stale. Run: node scripts/record-results.mjs ${member}`);
    process.exit(1);
  }
  console.log(`${member}: results.json is current`);
} else {
  writeFileSync(file, next);
  console.log(`${member}: wrote ${file}`);
}
