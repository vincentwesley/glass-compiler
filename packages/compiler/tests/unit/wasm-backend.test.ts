import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build } from '../../src/lang';
import { EXAMPLES } from '../../src/examples';
import { compileToWasm, runWithHostEngine } from '../../src/lang/wasm';

/** Runs a program on the bytecode VM and, compiled to WebAssembly, on this engine's own WebAssembly. */
async function both(src: string) {
  const b = build(src);
  expect(b.diagnostics).toEqual([]);
  const vm = { output: b.trace!.output.map((l) => l.text), error: b.trace!.error?.message ?? null };
  const w = compileToWasm(b.program, src);
  expect(WebAssembly.validate(w.bytes as BufferSource)).toBe(true);
  const wasm = await runWithHostEngine(w.bytes, w.memoryPages);
  return { vm, wasm };
}

const same = async (src: string) => {
  const { vm, wasm } = await both(src);
  expect(wasm).toEqual(vm);
  return wasm;
};

describe('Pane → WebAssembly gives the same output as the bytecode VM', () => {
  // The same cases as the VM's own tests (vm.test.ts), plus more around formatting.
  it.each([
    '1 + 2 * 3', '(1 + 2) * 3', '10 - 4 - 3', '7 / 2', '7 % 3', '-7 % 3', '7.5 % 2', '-(2 + 3)', '0.1 + 0.2', '1 / 3', '2 / 3',
    '"glass" + "pane"', '"n = " + 3', '1 + " pane"', '"is " + true + " " + nil', '"x" + 0.1', '"big " + 1000000000 * 1000000000 * 1000', '"small " + 0.0000001',
    '1 < 2', '2 <= 2', '3 > 4', '3 >= 4', '"a" < "b"', '"b" < "a"', '"ab" < "abc"', '"" < "a"', '"a" == "a"', '"a" == "b"',
    '1 == 1', '1 == "1"', 'nil == false', 'nil == nil', '"x" != "y"', 'not nil', 'not 0', 'not ""', 'nil or "default"',
    'false and 1', '1 and 2', '0 or 5', 'true and false or "fallback"', '-0', '0 - 0', 'big * big', '-big * big', 'big * big - big * big', 'big * big * 0',
    '123456789012.5 + 0', '1000000000 * 1000000000 * 1000', '2 * 0.5', '"é" + "😀"', '"tab\\there"', 'true == true', 'true == false',
  ])('print %s', async (expr) => {
    // `big` is 1e200, so big * big overflows to Infinity.
    await same(`let big = 1${'0'.repeat(200)}; print ${expr};`);
  });

  it('compares functions by identity and prints them', async () => {
    await same('fn f() {} fn g() {} print f == f; print f == g; print f; print "fn is " + f;');
  });

  it('runs variables, scope, control flow and recursion', async () => {
    await same('let a = 1; a = a + 41; print a;');
    await same('let a = 0; let b = 0; a = b = 7; print a + b;');
    await same('let x = "global"; { let x = "outer"; { let x = "inner"; print x; } print x; } print x;');
    await same('let x = 1; { let x = x + 1; print x; } print x;');
    for (const n of [3, -3, 0]) await same(`let n = ${n}; if n > 0 { print "pos"; } else if n < 0 { print "neg"; } else { print "zero"; }`);
    await same('false and undefinedThing; true or undefinedThing; print "ok";');
    await same('let i = 0; let s = 0; while i < 5 { s = s + i; i = i + 1; } print s;');
    await same('fn add(a, b) { return a + b; } print add(2, 3);');
    await same('fn f() { let x = 1; } print f();');
    await same('fn fact(n) { if n <= 1 { return 1; } return n * fact(n - 1); } print fact(10);');
    await same('fn a() { return b(); } fn b() { return "b"; } print a();');
    await same('fn f(n) { while true { if n > 3 { return n; } n = n + 1; } } print f(0);');
    await same('fn f() { return; } print f();');
    await same('fn f() { print "first"; } fn f() { print "second"; } f();');
  });

  it.each([
    'print 1 + true;',
    'print 1 - "a";',
    'print "a" * 2;',
    'print nil / 2;',
    'print true % 2;',
    'print -"a";',
    'print 1 < "a";',
    'print "a" >= 2;',
    'print 1 / 0;',
    'print 1 % 0;',
    'print missing;',
    'missing = 1;',
    'let x = 1; x();',
    'let s = "q\\"uote\\n"; s();',
    'fn f(a) {} f();',
    'fn f() {} f(1, 2);',
    'fn f(a, b) {} f(1);',
    'fn f() { return f(); } f();',
    'print "before"; print 1 / 0; print "after";',
    'fn f() {} print f + 1;',
    'print nil + nil;',
    'print true + false;',
  ])('fails exactly like the VM: %s', async (src) => {
    const r = await same(src);
    expect(r.error).not.toBeNull();
  });

  it('runs every built-in example and the README sample', async () => {
    for (const ex of EXAMPLES) {
      const r = await same(ex.source);
      expect(r.output, ex.id).toEqual(ex.expected);
    }
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    await same(/```pane\n([\s\S]*?)```/.exec(readme)![1]!);
  });

  it('builds many strings without running out of memory', async () => {
    const r = await same('let s = ""; let i = 0; while i < 300 { s = s + "x"; i = i + 1; } print s == s; print i;');
    expect(r.output).toEqual(['true', '300']);
  });
});

describe('the WebAssembly module', () => {
  it('names its functions and carries the Pane source and a source map', () => {
    const src = 'fn sq(n) { return n * n; }\nprint sq(4);';
    const b = build(src);
    const w = compileToWasm(b.program, src);
    const pane = w.functions.filter((f) => f.kind === 'pane').map((f) => f.name);
    expect(pane).toEqual(['main', 'sq']);
    expect(w.functions.some((f) => f.name === 'rt.add')).toBe(true);
    // Every instruction of Pane code knows which node and source offset it came from.
    for (const f of w.functions.filter((x) => x.kind === 'pane')) {
      for (const ins of f.body) {
        expect(ins.node).toBeTypeOf('number');
        expect(ins.offset).toBeGreaterThanOrEqual(0);
      }
    }
    const text = new TextDecoder().decode(w.bytes);
    expect(text).toContain('glass.source');
    expect(text).toContain('fn sq(n)');
  });

  it('renames an entry point that would clash with a Pane function called main', async () => {
    const src = 'fn main() { return 1; } print main();';
    const b = build(src);
    const w = compileToWasm(b.program, src);
    expect(w.functions.filter((f) => f.kind === 'pane').map((f) => f.name)).toEqual(['pane.main', 'main']);
    await same(src);
  });
});

describe('source offsets', () => {
  it('converts UTF-16 positions to UTF-8 byte offsets', async () => {
    const { utf8Offsets } = await import('../../src/lang/wasm/codegen');
    const text = 'aé😀b';
    const at = utf8Offsets(text);
    const enc = (s: string) => new TextEncoder().encode(s).length;
    expect(at[0]).toBe(0);
    expect(at[1]).toBe(enc('a'));
    expect(at[2]).toBe(enc('aé'));
    expect(at[4]).toBe(enc('aé😀'));
    expect(at[text.length]).toBe(enc(text));
  });
});
