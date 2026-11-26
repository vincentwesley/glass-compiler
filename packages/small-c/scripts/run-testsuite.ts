// node scripts/run-testsuite.mjs [--json] [-v] [names…]: grades Small C with c-testsuite.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runWithHostEngine } from '../src/lang/compile';
import { runCase, type TestResult } from '../src/lang/testsuite';

const dir = join(process.cwd(), 'testsuite', 'tests', 'single-exec');
const args = process.argv.slice(2);
const json = args.includes('--json');
const verbose = args.includes('-v');
const only = args.filter((a) => !a.startsWith('-'));
const names = readdirSync(dir).filter((f) => f.endsWith('.c')).sort().filter((f) => !only.length || only.some((o) => f.includes(o)));
const results: TestResult[] = [];
for (const name of names) {
  const read = (ext: string) => readFileSync(join(dir, name + ext), 'utf8');
  const r = await runCase({ name, source: read(''), expected: read('.expected'), tags: read('.tags').split(/\s+/).filter(Boolean) }, runWithHostEngine);
  results.push(r);
  if (!json && (verbose || r.outcome !== 'pass')) console.log(`${name.padEnd(10)} ${r.outcome.padEnd(14)} ${r.reason ?? ''}`);
}
const count = (o: string) => results.filter((r) => r.outcome === o).length;
if (json) console.log(JSON.stringify({ passed: count('pass'), total: results.length, results }));
else console.log(`\n${count('pass')} / ${results.length} pass, ${count('fail')} fail, ${count('compile-error')} compile errors, ${count('skip')} skipped`);
