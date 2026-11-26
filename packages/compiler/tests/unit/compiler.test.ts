import { describe, expect, it } from 'vitest';
import { formatOperand, type Chunk } from '../../src/lang/bytecode';
import { build } from '../../src/lang';

const listing = (chunk: Chunk) =>
  chunk.code.map((i, ip) => (i.arg === undefined ? i.op : `${i.op} ${formatOperand(chunk, i, ip)}`));

const compileOk = (src: string) => {
  const b = build(src);
  expect(b.diagnostics).toEqual([]);
  return b;
};

describe('compiler', () => {
  it('compiles arithmetic in post-order with a constant pool', () => {
    const b = compileOk('print 1 + 2 * 3;');
    expect(listing(b.compiled.chunks[0]!)).toEqual(['CONST 1', 'CONST 2', 'CONST 3', 'MUL', 'ADD', 'PRINT', 'HALT']);
    expect(b.compiled.chunks[0]!.constants).toEqual([1, 2, 3]);
  });

  it('reuses constants', () => {
    const b = compileOk('print 2 + 2;');
    expect(b.compiled.chunks[0]!.constants).toEqual([2]);
  });

  it('emits no code for brackets', () => {
    const a = compileOk('print (1 + 2) * 3;');
    expect(listing(a.compiled.chunks[0]!)).toEqual(['CONST 1', 'CONST 2', 'ADD', 'CONST 3', 'MUL', 'PRINT', 'HALT']);
  });

  it('uses dedicated opcodes for true, false and nil', () => {
    expect(listing(compileOk('print true; print false; print nil;').compiled.chunks[0]!)).toEqual([
      'TRUE', 'PRINT', 'FALSE', 'PRINT', 'NIL', 'PRINT', 'HALT',
    ]);
  });

  it('maps every comparison and arithmetic operator', () => {
    const ops = compileOk('a == b; a != b; a < b; a <= b; a > b; a >= b; a - b; a / b; a % b; -a; not a;')
      .compiled.chunks[0]!.code.map((i) => i.op)
      .filter((op) => !['GET_GLOBAL', 'POP', 'HALT'].includes(op));
    expect(ops).toEqual(['EQ', 'NE', 'LT', 'LE', 'GT', 'GE', 'SUB', 'DIV', 'MOD', 'NEG', 'NOT']);
  });

  it('makes top-level let a global and block-level let a local slot', () => {
    const b = compileOk('let g = 1; { let a = 2; let b = a; print b; }');
    expect(listing(b.compiled.chunks[0]!)).toEqual([
      'CONST 1', 'DEF_GLOBAL g',
      'CONST 2', 'GET_LOCAL [0] a', 'GET_LOCAL [1] b', 'PRINT', 'POP', 'POP',
      'HALT',
    ]);
    expect(b.compiled.chunks[0]!.locals).toEqual([
      { name: 'a', slot: 0, from: 3, to: 7 },
      { name: 'b', slot: 1, from: 4, to: 6 },
    ]);
  });

  it('lets inner blocks shadow outer names', () => {
    const b = compileOk('{ let x = 1; { let x = 2; print x; } print x; }');
    const ops = listing(b.compiled.chunks[0]!);
    expect(ops).toContain('GET_LOCAL [1] x');
    expect(ops).toContain('GET_LOCAL [0] x');
  });

  it('rejects redeclaring a local in the same block', () => {
    expect(build('{ let x = 1; let x = 2; }').diagnostics[0]!.message).toContain('already declared');
  });

  it('allows re-running a top-level let', () => {
    compileOk('let x = 1; let x = 2;');
  });

  it('compiles assignment to locals and globals, leaving the value for the statement to pop', () => {
    const b = compileOk('let g = 0; g = 5; { let l = 0; l = 6; }');
    expect(listing(b.compiled.chunks[0]!)).toEqual([
      'CONST 0', 'DEF_GLOBAL g', 'CONST 5', 'SET_GLOBAL g', 'POP',
      'CONST 0', 'CONST 6', 'SET_LOCAL [0] l', 'POP', 'POP', 'HALT',
    ]);
  });

  it('compiles if/else with forward jumps to absolute addresses', () => {
    const b = compileOk('if true { print 1; } else { print 2; }');
    expect(listing(b.compiled.chunks[0]!)).toEqual([
      'TRUE', 'JUMP_IF_FALSE → 05', 'CONST 1', 'PRINT', 'JUMP → 07', 'CONST 2', 'PRINT', 'HALT',
    ]);
  });

  it('compiles if without else', () => {
    expect(listing(compileOk('if false { print 1; }').compiled.chunks[0]!)).toEqual([
      'FALSE', 'JUMP_IF_FALSE → 04', 'CONST 1', 'PRINT', 'HALT',
    ]);
  });

  it('compiles while loops with a backwards LOOP', () => {
    const b = compileOk('let i = 0; while i < 3 { i = i + 1; }');
    expect(listing(b.compiled.chunks[0]!)).toEqual([
      'CONST 0', 'DEF_GLOBAL i',
      'GET_GLOBAL i', 'CONST 3', 'LT', 'JUMP_IF_FALSE → 12',
      'GET_GLOBAL i', 'CONST 1', 'ADD', 'SET_GLOBAL i', 'POP',
      'LOOP → 02',
      'HALT',
    ]);
  });

  it('compiles and/or with DUP and short-circuit jumps', () => {
    expect(listing(compileOk('print a and b;').compiled.chunks[0]!)).toEqual([
      'GET_GLOBAL a', 'DUP', 'JUMP_IF_FALSE → 05', 'POP', 'GET_GLOBAL b', 'PRINT', 'HALT',
    ]);
    expect(listing(compileOk('print a or b;').compiled.chunks[0]!)[2]).toBe('JUMP_IF_TRUE → 05');
  });

  it('compiles each function into its own chunk', () => {
    const b = compileOk('fn add(a, b) { let s = a + b; return s; } print add(1, 2);');
    const [main, add] = b.compiled.chunks;
    expect(add!.name).toBe('add');
    expect(add!.arity).toBe(2);
    expect(listing(add!)).toEqual(['GET_LOCAL [0] a', 'GET_LOCAL [1] b', 'ADD', 'GET_LOCAL [2] s', 'RETURN', 'NIL', 'RETURN']);
    expect(listing(main!)).toEqual([
      'CONST <fn add>', 'DEF_GLOBAL add', 'GET_GLOBAL add', 'CONST 1', 'CONST 2', 'CALL 2 args', 'PRINT', 'HALT',
    ]);
    expect(add!.locals.map((l) => l.name)).toEqual(['a', 'b', 's']);
  });

  it('adds an implicit "return nil" and supports bare return', () => {
    const b = compileOk('fn f() { return; }');
    expect(listing(b.compiled.chunks[1]!)).toEqual(['NIL', 'RETURN', 'NIL', 'RETURN']);
  });

  it('rejects return outside a function', () => {
    expect(build('return 1;').diagnostics[0]!.message).toContain('only be used inside a function');
  });

  it('rejects nested functions', () => {
    expect(build('fn a() { fn b() {} }').diagnostics[0]!.message).toContain('top level');
    expect(build('{ fn b() {} }').diagnostics[0]!.message).toContain('top level');
  });

  it('tags every instruction with a node that exists and whose span covers it', () => {
    const b = compileOk('fn f(n) { if n < 2 { return n; } return f(n - 1) + f(n - 2); } print f(5) or false;');
    for (const chunk of b.compiled.chunks) {
      for (const instr of chunk.code) {
        const node = b.nodes.get(instr.nodeId);
        expect(node, `${chunk.name} ${instr.op}`).toBeDefined();
        expect(instr.span).toEqual(node!.span);
      }
    }
  });

  it('never throws, even on pathological input', () => {
    for (const src of ['{'.repeat(50000), '('.repeat(50000), `print 1${' + 1'.repeat(20000)};`, 'fn f() {'.repeat(5000)]) {
      const b = build(src);
      expect(b.diagnostics.length).toBeGreaterThan(0);
      expect(b.trace).toBeNull();
    }
  });

  it('does not run programs with compile errors', () => {
    const b = build('print 1 +;');
    expect(b.trace).toBeNull();
    expect(b.diagnostics[0]!.stage).toBe('parser');
  });

  it('sorts diagnostics from every stage by position', () => {
    const b = build('print @ ;\nreturn 1;');
    expect(b.diagnostics.map((d) => d.stage)).toEqual(['lexer', 'parser', 'compiler']);
  });
});
