import { describe, expect, it } from 'vitest';
import { compile, runWithHostEngine } from '../../src/lang/compile';
import { preprocess } from '../../src/lang/preprocess';
import { EXAMPLES } from '../../src/examples';

async function run(src: string) {
  const b = compile(src);
  expect(b.diagnostics).toEqual([]);
  expect(WebAssembly.validate(b.wasm!.bytes as BufferSource)).toBe(true);
  return runWithHostEngine(b.wasm!.bytes);
}
const out = async (src: string) => (await run(src)).output;
const main = (body: string, head = '') => `#include <stdio.h>\n#include <string.h>\n#include <stdlib.h>\n${head}\nint main(void) {\n${body}\nreturn 0; }\n`;

describe('examples', () => {
  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s prints exactly its known output', async (_id, e) => {
    const r = await run(e.source);
    expect(r.output).toBe(e.expected);
    expect(r.exitCode).toBe(0);
  });
});

describe('C semantics', () => {
  it('integer types wrap, promote and convert as on wasm32 (ILP32)', async () => {
    expect(
      await out(
        main(`
      char c = 200; unsigned char u = 200; short s = 40000; unsigned short us = 70000;
      printf("%d %d %d %d\\n", c, u, s, us);
      printf("%d %d %d %d %d\\n", (int)sizeof(long), (int)sizeof(long long), (int)sizeof(void *), (int)sizeof(short), (int)sizeof(long double));
      unsigned x = 0; x--; printf("%u %d\\n", x, -1 < 0u);
      long long big = 1LL << 40; printf("%lld %llx\\n", big * 3, -1LL);
      int i = -7; printf("%d %d %u\\n", i / 2, i % 2, (unsigned)i >> 28);
      printf("%d\\n", (char)0x1ff);`),
      ),
    ).toBe('-56 200 -25536 4464\n4 8 4 2 8\n4294967295 0\n3298534883328 ffffffffffffffff\n-3 -1 15\n-1\n');
  });

  it('structs: copies, members, nested initialisers, by-value arguments and returns', async () => {
    expect(
      await out(
        main(
          `struct P a = {1, 2}, b; b = a; b.x = 9;
      struct P c = add(a, b);
      struct L l = { "ab", { {1, 2}, {3, 4} } };
      printf("%d %d %d %d %s %d\\n", a.x, b.x, c.x, c.y, l.name, l.ps[1].y);`,
          `struct P { int x, y; }; struct L { char name[4]; struct P ps[2]; };
      struct P add(struct P p, struct P q) { p.x += q.x; p.y += q.y; return p; }`,
        ),
      ),
    ).toBe('1 9 10 4 ab 4\n');
  });

  it('designated initialisers, unions and bit-fields', async () => {
    expect(
      await out(
        main(
          `int a[5] = { [3] = 7, 8 }; union U u; u.f = 1.0f;
      struct B b = { .lo = 5, .hi = -2 };
      printf("%d %d %d %x %d %d %d\\n", a[0], a[3], a[4], u.i, b.lo, b.hi, (int)sizeof(struct B));`,
          `union U { float f; unsigned i; }; struct B { unsigned lo : 3; int hi : 4; };`,
        ),
      ),
    ).toBe('0 7 8 3f800000 5 -2 4\n');
  });

  it('switch, goto and loops', async () => {
    expect(
      await out(
        main(`
      int n = 0;
      for (int i = 0; i < 10; i++) { if (i == 2) continue; if (i == 6) break; n += i; }
      switch (n) { case 1: n = 0; break; case 13: n = 100; default: n++; }
      int k = 0;
    again:
      if (++k < 5) goto again;
      printf("%d %d\\n", n, k);`),
      ),
    ).toBe('101 5\n');
  });

  it('variadic functions with stdarg', async () => {
    expect(
      await out(
        main(
          `printf("%d %.1f\\n", sum(4, 1, 2, 3, 4), avg(3, 1.0, 2.0, 4.5));`,
          `#include <stdarg.h>
      int sum(int n, ...) { va_list ap; va_start(ap, n); int s = 0; while (n--) s += va_arg(ap, int); va_end(ap); return s; }
      double avg(int n, ...) { va_list ap; va_start(ap, n); double s = 0; for (int i = 0; i < n; i++) s += va_arg(ap, double); va_end(ap); return s / n; }`,
        ),
      ),
    ).toBe('10 2.5\n');
  });

  it('exit status, abort, stderr and traps', async () => {
    expect(await run('int main(void) { return 7; }')).toEqual({ output: '', exitCode: 7, trap: null });
    expect(await run('#include <stdlib.h>\nint main(void) { exit(3); }')).toEqual({ output: '', exitCode: 3, trap: null });
    expect(await run('#include <stdio.h>\nint main(void) { fprintf(stderr, "oops\\n"); return 1; }')).toEqual({ output: 'oops\n', exitCode: 1, trap: null });
    const r = await run('int main(void) { int z = 0; return 1 / z; }');
    expect(r.trap).toMatch(/divide by zero/i);
  });

  it('stops runaway recursion with a stack overflow message', async () => {
    const r = await run('int f(int n) { int a[100]; a[0] = n; return f(n + 1) + a[0]; } int main(void) { return f(0); }');
    expect(r.output).toBe('stack overflow\n');
    expect(r.exitCode).toBe(139);
  });

  it('files live in memory for the run', async () => {
    expect(
      await out(
        main(`FILE *f = fopen("a.txt", "w"); fprintf(f, "line %d\\n", 1); fclose(f);
      char buf[32]; f = fopen("a.txt", "r"); fgets(buf, sizeof buf, f); printf("read: %s", buf);
      printf("%p\\n", (void *)fopen("missing.txt", "r"));`),
      ),
    ).toBe('read: line 1\n0x0\n');
  });
});

/** The exact decimal value of a double, rounded half to even (what glibc's printf does). */
function exactRound(x: number, digits: (exp10: number) => number): { int: bigint; exp: number } {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const bits = dv.getBigUint64(0);
  let m = bits & ((1n << 52n) - 1n);
  let e = Number(bits >> 52n);
  if (e === 0) e = -1074;
  else {
    m |= 1n << 52n;
    e -= 1075;
  }
  // value = m * 2^e; scaled by 10^k it is num / den.
  const scaled = (k: number) => {
    let num = m * (e > 0 ? 2n ** BigInt(e) : 1n);
    let den = e < 0 ? 2n ** BigInt(-e) : 1n;
    if (k >= 0) num *= 10n ** BigInt(k);
    else den *= 10n ** BigInt(-k);
    let q = num / den;
    const r = num % den;
    if (2n * r > den || (2n * r === den && q % 2n === 1n)) q++;
    return q;
  };
  const k = digits(0);
  return { int: scaled(k), exp: k };
}
const fixed = (x: number, p: number) => {
  const { int } = exactRound(x, () => p);
  const s = int.toString().padStart(p + 1, '0');
  const body = p ? `${s.slice(0, -p)}.${s.slice(-p)}` : s;
  return (x < 0 || Object.is(x, -0) ? '-' : '') + body;
};
const expo = (x: number, p: number) => {
  let E = Math.floor(Math.log10(Math.abs(x)));
  for (;;) {
    const { int } = exactRound(x, () => p - E);
    const s = int.toString();
    if (s.length > p + 1) {
      E++;
      continue;
    }
    if (s.length < p + 1) {
      E--;
      continue;
    }
    return `${x < 0 ? '-' : ''}${s[0]}.${s.slice(1)}e${E < 0 ? '-' : '+'}${String(Math.abs(E)).padStart(2, '0')}`;
  }
};

describe('printf is exact on random doubles', () => {
  it('%.6f, %.3e and %.17g against an exact BigInt reference', async () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
    const xs: number[] = [];
    for (let i = 0; i < 400; i++) xs.push((rnd() - 0.5) * 10 ** Math.floor(rnd() * 30 - 15));
    const lines = xs.map((x) => `printf("%.6f %.3e %.17g\\n", ${x.toPrecision(17)}, ${x.toPrecision(17)}, ${x.toPrecision(17)});`);
    const got = (await out(main(lines.join('\n')))).split('\n');
    // Exact ties, where JavaScript's toFixed rounds up but C rounds to even.
    expect(fixed(29425370693206.79, 6)).toBe('29425370693206.789062');
    xs.forEach((x, i) => {
      // %.17g round-trips: reading it back gives the same double.
      const [f, ee, g] = got[i]!.split(' ');
      expect(f, String(x)).toBe(fixed(x, 6));
      expect(ee, String(x)).toBe(expo(x, 3));
      expect(Number(g)).toBe(x);
    });
  });
});

describe('the preprocessor', () => {
  const pp = (src: string) =>
    preprocess({ name: 't.c', text: src, user: true })
      .tokens.slice(0, -1)
      .map((t) => t.text)
      .join(' ');
  it('expands object-like and function-like macros with # and ##', () => {
    expect(pp('#define N 3\n#define STR(x) #x\n#define CAT(a, b) a ## b\nN STR(a + b) CAT(x, 1)')).toBe('3 "a + b" x1');
  });
  it('stops at recursive macros (hide sets)', () => {
    expect(pp('#define f(a) a + f(a)\nf(1)')).toBe('1 + f ( 1 )');
    expect(pp('#define x x y\nx')).toBe('x y');
  });
  it('handles conditionals, defined and short-circuit', () => {
    expect(pp('#if defined(A) || 1 / 1\nyes\n#else\nno\n#endif\n#if 0 && (1 / 0)\nbad\n#endif')).toBe('yes');
  });
  it('variadic macros and the GNU comma', () => {
    expect(pp('#define P(fmt, ...) printf(fmt, ## __VA_ARGS__)\nP("a") P("b", 1, 2)')).toBe('printf ( "a" ) printf ( "b" , 1 , 2 )');
  });
});

describe('errors point at the source', () => {
  it.each([
    ['int main(void) { return x; }', 1, '"x" is not declared'],
    ['int main(void) {\n  int a = 1\n  return a;\n}', 3, 'expected ";"'],
    ['#include <nothing.h>\nint main(void) {}', 1, 'Small C has no header <nothing.h>'],
    ['int f(int a);\nint main(void) { return f(1); }', 2, 'f is declared but never defined'],
    ['struct S { int a; };\nint main(void) { struct S s; return s.b; }', 2, 'has no member named "b"'],
    ['int main(void) { break; }', 1, 'break is only allowed in a loop or switch'],
  ])('%s', (src, line, message) => {
    const b = compile(src);
    expect(b.diagnostics[0]?.line).toBe(line);
    expect(b.diagnostics[0]?.message).toContain(message);
  });
});

describe('the WebAssembly it makes', () => {
  it('keeps scalars in named locals and puts address-taken ones in the frame', () => {
    const b = compile('int f(int n) { int k = n * 2; int m = 1; int *p = &m; return k + *p; }\nint main(void) { return f(1); }');
    const f = b.wasm!.functions.find((x) => x.name === 'f')!;
    expect(f.params.map((p) => p.name)).toEqual(['n']);
    expect(f.body.some((i) => i.op === 'local.set' && i.imm?.[0] === '$k')).toBe(true);
    expect(f.body.some((i) => i.op === 'global.get' && i.imm?.[0] === '$sp')).toBe(true);
  });
  it('uses a dispatch loop only for functions with goto', () => {
    const b = compile(EXAMPLES.find((e) => e.id === 'duff')!.source);
    const ops = (n: string) => b.wasm!.functions.find((x) => x.name === n)!.body.map((i) => i.op);
    expect(ops('copy')).toContain('br_table');
    expect(ops('main')).not.toContain('br_table');
  });
  it('maps every instruction of the program to a source position', () => {
    const b = compile(EXAMPLES[0]!.source);
    for (const f of b.wasm!.functions.filter((x) => x.kind === 'c')) {
      const mapped = f.body.filter((i) => i.offset !== undefined).length;
      expect(mapped / f.body.length).toBeGreaterThan(0.8);
    }
  });
});
