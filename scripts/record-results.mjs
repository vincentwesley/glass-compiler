#!/usr/bin/env node
// Records a member's test results into packages/<member>/results.json, which the
// hub shows. Never edit results.json by hand: run this instead.
//   node scripts/record-results.mjs compiler          write results.json
//   node scripts/record-results.mjs compiler --check  fail if results.json is stale
//   node scripts/record-results.mjs wasm              the WebAssembly spec testsuite pass counts
//   node scripts/record-results.mjs small-c           c-testsuite on Node and on Glass Wasm (needs the wasm build)
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

/** Runs the WebAssembly spec testsuite through the Glass Wasm CLI. */
function wasmSpec() {
  const out = execFileSync('cargo', ['run', '--quiet', '--release', '-p', 'glass-wasm', '--', 'spec', join(pkg, 'spec/test/core'), '--json'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  const r = JSON.parse(out);
  const spec = execFileSync('git', ['-C', join(pkg, 'spec'), 'rev-parse', '--short', 'HEAD']).toString().trim();
  return {
    member: 'wasm',
    testsuite: `WebAssembly/spec tag wg-1.0 (${spec}), test/core`,
    suites: [{ name: `Spec testsuite commands, ${r.files.length} .wast files (WebAssembly 1.0)`, passed: r.passed, failed: r.total - r.passed, skipped: 0, total: r.total }],
    files: r.files,
  };
}

/** Grades Small C with c-testsuite on Node's WebAssembly and on Glass Wasm. */
function smallC() {
  const dir = mkdtempSync(join(tmpdir(), 'glass-results-'));
  const bundle = join(dir, 'run-testsuite.mjs');
  try {
    // The runner is TypeScript; bundle it (with the compiler) for Node.
    execFileSync('npx', ['rolldown', join(pkg, 'scripts/run-testsuite.ts'), '-o', bundle, '--platform', 'node'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
    const run = (engine) => JSON.parse(execFileSync('node', [bundle, '--json', `--engine=${engine}`], { cwd: pkg, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 * 1024 * 1024 }).toString());
    const node = run('node');
    const glass = run('glass-wasm');
    const count = (r, o) => r.results.filter((x) => x.outcome === o).length;
    const suite = (name, r) => ({ name, passed: r.passed, failed: r.total - r.passed - count(r, 'skip'), skipped: count(r, 'skip'), total: r.total });
    // Every test that does not pass, with the reason (the page lists them all).
    const notPassing = node.results.filter((x) => x.outcome !== 'pass').map(({ name, outcome, reason }) => ({ name, outcome, reason }));
    const differ = node.results.filter((x, i) => x.outcome !== glass.results[i].outcome).map((x) => x.name);
    return {
      member: 'small-c',
      testsuite: `c-testsuite (${node.commit}), tests/single-exec`,
      suites: [
        suite(`c-testsuite single-exec, run on Node's WebAssembly`, node),
        suite('The same programs run on Glass Wasm', glass),
        vitestSuite('Unit tests: semantics, printf, preprocessor, errors, code shape'),
      ],
      notPassing,
      enginesDisagree: differ,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const RECORDERS = {
  'small-c': smallC,
  compiler: () => ({ member: 'compiler', suites: [vitestSuite('Unit tests: lexer, parser, compiler, VM and UI logic')] }),
  wasm: wasmSpec,
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
