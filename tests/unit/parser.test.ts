import { describe, expect, it } from 'vitest';
import { walk, type Expr, type Node, type Stmt } from '../../src/lang/ast';
import { lex } from '../../src/lang/lexer';
import { OPERATOR_TABLE, parse } from '../../src/lang/parser';

const parseSrc = (src: string) => parse(lex(src).tokens);

/** Render an expression as a fully bracketed S-expression. */
function sexpr(e: Node): string {
  switch (e.type) {
    case 'Literal':
      return e.value === null ? 'nil' : typeof e.value === 'string' ? JSON.stringify(e.value) : String(e.value);
    case 'Variable':
      return e.name;
    case 'Assign':
      return `(= ${e.name} ${sexpr(e.value)})`;
    case 'Unary':
      return `(${e.op} ${sexpr(e.operand)})`;
    case 'Binary':
    case 'Logical':
      return `(${e.op} ${sexpr(e.left)} ${sexpr(e.right)})`;
    case 'Call':
      return `(call ${sexpr(e.callee)}${e.args.map((a) => ' ' + sexpr(a)).join('')})`;
    case 'Group':
      return `(group ${sexpr(e.expr)})`;
    default:
      return e.type;
  }
}

const expr = (src: string): string => {
  const { program, errors } = parseSrc(`${src};`);
  expect(errors).toEqual([]);
  const stmt = program.body[0] as Extract<Stmt, { type: 'ExprStmt' }>;
  return sexpr(stmt.expr);
};

describe('parser: expressions (Pratt)', () => {
  it.each([
    ['1 + 2 * 3', '(+ 1 (* 2 3))'],
    ['1 * 2 + 3', '(+ (* 1 2) 3)'],
    ['10 - 4 - 3', '(- (- 10 4) 3)'],
    ['8 / 4 / 2', '(/ (/ 8 4) 2)'],
    ['7 % 4 * 2', '(* (% 7 4) 2)'],
    ['(1 + 2) * 3', '(* (group (+ 1 2)) 3)'],
    ['-1 * 2', '(* (- 1) 2)'],
    ['--x', '(- (- x))'],
    ['-f(1)', '(- (call f 1))'],
    ['1 < 2 == true', '(== (< 1 2) true)'],
    ['a or b and c', '(or a (and b c))'],
    ['a and b or c', '(or (and a b) c)'],
    ['not a == b', '(not (== a b))'],
    ['not a and b', '(and (not a) b)'],
    ['a = b = 3', '(= a (= b 3))'],
    ['x = 1 + 2', '(= x (+ 1 2))'],
    ['f()', '(call f)'],
    ['f(1, 2 + 3)(4)', '(call (call f 1 (+ 2 3)) 4)'],
    ['"a" + nil', '(+ "a" nil)'],
    ['a >= b != c <= d', '(!= (>= a b) (<= c d))'],
  ])('%s  →  %s', (src, want) => {
    expect(expr(src)).toBe(want);
  });

  it('rejects assignment to something that is not a variable', () => {
    const { errors } = parseSrc('1 + 2 = 3;');
    expect(errors[0]!.message).toContain('Only a variable name');
  });

  it('reports a missing operand', () => {
    const { errors } = parseSrc('print 1 + ;');
    expect(errors[0]!.message).toBe('Expected a value or expression, but found ";".');
    expect(errors[0]!.span).toEqual({ start: 10, end: 11 });
  });

  it('reports an unclosed bracket', () => {
    const { errors } = parseSrc('print (1 + 2;');
    expect(errors[0]!.message).toContain('to close the bracket');
  });

  it('guards against absurd nesting', () => {
    const { errors } = parseSrc(`print ${'('.repeat(500)}1${')'.repeat(500)};`);
    expect(errors[0]!.message).toContain('nested too deeply');
  });

  it('exports an operator table that matches the parser', () => {
    const sum = OPERATOR_TABLE.find((o) => o.name === 'sum')!;
    const product = OPERATOR_TABLE.find((o) => o.name === 'product')!;
    expect(product.left).toBeGreaterThan(sum.left);
    for (const o of OPERATOR_TABLE) {
      if (o.assoc === 'left') expect(o.right).toBe(o.left + 1);
      if (o.assoc === 'right') expect(o.right).toBe(o.left - 1);
    }
  });
});

describe('parser: statements', () => {
  it('parses let, print and expression statements', () => {
    const { program, errors } = parseSrc('let x = 1; print x; x = 2;');
    expect(errors).toEqual([]);
    expect(program.body.map((s) => s.type)).toEqual(['Let', 'Print', 'ExprStmt']);
  });

  it('parses if / else if / else chains', () => {
    const { program, errors } = parseSrc('if a { print 1; } else if b { print 2; } else { print 3; }');
    expect(errors).toEqual([]);
    const outer = program.body[0] as Extract<Stmt, { type: 'If' }>;
    expect(outer.otherwise?.type).toBe('If');
    const inner = outer.otherwise as Extract<Stmt, { type: 'If' }>;
    expect(inner.otherwise?.type).toBe('Block');
  });

  it('parses while loops and nested blocks', () => {
    const { program, errors } = parseSrc('while x < 3 { { x = x + 1; } }');
    expect(errors).toEqual([]);
    const loop = program.body[0] as Extract<Stmt, { type: 'While' }>;
    expect(sexpr(loop.cond)).toBe('(< x 3)');
    expect(loop.body.body[0]!.type).toBe('Block');
  });

  it('parses functions with parameters and returns', () => {
    const { program, errors } = parseSrc('fn add(a, b) { return a + b; } fn none() { return; }');
    expect(errors).toEqual([]);
    const add = program.body[0] as Extract<Stmt, { type: 'Fn' }>;
    expect(add.params).toEqual(['a', 'b']);
    const none = program.body[1] as Extract<Stmt, { type: 'Fn' }>;
    expect((none.body.body[0] as Extract<Stmt, { type: 'Return' }>).value).toBeNull();
  });

  it('rejects duplicate parameters', () => {
    expect(parseSrc('fn f(a, a) {}').errors[0]!.message).toContain('listed twice');
  });

  it('requires an initial value for let', () => {
    expect(parseSrc('let x;').errors[0]!.message).toContain('every variable needs a starting value');
  });

  it('requires semicolons', () => {
    const { errors } = parseSrc('print 1\nprint 2;');
    expect(errors[0]!.message).toBe('Expected ";" after the value to print, but found "print".');
  });

  it('recovers and reports several errors in one pass', () => {
    const { program, errors } = parseSrc('let = 1;\nprint 2;\nlet y = ;\nprint 3;');
    expect(errors).toHaveLength(2);
    expect(program.body.filter((s) => s.type === 'Print')).toHaveLength(2);
  });

  it('reports a missing closing brace', () => {
    const { errors } = parseSrc('while true { print 1;');
    expect(errors.some((e) => e.message.includes('missing its closing "}"'))).toBe(true);
  });

  it('reports stray closing braces and keeps parsing', () => {
    const { program, errors } = parseSrc('} print 1;');
    expect(errors).toHaveLength(1);
    expect(program.body).toHaveLength(1);
  });

  it('never loops forever on garbage', () => {
    const { errors } = parseSrc(') ) , ; = else { fn ( let');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('parser: node identity and token ownership', () => {
  const src = 'let total = (1 + 2) * x;\nfn f(a, b) { return f(a, b); }\nif not total { print -1; } else { total = 0; }';
  const { program, tokenOwner, nodes, errors } = parseSrc(src);
  const tokens = lex(src).tokens;

  it('parses without errors', () => {
    expect(errors).toEqual([]);
  });

  it('gives every node a unique id that is in the node map', () => {
    const seen = new Set<number>();
    walk(program, (n) => {
      expect(seen.has(n.id)).toBe(false);
      seen.add(n.id);
      expect(nodes.get(n.id)).toBe(n);
    });
    expect(seen.size).toBe(nodes.size);
  });

  it('gives every token except EOF an owning node', () => {
    tokens.forEach((t, i) => {
      if (t.kind === 'EOF') expect(tokenOwner[i]).toBe(-1);
      else expect(nodes.has(tokenOwner[i]!), `token ${t.lexeme} at ${t.span.start}`).toBe(true);
    });
  });

  it('assigns operators to their own node', () => {
    const plus = tokens.find((t) => t.kind === 'PLUS')!;
    const owner = nodes.get(tokenOwner[plus.index]!) as Expr;
    expect(owner).toMatchObject({ type: 'Binary', op: '+' });
  });

  it('gives an assignment its name token and "="', () => {
    const eqs = tokens.filter((t) => t.kind === 'EQ');
    const last = eqs.at(-1)!;
    const owner = nodes.get(tokenOwner[last.index]!)!;
    expect(owner.type).toBe('Assign');
    expect(tokenOwner[last.index - 1]).toBe(owner.id);
  });

  it('nests node spans inside their parents', () => {
    walk(program, (n, parent) => {
      expect(n.span.start).toBeLessThanOrEqual(n.span.end);
      if (parent) {
        expect(n.span.start).toBeGreaterThanOrEqual(parent.span.start);
        expect(n.span.end).toBeLessThanOrEqual(parent.span.end);
      }
    });
  });

  it('makes each node span cover the tokens it owns', () => {
    tokens.forEach((t, i) => {
      const owner = nodes.get(tokenOwner[i]!);
      if (!owner) return;
      expect(t.span.start).toBeGreaterThanOrEqual(owner.span.start);
      expect(t.span.end).toBeLessThanOrEqual(owner.span.end);
    });
  });
});
