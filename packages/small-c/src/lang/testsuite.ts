// Grades Small C with c-testsuite's single-exec suite: compile each test, run it
// on a WebAssembly engine, and compare stdout+stderr with the .expected file and
// the exit status with 0 (the suite's rule). DECISIONS S20 has the grading rules.

import { compile, type RunResult } from './compile';

export interface TestCase {
  name: string;
  source: string;
  expected: string;
  tags: string[];
}

export type Outcome = 'pass' | 'fail' | 'compile-error' | 'skip';

export interface TestResult {
  name: string;
  outcome: Outcome;
  /** Why it failed, or why it is skipped. */
  reason?: string;
  tags: string[];
}

/** Tests that cannot pass on this target, whatever the compiler does. Every entry says why. */
export const SKIPS: Record<string, string> = {};

export async function runCase(t: TestCase, run: (bytes: Uint8Array) => Promise<RunResult>): Promise<TestResult> {
  if (SKIPS[t.name]) return { name: t.name, outcome: 'skip', reason: SKIPS[t.name], tags: t.tags };
  const b = compile(t.source, t.name);
  if (b.diagnostics.length) {
    const d = b.diagnostics[0]!;
    return { name: t.name, outcome: 'compile-error', reason: `${d.file ?? t.name}:${d.line}: ${d.message}`, tags: t.tags };
  }
  const r = await run(b.wasm!.bytes);
  if (r.trap !== null) return { name: t.name, outcome: 'fail', reason: `trap: ${r.trap}`, tags: t.tags };
  if (r.output !== t.expected) {
    const a = r.output.split('\n');
    const e = t.expected.split('\n');
    const i = a.findIndex((l, k) => l !== e[k]);
    return { name: t.name, outcome: 'fail', reason: `output differs at line ${i + 1}: got ${JSON.stringify(a[i] ?? '')}, expected ${JSON.stringify(e[i] ?? '')}`, tags: t.tags };
  }
  if (r.exitCode !== 0) return { name: t.name, outcome: 'fail', reason: `exit status ${r.exitCode}`, tags: t.tags };
  return { name: t.name, outcome: 'pass', tags: t.tags };
}
