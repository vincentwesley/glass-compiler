import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../src/examples';
import { GlassWasm, lineColAt, stepsFor } from '../../src/vm';

let vm: GlassWasm;
beforeAll(async () => {
  vm = await GlassWasm.fromBytes(readFileSync(new URL('../../generated/glass_wasm.wasm', import.meta.url)));
});

describe('the VM in WebAssembly', () => {
  it('runs a spec script and counts commands', () => {
    const src = readFileSync(new URL('../../spec/test/core/fac.wast', import.meta.url), 'utf8');
    const r = vm.runSpec(src);
    expect(r.failed).toBe(0);
    expect(r.passed).toBeGreaterThan(5);
  });

  it('reports a failing assertion with its line', () => {
    const r = vm.runSpec('(module (func (export "f") (result i32) (i32.const 1)))\n(assert_return (invoke "f") (i32.const 2))');
    expect(r).toEqual({ passed: 1, failed: 1, failures: [{ line: 2, command: 'assert_return', message: 'expected i32:2, got i32:1' }] });
  });

  it('explains a module that does not parse or validate', () => {
    expect(vm.load('(module (func i32.nope))')).toEqual({ ok: false, error: 'line 1: unknown operator' });
    const bad = vm.load('(module (func (result i32) (i64.const 1)))');
    expect(bad.ok).toBe(false);
  });
});

describe('every example', () => {
  for (const ex of EXAMPLES) {
    it(`${ex.title} gives its known answer`, () => {
      const loaded = vm.load(ex.source);
      if (!loaded.ok) throw new Error(loaded.error);
      expect(loaded.value.exports.some((e) => e.name === ex.run.export)).toBe(true);
      const r = vm.run(ex.run.export, ex.run.args);
      if (!r.ok) throw new Error(r.error);
      const s = r.value;
      if (ex.expect.trap) {
        expect(s.status).toBe('trap');
        expect(s.trap).toBe(ex.expect.trap);
      } else {
        expect(s.status).toBe('finished');
        expect(s.results.map((v) => v.value)).toEqual(ex.expect.results);
      }
      if (ex.expect.output) expect(s.output).toEqual(ex.expect.output);
      if (ex.expect.memory) {
        const { at, text } = ex.expect.memory;
        expect(new TextDecoder().decode(vm.memory(at, text.length))).toBe(text);
      }
      // Every step of the run is in the trace, and replaying to any step agrees with it.
      const trace = vm.trace();
      expect(trace.length).toBe(s.total * 2);
      const mid = Math.floor(s.total / 2);
      const paused = vm.run(ex.run.export, ex.run.args, mid);
      if (!paused.ok) throw new Error(paused.error);
      expect(paused.value.step).toBe(mid);
      if (mid < s.total) expect(paused.value.at).toEqual({ func: trace[mid * 2], pc: trace[mid * 2 + 1] });
    });
  }
});

describe('helpers', () => {
  it('finds the steps an instruction ran at', () => {
    expect(stepsFor(new Uint32Array([0, 1, 0, 2, 0, 1]), 0, 1)).toEqual([0, 2]);
  });

  it('turns byte offsets into lines and columns, counting UTF-8 correctly', () => {
    expect(lineColAt('ab\ncd', 4)).toEqual({ line: 2, col: 2 });
    expect(lineColAt('é\nx', 3)).toEqual({ line: 2, col: 1 });
  });
});

describe('the VM under pressure', () => {
  it('fails a memory.grow it cannot satisfy instead of crashing', () => {
    const m = vm.load('(module (memory 1) (func (export "g") (result i32) (memory.grow (i32.const 65535))) (func (export "size") (result i32) (memory.size)))');
    if (!m.ok) throw new Error(m.error);
    const r = vm.run('g', []);
    if (!r.ok) throw new Error(r.error);
    // 65,536 pages is 4 GiB: more than a 32-bit build can hold, so the grow fails with -1.
    expect(r.value.results.map((v) => v.value)).toEqual(['-1']);
    expect(vm.crashes).toBe(0);
  });

  it('refuses a memory it cannot allocate with a message', () => {
    const r = vm.load('(module (memory 65536))');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('out of memory');
    expect(vm.crashes).toBe(0);
  });

  it('calls exports whose names contain newlines', () => {
    const m = vm.load('(module (func (export "two\\nlines") (param i32) (result i32) (local.get 0)))');
    if (!m.ok) throw new Error(m.error);
    const r = vm.run('two\nlines', ['7']);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.results[0]!.value).toBe('7');
  });

  it('replays any step of the same call without re-recording it', () => {
    const m = vm.load('(module (func (export "spin") (param $n i32) (loop $l (local.set $n (i32.sub (local.get $n) (i32.const 1))) (br_if $l (local.get $n)))))');
    if (!m.ok) throw new Error(m.error);
    const full = vm.run('spin', ['1000'], 0);
    if (!full.ok) throw new Error(full.error);
    const late = vm.run('spin', ['1000'], 4000);
    if (!late.ok) throw new Error(late.error);
    expect(late.value.total).toBe(full.value.total);
    expect(late.value.step).toBe(4000);
    // A different argument is a different call: its total is recomputed.
    const other = vm.run('spin', ['10'], 5);
    if (!other.ok) throw new Error(other.error);
    expect(other.value.total).toBeLessThan(full.value.total);
  });
});
