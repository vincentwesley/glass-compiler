// Grades Small C with c-testsuite (run from packages/small-c, through
// scripts/record-results.mjs or `npm run testsuite`):
//   [--engine=node|glass-wasm] [--json] [-v] [names…]
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runWithHostEngine, type RunResult } from '../src/lang/compile';
import { GlassWasm } from '../../wasm/src/vm';
import { runCase, type TestResult } from '../src/lang/testsuite';

const dir = join(process.cwd(), 'testsuite', 'tests', 'single-exec');
const args = process.argv.slice(2);
const json = args.includes('--json');
const verbose = args.includes('-v');
const only = args.filter((a) => !a.startsWith('-'));
// --engine glass-wasm runs each program on Glass Wasm (the series' own VM) instead of Node's engine.
const engineArg = args.find((a) => a.startsWith('--engine='))?.slice(9) ?? 'node';
const vm = engineArg === 'glass-wasm' ? await GlassWasm.fromBytes(readFileSync(join(process.cwd(), '..', 'wasm', 'generated', 'glass_wasm.wasm'))) : undefined;
const glassWasm = async (bytes: Uint8Array): Promise<RunResult> => {
  const r = vm!.runProgram(bytes, 5e9);
  if (!r.ok) return { output: '', exitCode: null, trap: r.error };
  return { output: r.value.output, exitCode: r.value.exit ?? (r.value.trap ? null : 0), trap: r.value.trap };
};
const names = readdirSync(dir).filter((f) => f.endsWith('.c')).sort().filter((f) => !only.length || only.some((o) => f.includes(o)));
const results: TestResult[] = [];
for (const name of names) {
  const read = (ext: string) => readFileSync(join(dir, name + ext), 'utf8');
  const r = await runCase({ name, source: read(''), expected: read('.expected'), tags: read('.tags').split(/\s+/).filter(Boolean) }, vm ? glassWasm : runWithHostEngine);
  results.push(r);
  if (!json && (verbose || r.outcome !== 'pass')) console.log(`${name.padEnd(10)} ${r.outcome.padEnd(14)} ${r.reason ?? ''}`);
}
const count = (o: string) => results.filter((r) => r.outcome === o).length;
if (json) {
  const commit = execFileSync('git', ['-C', join(process.cwd(), 'testsuite'), 'rev-parse', '--short', 'HEAD']).toString().trim();
  console.log(JSON.stringify({ commit, engine: engineArg, passed: count('pass'), total: results.length, results }));
}
else console.log(`\n${count('pass')} / ${results.length} pass, ${count('fail')} fail, ${count('compile-error')} compile errors, ${count('skip')} skipped`);
