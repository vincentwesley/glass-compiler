// The pipeline: Pane compiled to WebAssembly by Glass Compiler runs in Glass Wasm
// (this crate, built for the browser) with exactly the bytecode VM's output.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { build } from '../../../compiler/src/lang';
import { formatValue } from '../../../compiler/src/lang/bytecode';
import { EXAMPLES } from '../../../compiler/src/examples';
import { compileToWasm } from '../../../compiler/src/lang/wasm';
import { GlassWasm } from '../../src/vm';

let vm: GlassWasm;
beforeAll(async () => {
  vm = await GlassWasm.fromBytes(readFileSync(new URL('../../generated/glass_wasm.wasm', import.meta.url)));
});

function inGlassWasm(src: string) {
  const b = build(src);
  expect(b.diagnostics).toEqual([]);
  const expected = { output: b.trace!.output.map((l) => l.text), error: b.trace!.error?.message ?? null };
  const w = compileToWasm(b.program, src);
  const loaded = vm.load(w.bytes);
  if (!loaded.ok) throw new Error(loaded.error);
  const r = vm.run('main', []);
  if (!r.ok) throw new Error(r.error);
  const got = { output: r.value.output, error: r.value.status === 'trap' ? r.value.trap : null };
  return { expected, got, info: loaded.value, state: r.value };
}

describe('Pane programs in Glass Wasm', () => {
  it('runs every built-in example with the same output as the bytecode VM', () => {
    for (const ex of EXAMPLES) {
      const { expected, got, state } = inGlassWasm(ex.source);
      expect(got, ex.id).toEqual(expected);
      expect(state.status, ex.id).toBe('finished');
    }
  });

  it.each([
    'print 1 + true;',
    'print -"a";',
    'print 1 < "a";',
    'print 1 / 0;',
    'print missing;',
    'let s = "q\\"uote\\n"; s();',
    'fn f(a) {} f();',
    'fn f() { return f(); } f();',
    'print "before"; print 7 % 0; print "after";',
  ])('fails like the VM: %s', (src) => {
    const { expected, got } = inGlassWasm(src);
    expect(got).toEqual(expected);
  });

  it('shows the Pane source and maps instructions back to it', () => {
    const src = 'fn sq(n) {\n  return n * n;\n}\nprint sq(4);';
    const { info } = inGlassWasm(src);
    expect(info.source).toEqual({ language: 'pane', text: src });
    const sq = info.funcs.find((f) => f.name === '$sq')!;
    const mul = sq.lines.find((l) => l.text === 'call $rt.multiply')!;
    expect(src.slice(mul.offset, mul.offset + 5)).toBe('n * n');
    // Runtime functions have names but no Pane source.
    const add = info.funcs.find((f) => f.name === '$rt.add')!;
    expect(add.lines.every((l) => l.offset === -1)).toBe(true);
  });

  it('formats numbers exactly as JavaScript does (100,000 random values)', () => {
    const dv = new DataView(new ArrayBuffer(8));
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0);
    const values: number[] = [0, -0, 1, -1, 0.1, 1 / 3, 2 / 3, 123456789012.5, -123456789012.5, 1e21, 1e-7, 5e-324, Infinity, -Infinity, NaN];
    for (let i = 0; i < 100_000; i++) {
      switch (i % 4) {
        case 0: // any bit pattern
          dv.setUint32(0, rand());
          dv.setUint32(4, rand());
          values.push(dv.getFloat64(0));
          break;
        case 1: // everyday decimals
          values.push((rand() % 2_000_000) / 1000 - 1000);
          break;
        case 2: // ties at the 13th significant digit
          values.push(((rand() % 9_000_000_000_000) + 1_000_000_000_000) / 10 + 0.05);
          break;
        default: // integers, large and small
          values.push((rand() - 2 ** 31) * (i % 3 === 0 ? 1e9 : 1));
      }
    }
    const mismatches = values.filter((x) => vm.formatNumber(x) !== formatValue(x)).slice(0, 5).map((x) => `${x}: ${vm.formatNumber(x)} vs ${formatValue(x)}`);
    expect(mismatches).toEqual([]);
  });
});
