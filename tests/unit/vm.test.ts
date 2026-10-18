import { describe, expect, it } from 'vitest';
import { build, run, MAX_FRAMES } from '../../src/lang';
import { EXAMPLES } from '../../src/examples';

const exec = (src: string) => {
  const b = build(src);
  expect(b.diagnostics).toEqual([]);
  return b.trace!;
};
const out = (src: string) => {
  const t = exec(src);
  expect(t.error).toBeUndefined();
  return t.output.map((l) => l.text);
};
const failure = (src: string) => {
  const t = exec(src);
  expect(t.status).toBe('error');
  return t.error!;
};

describe('vm: values and operators', () => {
  it.each([
    ['1 + 2 * 3', '7'],
    ['(1 + 2) * 3', '9'],
    ['10 - 4 - 3', '3'],
    ['7 / 2', '3.5'],
    ['7 % 3', '1'],
    ['-(2 + 3)', '-5'],
    ['0.1 + 0.2', '0.3'],
    ['1 / 3', '0.333333333333'],
    ['"glass" + "pane"', 'glasspane'],
    ['"n = " + 3', 'n = 3'],
    ['1 + " pane"', '1 pane'],
    ['"is " + true + " " + nil', 'is true nil'],
    ['1 < 2', 'true'],
    ['2 <= 2', 'true'],
    ['3 > 4', 'false'],
    ['3 >= 4', 'false'],
    ['"a" < "b"', 'true'],
    ['1 == 1', 'true'],
    ['1 == "1"', 'false'],
    ['nil == false', 'false'],
    ['nil == nil', 'true'],
    ['"x" != "y"', 'true'],
    ['not nil', 'true'],
    ['not 0', 'false'],
    ['not ""', 'false'],
    ['nil or "default"', 'default'],
    ['false and 1', 'false'],
    ['1 and 2', '2'],
    ['0 or 5', '0'],
  ])('%s prints %s', (src, want) => {
    expect(out(`print ${src};`)).toEqual([want]);
  });

  it('compares functions by identity', () => {
    expect(out('fn f() {} fn g() {} print f == f; print f == g; print f;')).toEqual(['true', 'false', '<fn f>']);
  });
});

describe('vm: variables, control flow and functions', () => {
  it('reads and writes globals', () => {
    expect(out('let a = 1; a = a + 41; print a;')).toEqual(['42']);
  });

  it('chains assignment right to left', () => {
    expect(out('let a = 0; let b = 0; a = b = 7; print a + b;')).toEqual(['14']);
  });

  it('scopes locals to their block and shadows correctly', () => {
    expect(out('let x = "global"; { let x = "outer"; { let x = "inner"; print x; } print x; } print x;')).toEqual([
      'inner', 'outer', 'global',
    ]);
  });

  it('lets a block initialise a local from an outer variable of the same name', () => {
    expect(out('let x = 1; { let x = x + 1; print x; } print x;')).toEqual(['2', '1']);
  });

  it('runs if / else if / else', () => {
    const src = (n: number) => `let n = ${n}; if n > 0 { print "pos"; } else if n < 0 { print "neg"; } else { print "zero"; }`;
    expect(out(src(3))).toEqual(['pos']);
    expect(out(src(-3))).toEqual(['neg']);
    expect(out(src(0))).toEqual(['zero']);
  });

  it('short-circuits and/or without evaluating the right side', () => {
    expect(out('false and undefinedThing; true or undefinedThing; print "ok";')).toEqual(['ok']);
  });

  it('runs while loops', () => {
    expect(out('let i = 0; let s = 0; while i < 5 { s = s + i; i = i + 1; } print s;')).toEqual(['10']);
  });

  it('keeps the stack balanced across loops with locals', () => {
    const t = exec('let i = 0; while i < 3 { let sq = i * i; i = i + 1; }');
    expect(t.snapshots.at(-1)!.stack).toEqual([]);
  });

  it('calls functions with arguments and returns values', () => {
    expect(out('fn add(a, b) { return a + b; } print add(2, 3);')).toEqual(['5']);
  });

  it('returns nil when a function falls off the end', () => {
    expect(out('fn f() { let x = 1; } print f();')).toEqual(['nil']);
  });

  it('supports recursion', () => {
    expect(out('fn fact(n) { if n <= 1 { return 1; } return n * fact(n - 1); } print fact(10);')).toEqual(['3628800']);
  });

  it('supports calling functions declared later, at run time', () => {
    expect(out('fn a() { return b(); } fn b() { return "b"; } print a();')).toEqual(['b']);
  });

  it('leaves only the result on the stack after a call', () => {
    const t = exec('fn f(a, b) { let c = a * b; return c; } let r = f(6, 7);');
    expect(t.snapshots.at(-1)!.stack).toEqual([]);
    expect(t.snapshots.at(-1)!.globals).toContainEqual(['r', 42]);
  });

  it('runs every built-in example and prints what it promises', () => {
    for (const ex of EXAMPLES) {
      expect(out(ex.source), ex.id).toEqual(ex.expected);
      expect(exec(ex.source).status, ex.id).toBe('finished');
    }
  });
});

describe('vm: runtime errors', () => {
  it.each([
    ['print 1 + true;', "Can't add a number (1) and a boolean (true)."],
    ['print 1 - "a";', 'both must be numbers'],
    ['print -"a";', "Can't negate"],
    ['print 1 < "a";', "Can't compare"],
    ['print 1 / 0;', 'Division by zero.'],
    ['print 1 % 0;', 'division by zero'],
    ['print missing;', '"missing" has not been defined'],
    ['missing = 1;', 'Can\'t assign to "missing"'],
    ['let x = 1; x();', "Can't call a number (1)"],
    ['fn f(a) {} f();', 'f() expects 1 argument but got 0.'],
    ['fn f() {} f(1, 2);', 'f() expects 0 arguments but got 2.'],
  ])('%s', (src, message) => {
    expect(failure(src).message).toContain(message);
  });

  it('points runtime errors at the node and step that failed', () => {
    const src = 'let a = 1;\nprint a + nil;';
    const b = build(src);
    const err = b.trace!.error!;
    expect(src.slice(err.span.start, err.span.end)).toBe('a + nil');
    expect(b.nodes.get(err.nodeId!)!.type).toBe('Binary');
    const snap = b.trace!.snapshots[err.step]!;
    expect(b.compiled.chunks[snap.at!.chunk]!.code[snap.at!.ip]!.op).toBe('ADD');
  });

  it('keeps output printed before the error', () => {
    const t = exec('print "before"; print 1 / 0; print "after";');
    expect(t.output.map((l) => l.text)).toEqual(['before']);
  });

  it('shows the machine as it was just before the failure', () => {
    const t = exec('print 1 + true;');
    expect(t.snapshots.at(-1)!.stack).toEqual([1, true]);
    expect(t.snapshots.at(-1)!.at).toBeNull();
  });

  it('stops runaway recursion', () => {
    const err = failure('fn f() { return f(); } f();');
    expect(err.message).toContain(`more than ${MAX_FRAMES}`);
  });

  it('stops infinite loops at the step limit', () => {
    const b = build('while true { }');
    const t = run(b.compiled, 500);
    expect(t.status).toBe('step-limit');
    expect(t.error!.message).toContain('500 steps');
    expect(t.snapshots).toHaveLength(501);
  });
});

describe('vm: trace', () => {
  it('records a snapshot before every instruction plus the final state', () => {
    const t = exec('print 1 + 2;');
    // CONST, CONST, ADD, PRINT, HALT + final
    expect(t.snapshots).toHaveLength(6);
    expect(t.snapshots.map((s) => s.stack)).toEqual([[], [1], [1, 2], [3], [], []]);
    expect(t.snapshots.map((s) => s.at?.ip ?? null)).toEqual([0, 1, 2, 3, 4, null]);
  });

  it('records which step printed each line', () => {
    const t = exec('print "a"; print "b";');
    expect(t.output).toEqual([
      { text: 'a', step: 1 },
      { text: 'b', step: 3 },
    ]);
    expect(t.snapshots.map((s) => s.outputLength)).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it('records frames with named locals', () => {
    const b = build('fn sq(n) { let r = n * n; return r; } print sq(4);');
    const t = b.trace!;
    const inside = t.snapshots.find((s) => s.frames.length === 2 && s.frames[1]!.locals.length === 2)!;
    expect(inside.frames.map((f) => f.name)).toEqual(['main', 'sq']);
    expect(inside.frames[1]!.locals).toEqual([
      { name: 'n', slot: 0, value: 4 },
      { name: 'r', slot: 1, value: 16 },
    ]);
    expect(inside.frames[1]!.base).toBe(1);
  });

  it('records globals at each step', () => {
    const t = exec('let a = 1; let b = 2;');
    expect(t.snapshots.at(-1)!.globals).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    expect(t.snapshots[0]!.globals).toEqual([]);
  });
});
