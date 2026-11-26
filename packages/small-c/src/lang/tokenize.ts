// The lexer: C source text → preprocessing tokens (C11 6.4), in the spirit of
// chibicc. Every token keeps its file and UTF-16 offset so later stages (and the
// page) can point back at the exact characters it came from.

export interface SourceFile {
  name: string;
  text: string;
  /** True for the program being compiled; false for built-in headers and libc. */
  user: boolean;
}

export type TokKind = 'ident' | 'punct' | 'keyword' | 'str' | 'num' | 'char' | 'pp-num' | 'header' | 'eof';

export interface Token {
  kind: TokKind;
  /** The spelling, exactly as written (string and character literals include quotes and prefix). */
  text: string;
  file: SourceFile;
  /** UTF-16 offsets in `file.text`. */
  offset: number;
  end: number;
  line: number;
  /** First token on its line (for `#` directives). */
  atBol: boolean;
  /** Whitespace before it (for `#` stringizing). */
  hasSpace: boolean;
  /** Macro names this token may no longer expand (the preprocessor's hide set). */
  hideset?: Set<string>;
  /** For a token produced by a macro expansion: the token in the source where the expansion happened. */
  origin?: Token;
  // Filled in after preprocessing:
  /** Integer value of a number or character constant. */
  ival?: bigint;
  /** Value of a floating constant. */
  fval?: number;
  /** C type name of a constant: 'int', 'unsigned', 'long', 'unsigned long', 'long long', 'unsigned long long', 'float', 'double', 'long double'. */
  ctype?: string;
  /** A string literal's bytes (without the terminating zero) and its element size (1, 2 or 4). */
  bytes?: number[];
  elemSize?: number;
}

export class CompileError extends Error {
  constructor(
    message: string,
    public file: SourceFile,
    public offset: number,
    public end: number,
  ) {
    super(message);
  }
  get line(): number {
    return lineOf(this.file.text, this.offset);
  }
}

export function lineOf(text: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

export function errorAt(tok: Token, message: string): CompileError {
  // Errors inside a macro expansion point at the place the macro was used.
  const t = tok.origin ?? tok;
  return new CompileError(message, t.file, t.offset, t.end);
}

export const KEYWORDS = new Set(
  `auto break case char const continue default do double else enum extern float for goto if inline int long register
restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Alignas _Alignof
_Bool _Generic _Noreturn _Static_assert _Thread_local __restrict __restrict__ __inline __inline__ __signed__ __const
__volatile__ __attribute__ __extension__ __builtin_va_arg __builtin_va_start __builtin_va_end __builtin_va_copy
__builtin_offsetof typeof __typeof__ asm __asm__`.split(/\s+/),
);

const PUNCTS = ['<<=', '>>=', '...', '==', '!=', '<=', '>=', '->', '+=', '-=', '*=', '/=', '++', '--', '%=', '&=', '|=', '^=', '&&', '||', '<<', '>>', '##'];

const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c) || c.charCodeAt(0) >= 0x80;
const isIdentChar = (c: string) => /[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) >= 0x80;
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

/** Splits a file into preprocessing tokens. Backslash-newline is treated as invisible. */
export function tokenize(file: SourceFile): Token[] {
  const src = file.text;
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  let atBol = true;
  let hasSpace = false;
  const at = (k: number) => src[k];
  const tok = (kind: TokKind, start: number, end: number): Token => {
    const t: Token = { kind, text: src.slice(start, end).replace(/\\\r?\n/g, ''), file, offset: start, end, line, atBol, hasSpace };
    out.push(t);
    atBol = false;
    hasSpace = false;
    return t;
  };
  const fail = (msg: string, start: number, end = start + 1): never => {
    throw new CompileError(msg, file, start, end);
  };
  // Skips a backslash-newline at k (returns the index after it), or returns k.
  const splice = (k: number) => {
    while (src[k] === '\\' && (src[k + 1] === '\n' || (src[k + 1] === '\r' && src[k + 2] === '\n'))) {
      k += src[k + 1] === '\n' ? 2 : 3;
      line++;
    }
    return k;
  };

  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\' && (at(i + 1) === '\n' || (at(i + 1) === '\r' && at(i + 2) === '\n'))) {
      i = splice(i);
      hasSpace = true;
      continue;
    }
    if (c === '\n') {
      i++;
      line++;
      atBol = true;
      hasSpace = false;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      i++;
      hasSpace = true;
      continue;
    }
    if (c === '/' && at(i + 1) === '/') {
      while (i < src.length && src[i] !== '\n') {
        if (src[i] === '\\' && src[i + 1] === '\n') {
          i += 2;
          line++;
        } else i++;
      }
      hasSpace = true;
      continue;
    }
    if (c === '/' && at(i + 1) === '*') {
      const close = src.indexOf('*/', i + 2);
      if (close < 0) fail('unclosed comment: this /* has no */', i, i + 2);
      for (let k = i; k < close; k++) if (src[k] === '\n') line++;
      i = close + 2;
      hasSpace = true;
      continue;
    }
    const start = i;
    // Numbers (pp-numbers: digits, letters, dots, and signs after an exponent letter).
    if (isDigit(c) || (c === '.' && isDigit(at(i + 1)))) {
      i++;
      for (;;) {
        i = splice(i);
        const d = at(i);
        if (d !== undefined && (d === '+' || d === '-') && /[eEpP]/.test(at(i - 1) ?? '')) i++;
        else if (d !== undefined && (isIdentChar(d) || d === '.')) i++;
        else break;
      }
      tok('pp-num', start, i);
      continue;
    }
    // A header name: <stdio.h> right after #include is one token (C11 6.4.7).
    if (c === '<' && out.length >= 2 && out[out.length - 1]!.text === 'include' && out[out.length - 2]!.text === '#' && out[out.length - 2]!.atBol) {
      const close = src.indexOf('>', i);
      const nl = src.indexOf('\n', i);
      if (close > 0 && (nl < 0 || close < nl)) {
        i = close + 1;
        tok('header', start, i);
        continue;
      }
    }
    // String and character literals, with optional L, u, U or u8 prefix.
    const prefix = /^(u8|u|U|L)?["']/.exec(src.slice(i, i + 3));
    if (prefix) {
      const quote = prefix[0][prefix[0].length - 1]!;
      i += prefix[0].length;
      for (;;) {
        i = splice(i);
        const d = at(i);
        if (d === undefined || d === '\n') fail(quote === '"' ? 'unclosed string: this " has no closing quote on its line' : "unclosed character constant: this ' has no closing quote", start, i);
        if (d === '\\') i += 2;
        else if (d === quote) {
          i++;
          break;
        } else i++;
      }
      tok(quote === '"' ? 'str' : 'char', start, i);
      continue;
    }
    if (isIdentStart(c)) {
      i++;
      for (;;) {
        i = splice(i);
        if (at(i) !== undefined && isIdentChar(at(i)!)) i++;
        else break;
      }
      tok('ident', start, i);
      continue;
    }
    const p = PUNCTS.find((q) => src.startsWith(q, i));
    if (p) {
      i += p.length;
      tok('punct', start, i);
      continue;
    }
    if (/[!-/:-@[-`{-~]/.test(c)) {
      i++;
      tok('punct', start, i);
      continue;
    }
    fail(`unexpected character ${JSON.stringify(c)}`, i);
  }
  out.push({ kind: 'eof', text: '', file, offset: src.length, end: src.length, line, atBol: true, hasSpace: false });
  return out;
}

// ---------------------------------------------------------------- literals

/** Reads one escape sequence starting after the backslash; returns the code point and the next index. */
function readEscape(s: string, i: number, tok: Token): [number, number] {
  const c = s[i]!;
  if (c >= '0' && c <= '7') {
    let v = 0;
    let n = 0;
    while (n < 3 && s[i]! >= '0' && s[i]! <= '7') {
      v = v * 8 + (s.charCodeAt(i) - 48);
      i++;
      n++;
    }
    return [v, i];
  }
  if (c === 'x') {
    i++;
    let v = 0n;
    const start = i;
    while (/[0-9a-fA-F]/.test(s[i] ?? '')) v = v * 16n + BigInt(parseInt(s[i++]!, 16));
    if (i === start) throw errorAt(tok, '\\x needs at least one hexadecimal digit');
    return [Number(BigInt.asUintN(32, v)), i];
  }
  if (c === 'u' || c === 'U') {
    const n = c === 'u' ? 4 : 8;
    const hex = s.slice(i + 1, i + 1 + n);
    if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== n) throw errorAt(tok, `\\${c} needs ${n} hexadecimal digits`);
    return [parseInt(hex, 16), i + 1 + n];
  }
  const simple: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, e: 27, '\\': 92, "'": 39, '"': 34, '?': 63 };
  if (c in simple) return [simple[c]!, i + 1];
  // Unknown escapes are the character itself (as GCC does, with a warning there).
  return [s.codePointAt(i)!, i + (s.codePointAt(i)! > 0xffff ? 2 : 1)];
}

function utf8(cp: number): number[] {
  if (cp < 0x80) return [cp];
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 63)];
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
}

/** Fills in `bytes` and `elemSize` for a string literal token. */
export function convertString(tok: Token): void {
  const m = /^(u8|u|U|L)?"/.exec(tok.text)!;
  const prefix = m[1] ?? '';
  const elemSize = prefix === 'u' ? 2 : prefix === 'U' || prefix === 'L' ? 4 : 1;
  const body = tok.text.slice(m[0].length, -1);
  const units: number[] = [];
  for (let i = 0; i < body.length; ) {
    if (body[i] === '\\') {
      const isHexOrOct = /[0-7x]/.test(body[i + 1] ?? '');
      const [v, next] = readEscape(body, i + 1, tok);
      i = next;
      // Octal and hex escapes give a code unit as is; others give a character.
      if (elemSize === 1) units.push(...(isHexOrOct ? [v & 0xff] : utf8(v)));
      else if (elemSize === 2 && !isHexOrOct && v > 0xffff) units.push(0xd800 + ((v - 0x10000) >> 10), 0xdc00 + ((v - 0x10000) & 0x3ff));
      else units.push(v);
      continue;
    }
    const cp = body.codePointAt(i)!;
    i += cp > 0xffff ? 2 : 1;
    if (elemSize === 1) units.push(...utf8(cp));
    else if (elemSize === 2 && cp > 0xffff) units.push(0xd800 + ((cp - 0x10000) >> 10), 0xdc00 + ((cp - 0x10000) & 0x3ff));
    else units.push(cp);
  }
  tok.bytes = units;
  tok.elemSize = elemSize;
}

/** Fills in `ival` and `ctype` for a character constant. */
export function convertChar(tok: Token): void {
  const m = /^(u|U|L)?'/.exec(tok.text)!;
  const body = tok.text.slice(m[0].length, -1);
  if (body.length === 0) throw errorAt(tok, "empty character constant ''");
  const values: number[] = [];
  for (let i = 0; i < body.length; ) {
    if (body[i] === '\\') {
      const [v, next] = readEscape(body, i + 1, tok);
      values.push(v);
      i = next;
    } else {
      const cp = body.codePointAt(i)!;
      i += cp > 0xffff ? 2 : 1;
      values.push(...(m[1] ? [cp] : utf8(cp)));
    }
  }
  if (m[1]) {
    tok.ival = BigInt(values[0]!);
    tok.ctype = m[1] === 'u' ? 'unsigned short' : m[1] === 'U' ? 'unsigned' : 'int';
    return;
  }
  // A plain character constant is an int; a single char is sign-extended (char is signed).
  if (values.length === 1) tok.ival = BigInt.asIntN(8, BigInt(values[0]!));
  else tok.ival = BigInt.asIntN(32, values.reduce((acc, v) => (acc << 8n) | BigInt(v & 0xff), 0n)); // multi-character, as GCC
  tok.ctype = 'int';
}

/** Turns a pp-number into an integer or floating constant (C11 6.4.4.1 and 6.4.4.2, ILP32 sizes). */
export function convertNumber(tok: Token): void {
  const t = tok.text;
  // Integers: 0x…, 0b…, 0… (octal), decimal, with u/l/ll suffixes in any order.
  const im = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|[0-9]+)([uU](ll|LL|l|L)?|(ll|LL|l|L)[uU]?)?$/.exec(t);
  if (im) {
    const digits = im[1]!;
    let base = 10;
    let body = digits;
    if (/^0[xX]/.test(digits)) {
      base = 16;
      body = digits.slice(2);
    } else if (/^0[bB]/.test(digits)) {
      base = 2;
      body = digits.slice(2);
    } else if (digits.length > 1 && digits[0] === '0') {
      base = 8;
      if (/[89]/.test(digits)) throw errorAt(tok, `invalid digit in octal constant ${t}`);
    }
    let v = 0n;
    for (const ch of body) v = v * BigInt(base) + BigInt(parseInt(ch, base));
    const suffix = (im[2] ?? '').toLowerCase();
    const u = suffix.includes('u');
    const l = suffix.replace('u', '');
    // The first type the value fits, from the list the standard gives for this base and suffix.
    const fitsS = (bits: number) => v < 1n << BigInt(bits - 1);
    const fitsU = (bits: number) => v < 1n << BigInt(bits);
    const decimal = base === 10;
    const options: [string, (b: number) => boolean, number][] = [];
    const add = (name: string, unsigned: boolean, bits: number) => options.push([name, unsigned ? fitsU : fitsS, bits]);
    if (l === '') {
      if (!u) add('int', false, 32);
      if (u || !decimal) add('unsigned', true, 32);
    }
    if (l !== 'll') {
      if (!u) add('long', false, 32);
      if (u || !decimal) add('unsigned long', true, 32);
    }
    if (!u) add('long long', false, 64);
    if (u || !decimal) add('unsigned long long', true, 64);
    if (decimal && !u) add('unsigned long long', true, 64); // beyond the standard, as GCC: too big for long long
    const fit = options.find(([, f, bits]) => f(bits));
    if (!fit) throw errorAt(tok, `integer constant ${t} is too large for any integer type`);
    tok.ctype = fit[0];
    tok.ival = v;
    tok.kind = 'num';
    return;
  }
  // Floating constants.
  const fm = /^((?:[0-9]*\.[0-9]+|[0-9]+\.?)(?:[eE][+-]?[0-9]+)?|0[xX](?:[0-9a-fA-F]*\.[0-9a-fA-F]+|[0-9a-fA-F]+\.?)[pP][+-]?[0-9]+)([fFlL])?$/.exec(t);
  if (fm && (/[.eEpP]/.test(fm[1]!) || fm[2])) {
    if (!/[.eEpP]/.test(fm[1]!)) throw errorAt(tok, `invalid number ${t}`);
    const text = fm[1]!;
    const v = /^0[xX]/.test(text) ? parseHexFloat(text) : Number(text);
    const s = (fm[2] ?? '').toLowerCase();
    tok.ctype = s === 'f' ? 'float' : s === 'l' ? 'long double' : 'double';
    tok.fval = s === 'f' ? Math.fround(v) : v;
    tok.kind = 'num';
    return;
  }
  throw errorAt(tok, `invalid number ${t}`);
}

/** 0x1.8p3 → 12, exactly rounded to the nearest double. */
export function parseHexFloat(text: string): number {
  const m = /^0[xX]([0-9a-fA-F]*)\.?([0-9a-fA-F]*)[pP]([+-]?[0-9]+)$/.exec(text)!;
  const mant = BigInt('0x' + (m[1]! + m[2]! || '0'));
  const exp = Number(m[3]) - 4 * m[2]!.length;
  if (mant === 0n) return 0;
  // Round the mantissa to 53 bits (ties to even), then scale.
  const bits = mant.toString(2).length;
  let mm = mant;
  let e = exp;
  if (bits > 53) {
    const shift = BigInt(bits - 53);
    const rem = mm & ((1n << shift) - 1n);
    const half = 1n << (shift - 1n);
    mm >>= shift;
    e += Number(shift);
    if (rem > half || (rem === half && (mm & 1n) === 1n)) mm += 1n;
  }
  return Number(mm) * 2 ** e;
}
