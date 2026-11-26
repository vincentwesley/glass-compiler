// The preprocessor (C11 6.10): #include of the built-in headers, object- and
// function-like macros with # and ##, conditional inclusion, and the predefined
// macros. Macro expansion follows Prosser's algorithm with hide sets, as in
// chibicc, so recursive macros stop where the standard says they do.

import { HEADERS } from './headers';
import { CompileError, convertChar, convertNumber, convertString, errorAt, KEYWORDS, tokenize, type SourceFile, type Token } from './tokenize';

interface Macro {
  name: string;
  objlike: boolean;
  params: string[];
  /** The name of the variadic parameter (`__VA_ARGS__` unless named, as in `args...`). */
  va?: string;
  body: Token[];
  /** Predefined dynamic macros (__LINE__, __FILE__, __COUNTER__). */
  dynamic?: (tok: Token) => Token;
}

const copy = (t: Token, extra: Partial<Token> = {}): Token => ({ ...t, ...extra });

/** Tokens are read back to front from `buf` (a stack), so pushing an expansion is cheap. */
class Stream {
  buf: Token[];
  constructor(tokens: Token[]) {
    this.buf = [...tokens].reverse();
  }
  peek(): Token {
    return this.buf[this.buf.length - 1]!;
  }
  next(): Token {
    const t = this.buf.pop()!;
    if (!t) throw new Error('preprocessor read past the end');
    return t;
  }
  unshift(tokens: Token[]) {
    for (let i = tokens.length - 1; i >= 0; i--) this.buf.push(tokens[i]!);
  }
}

const isDirectiveStart = (t: Token) => t.kind === 'punct' && t.text === '#' && t.atBol && !t.origin;

function stringize(tokens: Token[], at: Token): Token {
  let s = '';
  tokens.forEach((t, i) => {
    if (i > 0 && t.hasSpace) s += ' ';
    s += t.text;
  });
  const text = `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  return copy(at, { kind: 'str', text, hideset: undefined });
}

export interface PreprocessResult {
  tokens: Token[];
  /** Every header the program included. */
  includes: string[];
}

export function preprocess(file: SourceFile, predefined: Record<string, string> = {}): PreprocessResult {
  const macros = new Map<string, Macro>();
  const pushed = new Map<string, (Macro | undefined)[]>();
  const lineDelta = new Map<SourceFile, number>();
  const fileName = new Map<SourceFile, string>();
  const includes: string[] = [];
  const onceFiles = new Set<string>();
  let counter = 0;

  const define = (name: string, text: string) => {
    const f: SourceFile = { name: '<built-in>', text, user: false };
    const body = tokenize(f).slice(0, -1);
    macros.set(name, { name, objlike: true, params: [], body });
  };
  for (const [k, v] of Object.entries({ ...PREDEFINED, ...predefined })) define(k, v);
  macros.set('__LINE__', {
    name: '__LINE__',
    objlike: true,
    params: [],
    body: [],
    dynamic: (t) => {
      const o = t.origin ?? t;
      return copy(t, { kind: 'pp-num', text: String(o.line + (lineDelta.get(o.file) ?? 0)) });
    },
  });
  macros.set('__FILE__', {
    name: '__FILE__',
    objlike: true,
    params: [],
    body: [],
    dynamic: (t) => {
      const o = t.origin ?? t;
      return copy(t, { kind: 'str', text: JSON.stringify(fileName.get(o.file) ?? o.file.name) });
    },
  });
  macros.set('__COUNTER__', { name: '__COUNTER__', objlike: true, params: [], body: [], dynamic: (t) => copy(t, { kind: 'pp-num', text: String(counter++) }) });

  const readLine = (s: Stream, first: Token): Token[] => {
    const line: Token[] = [];
    while (!(s.peek().atBol && !s.peek().origin) && s.peek().kind !== 'eof') line.push(s.next());
    void first;
    return line;
  };

  // ------------------------------------------------------------ macro expansion

  const readArgs = (s: Stream, m: Macro, nameTok: Token): { args: Token[][]; rparen: Token } => {
    s.next(); // (
    const args: Token[][] = [];
    let cur: Token[] = [];
    let depth = 0;
    const named = m.params.length;
    for (;;) {
      const t = s.next();
      if (t.kind === 'eof') throw errorAt(nameTok, `unterminated call of macro ${m.name}: no closing )`);
      if (depth === 0 && t.kind === 'punct' && t.text === ')') {
        args.push(cur);
        // `F()` with one parameter is one empty argument; with none it is no arguments.
        if (named === 0 && !m.va && args.length === 1 && args[0]!.length === 0) args.length = 0;
        if (m.va && args.length === named) args.push([]); // empty variadic part
        if (args.length !== named + (m.va ? 1 : 0))
          throw errorAt(nameTok, `macro ${m.name} takes ${named}${m.va ? ' or more' : ''} argument${named === 1 ? '' : 's'}, but got ${args.length}`);
        return { args, rparen: t };
      }
      if (t.kind === 'punct' && t.text === '(') depth++;
      if (t.kind === 'punct' && t.text === ')') depth--;
      if (depth === 0 && t.kind === 'punct' && t.text === ',' && !(m.va && args.length === named)) {
        args.push(cur);
        cur = [];
        continue;
      }
      cur.push(copy(t, { atBol: false }));
    }
  };

  const paste = (lhs: Token, rhs: Token): Token => {
    const text = lhs.text + rhs.text;
    const toks = tokenize({ name: lhs.file.name, text, user: false });
    if (toks.length !== 2) throw errorAt(lhs, `pasting "${lhs.text}" and "${rhs.text}" does not give a valid token`);
    return copy(lhs, { kind: toks[0]!.kind, text, hideset: lhs.hideset });
  };

  /** Fully macro-expands a token list on its own (for macro arguments and #if lines). */
  const expandAll = (tokens: Token[]): Token[] => {
    const eof = { ...(tokens[tokens.length - 1] ?? PLACEHOLDER), kind: 'eof' as const, text: '' };
    const s = new Stream([...tokens, eof]);
    const out: Token[] = [];
    while (s.peek() !== eof) {
      const t = s.next();
      if (expand(s, t)) continue;
      out.push(t);
    }
    return out;
  };

  const subst = (m: Macro, args: Token[][]): Token[] => {
    const argOf = (t: Token | undefined): Token[] | undefined => {
      if (!t || t.kind !== 'ident') return undefined;
      const i = m.params.indexOf(t.text);
      if (i >= 0) return args[i];
      if (m.va && t.text === m.va) return args[m.params.length];
      return undefined;
    };
    const isVa = (t: Token | undefined) => !!m.va && t?.kind === 'ident' && t.text === m.va;
    const expanded = new Map<Token[], Token[]>();
    const expandedArg = (a: Token[]) => {
      let e = expanded.get(a);
      if (!e) expanded.set(a, (e = expandAll(a)));
      return e;
    };
    const out: Token[] = [];
    const body = m.body;
    for (let i = 0; i < body.length; i++) {
      const t = body[i]!;
      const next = body[i + 1];
      if (t.text === '#' && t.kind === 'punct' && !m.objlike) {
        const a = argOf(next);
        if (!a) throw errorAt(t, "'#' must be followed by a macro parameter");
        out.push(stringize(a, t));
        i++;
        continue;
      }
      // [GNU] `, ## __VA_ARGS__` drops the comma when there are no variadic arguments.
      if (t.text === ',' && next?.text === '##' && isVa(body[i + 2])) {
        const a = argOf(body[i + 2])!;
        if (a.length === 0) i += 2;
        else {
          out.push(t);
          i += 1;
          // __VA_ARGS__ itself is then substituted (expanded) on the next turn.
        }
        continue;
      }
      if (t.text === '##' && t.kind === 'punct') {
        if (out.length === 0) throw errorAt(t, "'##' cannot be at the start of a macro");
        if (!next) throw errorAt(t, "'##' cannot be at the end of a macro");
        const a = argOf(next);
        if (a) {
          if (a.length > 0) {
            out[out.length - 1] = paste(out[out.length - 1]!, a[0]!);
            out.push(...a.slice(1));
          }
        } else out[out.length - 1] = paste(out[out.length - 1]!, next);
        i++;
        continue;
      }
      const a = argOf(t);
      if (a && next?.text === '##') {
        const rhs = body[i + 2];
        if (a.length === 0) {
          const a2 = argOf(rhs);
          if (a2) out.push(...a2);
          else if (rhs) out.push(rhs);
          i += 2;
          continue;
        }
        out.push(...a);
        continue;
      }
      if (a) {
        const e = expandedArg(a).map((x, k) => (k === 0 ? copy(x, { hasSpace: t.hasSpace }) : x));
        out.push(...e);
        continue;
      }
      out.push(t);
    }
    return out;
  };

  /** If `t` names a macro that may expand here, pushes its expansion onto `s` and returns true. */
  const expand = (s: Stream, t: Token): boolean => {
    if (t.kind !== 'ident' || t.hideset?.has(t.text)) return false;
    const m = macros.get(t.text);
    if (!m) return false;
    const origin = t.origin ?? t;
    if (m.dynamic) {
      s.unshift([copy(m.dynamic(t), { origin })]);
      return true;
    }
    if (m.objlike) {
      const hs = new Set(t.hideset ?? []);
      hs.add(m.name);
      const body = m.body.map((b, i) => copy(b, { hideset: union(b.hideset, hs), origin, atBol: false, hasSpace: i === 0 ? t.hasSpace : b.hasSpace }));
      s.unshift(subst({ ...m, body }, []).map((b) => copy(b, { hideset: union(b.hideset, hs), origin })));
      return true;
    }
    const p = s.peek();
    if (!(p.kind === 'punct' && p.text === '(')) return false;
    const { args, rparen } = readArgs(s, m, t);
    const hs = intersect(t.hideset, rparen.hideset);
    hs.add(m.name);
    const out = subst(m, args).map((b, i) => copy(b, { hideset: union(b.hideset, hs), origin, atBol: false, hasSpace: i === 0 ? t.hasSpace : b.hasSpace }));
    s.unshift(out);
    return true;
  };

  // ------------------------------------------------------------ directives

  const readDefine = (line: Token[], at: Token) => {
    const name = line[0];
    if (!name || name.kind !== 'ident') throw errorAt(name ?? at, '#define needs a macro name');
    if (name.text === 'defined') throw errorAt(name, '"defined" cannot be a macro name');
    const rest = line.slice(1);
    // Function-like only when ( follows the name with no space between.
    if (rest[0]?.text === '(' && !rest[0].hasSpace) {
      const params: string[] = [];
      let va: string | undefined;
      let i = 1;
      if (rest[i]?.text === ')') i++;
      else
        for (;;) {
          const p = rest[i];
          if (!p) throw errorAt(name, `#define ${name.text}: the parameter list has no closing )`);
          if (p.text === '...') {
            va = '__VA_ARGS__';
            if (rest[i + 1]?.text !== ')') throw errorAt(p, "'...' must be the last parameter");
            i += 2;
            break;
          }
          if (p.kind !== 'ident') throw errorAt(p, `expected a parameter name, found "${p.text}"`);
          if (rest[i + 1]?.text === '...') {
            va = p.text;
            if (rest[i + 2]?.text !== ')') throw errorAt(p, "'...' must be the last parameter");
            i += 3;
            break;
          }
          params.push(p.text);
          const sep = rest[i + 1];
          if (sep?.text === ')') {
            i += 2;
            break;
          }
          if (sep?.text !== ',') throw errorAt(sep ?? p, `expected , or ) in the parameter list of ${name.text}`);
          i += 2;
        }
      macros.set(name.text, { name: name.text, objlike: false, params, va, body: rest.slice(i) });
    } else macros.set(name.text, { name: name.text, objlike: true, params: [], body: rest });
  };

  const evalIf = (line: Token[], at: Token): boolean => {
    // `defined X` and `defined(X)` first, before expanding anything else.
    const pre: Token[] = [];
    for (let i = 0; i < line.length; i++) {
      const t = line[i]!;
      if (t.kind === 'ident' && t.text === 'defined') {
        const paren = line[i + 1]?.text === '(';
        const n = line[i + (paren ? 2 : 1)];
        if (!n || n.kind !== 'ident') throw errorAt(t, '"defined" needs a macro name');
        if (paren && line[i + 3]?.text !== ')') throw errorAt(t, 'defined( has no closing )');
        pre.push(copy(t, { kind: 'pp-num', text: macros.has(n.text) ? '1' : '0' }));
        i += paren ? 3 : 1;
        continue;
      }
      pre.push(t);
    }
    const toks = expandAll(pre).map((t) => {
      if (t.kind === 'ident') return copy(t, { kind: 'pp-num', text: '0' }); // unknown names are 0
      return t;
    });
    if (toks.length === 0) throw errorAt(at, '#if needs an expression');
    return new IfEval(toks, at).run() !== 0n;
  };

  /** Skips to the matching #elif/#else/#endif (not consuming it). */
  const skipCond = (s: Stream) => {
    let depth = 0;
    for (;;) {
      const t = s.peek();
      if (t.kind === 'eof') return;
      if (isDirectiveStart(t)) {
        const d = s.buf[s.buf.length - 2];
        const name = d && !d.atBol ? d.text : '';
        if (name === 'if' || name === 'ifdef' || name === 'ifndef') depth++;
        else if (depth > 0 && name === 'endif') depth--;
        else if (depth === 0 && (name === 'elif' || name === 'else' || name === 'endif')) return;
      }
      s.next();
    }
  };

  type Cond = { tok: Token; ctx: 'then' | 'elif' | 'else'; included: boolean };
  const conds: Cond[] = [];
  const out: Token[] = [];
  const s = new Stream(tokenize(file));
  // Built-in function-like macros.
  for (const line of PRELUDE.split('\n')) {
    if (!line) continue;
    const toks = tokenize({ name: '<built-in>', text: line, user: false });
    readDefine(toks.slice(2, -1), toks[1]!);
  }

  const include = (name: string, at: Token) => {
    const text = HEADERS[name];
    if (text === undefined) {
      throw errorAt(at, `Small C has no header <${name}>. It has: ${Object.keys(HEADERS).sort().join(', ')}`);
    }
    if (!includes.includes(name)) includes.push(name);
    if (onceFiles.has(name)) return;
    const toks = tokenize({ name, text, user: false });
    toks.pop(); // eof
    s.unshift(toks);
  };

  for (;;) {
    const t = s.next();
    if (t.kind === 'eof') break;
    if (expand(s, t)) continue;
    if (!isDirectiveStart(t)) {
      out.push(t);
      continue;
    }
    const d = s.peek();
    if (d.atBol || d.kind === 'eof') continue; // null directive
    s.next();
    const line = readLine(s, d);
    switch (d.text) {
      case 'include': {
        const first = line[0];
        let name: string;
        if (first?.kind === 'str') name = first.text.slice(1, -1);
        else if (first?.text === '<') {
          const close = line.findIndex((x) => x.text === '>');
          if (close < 0) throw errorAt(first, '#include < has no closing >');
          name = line
            .slice(1, close)
            .map((x, i) => (i > 0 && x.hasSpace ? ' ' : '') + x.text)
            .join('');
        } else {
          // A macro that expands to a header name.
          const e = expandAll(line);
          if (e[0]?.kind === 'str') name = e[0].text.slice(1, -1);
          else if (e[0]?.text === '<') name = e.slice(1, e.findIndex((x) => x.text === '>')).map((x) => x.text).join('');
          else throw errorAt(d, '#include needs "file" or <file>');
        }
        include(name, d);
        break;
      }
      case 'define':
        readDefine(line, d);
        break;
      case 'undef':
        if (line[0]?.kind !== 'ident') throw errorAt(d, '#undef needs a macro name');
        macros.delete(line[0].text);
        break;
      case 'if':
      case 'ifdef':
      case 'ifndef': {
        let ok: boolean;
        if (d.text === 'if') ok = evalIf(line, d);
        else {
          if (line[0]?.kind !== 'ident') throw errorAt(d, `#${d.text} needs a macro name`);
          ok = macros.has(line[0].text) === (d.text === 'ifdef');
        }
        conds.push({ tok: d, ctx: 'then', included: ok });
        if (!ok) skipCond(s);
        break;
      }
      case 'elif': {
        const c = conds[conds.length - 1];
        if (!c || c.ctx === 'else') throw errorAt(d, '#elif without #if');
        c.ctx = 'elif';
        if (!c.included && evalIf(line, d)) c.included = true;
        else skipCond(s);
        break;
      }
      case 'else': {
        const c = conds[conds.length - 1];
        if (!c || c.ctx === 'else') throw errorAt(d, '#else without #if');
        c.ctx = 'else';
        if (c.included) skipCond(s);
        else c.included = true;
        break;
      }
      case 'endif':
        if (!conds.pop()) throw errorAt(d, '#endif without #if');
        break;
      case 'error':
        throw errorAt(d, `#error ${line.map((x) => x.text).join(' ')}`);
      case 'line': {
        const e = expandAll(line);
        if (e[0]?.kind !== 'pp-num' || !/^[0-9]+$/.test(e[0].text)) throw errorAt(d, '#line needs a line number');
        // The next source line is line N.
        lineDelta.set(d.file, Number(e[0].text) - (d.line + 1));
        if (e[1]?.kind === 'str') fileName.set(d.file, e[1].text.slice(1, -1));
        break;
      }
      case 'warning':
      case 'ident':
        break;
      case 'pragma': {
        if (line[0]?.text === 'once') onceFiles.add(d.file.name);
        // #pragma push_macro("name") / pop_macro("name")
        const which = line[0]?.text;
        if ((which === 'push_macro' || which === 'pop_macro') && line[1]?.text === '(' && line[2]?.kind === 'str') {
          const name = line[2].text.slice(1, -1);
          const stack = pushed.get(name) ?? [];
          pushed.set(name, stack);
          if (which === 'push_macro') stack.push(macros.get(name));
          else if (stack.length) {
            const m = stack.pop();
            if (m) macros.set(name, m);
            else macros.delete(name);
          }
        }
        break;
      }
      default:
        if (d.kind === 'pp-num') break; // GNU line markers: # 12 "file"
        throw errorAt(d, `unknown preprocessor directive #${d.text}`);
    }
  }
  if (conds.length) throw errorAt(conds[conds.length - 1]!.tok, `#${conds[conds.length - 1]!.tok.text} has no matching #endif`);

  // Preprocessing tokens → tokens: keywords, numbers, characters, joined strings.
  const result: Token[] = [];
  for (const t of out) {
    if (t.kind === 'ident' && KEYWORDS.has(t.text)) result.push({ ...t, kind: 'keyword' });
    else if (t.kind === 'pp-num') {
      const c = { ...t };
      convertNumber(c);
      result.push(c);
    } else if (t.kind === 'char') {
      const c = { ...t };
      convertChar(c);
      c.kind = 'num';
      result.push(c);
    } else if (t.kind === 'str') {
      const c = { ...t };
      convertString(c);
      const prev = result[result.length - 1];
      // Adjacent string literals join (C11 5.1.1.2 phase 6); a prefixed one sets the width.
      if (prev && prev.kind === 'str') {
        if (prev.elemSize !== c.elemSize && prev.elemSize !== 1 && c.elemSize !== 1) throw errorAt(c, 'cannot join string literals of different kinds');
        const size = Math.max(prev.elemSize!, c.elemSize!);
        const widen = (x: Token) => (x.elemSize === size ? x.bytes! : (convertString((x = { ...x, text: (size === 2 ? 'u' : 'L') + x.text.replace(/^u8/, '') })), x.bytes!));
        result[result.length - 1] = { ...prev, bytes: [...widen(prev), ...widen(c)], elemSize: size, end: c.end };
      } else result.push(c);
    } else result.push(t);
  }
  result.push(PLACEHOLDER_EOF(file));
  return { tokens: result, includes };
}

const PLACEHOLDER: Token = { kind: 'eof', text: '', file: { name: '', text: '', user: false }, offset: 0, end: 0, line: 1, atBol: true, hasSpace: false };
const PLACEHOLDER_EOF = (file: SourceFile): Token => ({ ...PLACEHOLDER, file, offset: file.text.length, end: file.text.length });

function union(a: Set<string> | undefined, b: Set<string>): Set<string> {
  if (!a || a.size === 0) return b;
  const s = new Set(a);
  for (const x of b) s.add(x);
  return s;
}
function intersect(a: Set<string> | undefined, b: Set<string> | undefined): Set<string> {
  const s = new Set<string>();
  if (!a || !b) return s;
  for (const x of a) if (b.has(x)) s.add(x);
  return s;
}

const PRELUDE = `#define __builtin_expect(x, y) (x)
#define __builtin_unreachable() ((void)0)
#define __attribute(x)
#define __builtin_huge_val() (1.0/0.0)
#define __builtin_inf() (1.0/0.0)
#define __builtin_nan(s) (0.0/0.0)
`;

const PREDEFINED: Record<string, string> = {
  __STDC__: '1',
  __STDC_VERSION__: '201112L',
  __STDC_HOSTED__: '1',
  __smallc__: '1',
  __wasm__: '1',
  __wasm32__: '1',
  __ILP32__: '1',
  __CHAR_BIT__: '8',
  __SIZEOF_INT__: '4',
  __SIZEOF_LONG__: '4',
  __SIZEOF_LONG_LONG__: '8',
  __SIZEOF_POINTER__: '4',
  __SIZEOF_SHORT__: '2',
  __SIZEOF_FLOAT__: '4',
  __SIZEOF_DOUBLE__: '8',
  __SIZEOF_LONG_DOUBLE__: '8',
  __SIZE_TYPE__: 'unsigned long',
  __PTRDIFF_TYPE__: 'long',
  __WCHAR_TYPE__: 'int',
  __INT_MAX__: '2147483647',
  __LONG_MAX__: '2147483647L',
  __LONG_LONG_MAX__: '9223372036854775807LL',
  __ORDER_LITTLE_ENDIAN__: '1234',
  __BYTE_ORDER__: '1234',
};

// ---------------------------------------------------------------- #if expressions

/** Evaluates a #if expression in intmax_t/uintmax_t (64-bit) arithmetic. */
class IfEval {
  private i = 0;
  /** Inside an operand that is not evaluated (the right of a decided && or ||, the unchosen arm of ?:). */
  private skip = 0;
  constructor(
    private toks: Token[],
    private at: Token,
  ) {
    for (const t of toks) {
      if (t.kind === 'pp-num') convertNumber(t);
      else if (t.kind === 'char') {
        convertChar(t);
        t.kind = 'num';
      }
    }
  }
  run(): bigint {
    const v = this.cond();
    if (this.i < this.toks.length) throw errorAt(this.toks[this.i]!, `unexpected "${this.toks[this.i]!.text}" in #if`);
    return v.v;
  }
  private peek = () => this.toks[this.i]?.text;
  private take(s: string) {
    if (this.peek() === s) {
      this.i++;
      return true;
    }
    return false;
  }
  private norm(v: bigint, u: boolean) {
    return { v: u ? BigInt.asUintN(64, v) : BigInt.asIntN(64, v), u };
  }
  private cond(): { v: bigint; u: boolean } {
    const c = this.binary(0);
    if (this.take('?')) {
      if (c.v === 0n) this.skip++;
      const a = this.cond();
      if (c.v === 0n) this.skip--;
      if (!this.take(':')) throw errorAt(this.toks[this.i - 1] ?? this.at, 'expected : in #if');
      if (c.v !== 0n) this.skip++;
      const b = this.cond();
      if (c.v !== 0n) this.skip--;
      const u = a.u || b.u;
      return this.norm(c.v !== 0n ? a.v : b.v, u);
    }
    return c;
  }
  private static PREC: Record<string, number> = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
  private binary(min: number): { v: bigint; u: boolean } {
    let l = this.unary();
    for (;;) {
      const op = this.peek();
      const p = op !== undefined ? IfEval.PREC[op] : undefined;
      if (p === undefined || p <= min) return l;
      const opTok = this.toks[this.i]!;
      this.i++;
      const decided = (op === '&&' && l.v === 0n) || (op === '||' && l.v !== 0n);
      if (decided) this.skip++;
      const r = this.binary(p);
      if (decided) this.skip--;
      const u = l.u || r.u;
      const a = u ? BigInt.asUintN(64, l.v) : l.v;
      const b = u ? BigInt.asUintN(64, r.v) : r.v;
      const bool = (x: boolean) => ({ v: x ? 1n : 0n, u: false });
      switch (op) {
        case '||': l = bool(a !== 0n || b !== 0n); break;
        case '&&': l = bool(a !== 0n && b !== 0n); break;
        case '|': l = this.norm(a | b, u); break;
        case '^': l = this.norm(a ^ b, u); break;
        case '&': l = this.norm(a & b, u); break;
        case '==': l = bool(a === b); break;
        case '!=': l = bool(a !== b); break;
        case '<': l = bool(a < b); break;
        case '>': l = bool(a > b); break;
        case '<=': l = bool(a <= b); break;
        case '>=': l = bool(a >= b); break;
        case '<<': l = this.norm(a << (b & 63n), l.u); break;
        case '>>': l = this.norm(a >> (b & 63n), l.u); break;
        case '+': l = this.norm(a + b, u); break;
        case '-': l = this.norm(a - b, u); break;
        case '*': l = this.norm(a * b, u); break;
        case '/':
        case '%':
          if (b === 0n) {
            if (this.skip) {
              l = { v: 0n, u };
              break;
            }
            throw errorAt(opTok, 'division by zero in #if');
          }
          l = this.norm(op === '/' ? a / b : a % b, u);
          break;
      }
    }
  }
  private unary(): { v: bigint; u: boolean } {
    const t = this.toks[this.i];
    if (!t) throw errorAt(this.toks[this.i - 1] ?? this.at, '#if expression ends too early');
    this.i++;
    if (t.text === '(') {
      const v = this.cond();
      if (!this.take(')')) throw errorAt(t, '( has no closing ) in #if');
      return v;
    }
    if (t.text === '-') {
      const v = this.unary();
      return this.norm(-v.v, v.u);
    }
    if (t.text === '+') return this.unary();
    if (t.text === '~') {
      const v = this.unary();
      return this.norm(~v.v, v.u);
    }
    if (t.text === '!') return { v: this.unary().v === 0n ? 1n : 0n, u: false };
    if (t.kind === 'num' && t.ival !== undefined) return this.norm(t.ival, (t.ctype ?? '').startsWith('unsigned'));
    if (t.kind === 'num') throw errorAt(t, 'floating constant in #if');
    throw errorAt(t, `unexpected "${t.text}" in #if`);
  }
}

export { CompileError };
