// The parser: tokens → a typed syntax tree (C11 6.5 to 6.9), recursive descent
// in the shape of chibicc's. Types are worked out as each node is built, and the
// implicit conversions C performs (promotions, usual arithmetic conversions,
// array and function decay, pointer scaling) become explicit nodes, so the code
// generator and the page see exactly what C does.

import type { Node, NodeKind, Obj, Reloc, TranslationUnit } from './ast';
import { errorAt, type SourceFile, type Token } from './tokenize';
import {
  alignTo,
  arrayOf,
  commonType,
  enumType,
  funcType,
  isFloat,
  isInteger,
  isNumeric,
  isPointerLike,
  isScalar,
  pointerTo,
  promote,
  sameType,
  structType,
  T,
  typeName,
  withConst,
  type Member,
  type Type,
} from './types';

interface VarScope {
  obj?: Obj;
  typedef?: Type;
  enumVal?: bigint;
}
interface Scope {
  vars: Map<string, VarScope>;
  tags: Map<string, Type>;
}

interface Init {
  ty: Type;
  expr?: Node;
  children: Init[];
  /** Union: the member being initialised. */
  mem?: number;
}

type CVal = { kind: 'int'; v: bigint } | { kind: 'float'; v: number } | { kind: 'addr'; obj?: Obj; addend: number };

interface DeclAttr {
  isTypedef: boolean;
  isStatic: boolean;
  isExtern: boolean;
  isInline: boolean;
}

let objIds = 0;

export function parse(tokens: Token[], file: SourceFile, globalsAcross?: Map<string, Obj>): TranslationUnit {
  let pos = 0;
  const nodes: Node[] = [];
  const globals: Obj[] = [];
  const scopes: Scope[] = [{ vars: new Map(), tags: new Map() }];
  let fn: Obj | undefined; // the function being parsed
  let fnLocals: Obj[] = [];
  let stringCount = 0;
  const strings = new Map<string, Obj>();
  // Labels and gotos of the current function, to check every goto has a label.
  let gotos: Node[] = [];
  let labels = new Set<string>();
  // The switch being parsed and the block depth of its body.
  let curSwitch: { node: Node; depth: number } | undefined;
  let blockDepth = 0;
  let breakable = 0;
  let loopDepth = 0;

  // ------------------------------------------------------------ tokens

  const peek = (k = 0) => tokens[Math.min(pos + k, tokens.length - 1)]!;
  const is = (s: string, k = 0) => {
    const t = peek(k);
    return (t.kind === 'punct' || t.kind === 'keyword') && t.text === s;
  };
  const take = (s: string) => {
    if (is(s)) {
      pos++;
      return true;
    }
    return false;
  };
  const describe = (t: Token) => (t.kind === 'eof' ? 'the end of the file' : `"${t.text}"`);
  const expect = (s: string, what?: string) => {
    if (!take(s)) throw errorAt(peek(), `expected "${s}"${what ? ` ${what}` : ''}, found ${describe(peek())}`);
    return tokens[pos - 1]!;
  };
  const ident = (what: string) => {
    const t = peek();
    if (t.kind !== 'ident') throw errorAt(t, `expected ${what}, found ${describe(t)}`);
    pos++;
    return t;
  };
  /** The source position of a token in this file (macro-expanded tokens point at the macro's use). */
  const where = (t: Token) => t.origin ?? t;

  // ------------------------------------------------------------ nodes

  const mk = (kind: NodeKind, tok: Token, ty: Type, fields: Partial<Node> = {}): Node => {
    const w = where(tok);
    const n: Node = { id: nodes.length, kind, tok, ty, start: w.offset, end: w.end, ...fields };
    nodes.push(n);
    return n;
  };
  /** Sets a node's span from the token at index `from` to the last token read. */
  const span = (n: Node, from: number) => {
    const a = where(tokens[from]!);
    const b = where(tokens[Math.max(from, pos - 1)]!);
    if (a.file === b.file && b.end >= a.offset) {
      n.start = a.offset;
      n.end = b.end;
    }
    return n;
  };
  const num = (v: bigint | number, tok: Token, ty: Type = T.int): Node => mk('num', tok, ty, { val: BigInt(v) });
  const fnum = (v: number, tok: Token, ty: Type): Node => mk('num', tok, ty, { fval: v });

  const cast = (n: Node, ty: Type, implicit = true): Node => {
    if (ty.kind === 'void') return mk('cast', n.tok, T.void, { lhs: n, start: n.start, end: n.end, implicit });
    if (sameType(n.ty, ty) && n.ty.kind !== 'array' && n.ty.kind !== 'func' && !(n.ty.kind === 'bool') === !(ty.kind === 'bool')) return n;
    if (ty.kind === 'struct' || ty.kind === 'union') {
      if (n.ty === ty) return n;
      throw errorAt(n.tok, `cannot convert ${typeName(n.ty)} to ${typeName(ty)}`);
    }
    if (n.ty.kind === 'struct' || n.ty.kind === 'union') throw errorAt(n.tok, `cannot convert ${typeName(n.ty)} to ${typeName(ty)}`);
    if (n.ty.kind === 'void') throw errorAt(n.tok, 'a void expression has no value');
    return mk('cast', n.tok, ty, { lhs: n, start: n.start, end: n.end, implicit });
  };

  /** Arrays and functions used as values become pointers (C11 6.3.2.1). */
  const decay = (n: Node): Node => {
    if (n.ty.kind === 'array') return cast(n, pointerTo(n.ty.base!));
    if (n.ty.kind === 'func') return cast(n, pointerTo(n.ty));
    return n;
  };
  const rvalue = (n: Node): Node => {
    n = decay(n);
    if (n.ty.kind === 'void') throw errorAt(n.tok, 'a void expression has no value');
    return n;
  };
  const scalar = (n: Node, what: string): Node => {
    n = rvalue(n);
    if (!isScalar(n.ty)) throw errorAt(n.tok, `${what} needs a number or a pointer, not ${typeName(n.ty)}`);
    return n;
  };
  const arith = (n: Node, what: string): Node => {
    n = rvalue(n);
    if (!isNumeric(n.ty)) throw errorAt(n.tok, `${what} needs a number, not ${typeName(n.ty)}`);
    return n;
  };
  const integer = (n: Node, what: string): Node => {
    n = rvalue(n);
    if (!isInteger(n.ty)) throw errorAt(n.tok, `${what} needs an integer, not ${typeName(n.ty)}`);
    return n;
  };

  const binaryArith = (kind: NodeKind, l: Node, r: Node, tok: Token): Node => {
    const ty = commonType(l.ty, r.ty);
    return mk(kind, tok, ty, { lhs: cast(l, ty), rhs: cast(r, ty), start: l.start, end: r.end });
  };

  const newAdd = (l: Node, r: Node, tok: Token): Node => {
    l = scalar(l, '+');
    r = scalar(r, '+');
    if (isNumeric(l.ty) && isNumeric(r.ty)) return binaryArith('add', l, r, tok);
    if (l.ty.kind === 'ptr' && r.ty.kind === 'ptr') throw errorAt(tok, 'cannot add two pointers');
    if (r.ty.kind === 'ptr') [l, r] = [r, l];
    if (!isInteger(r.ty)) throw errorAt(tok, `cannot add ${typeName(r.ty)} to a pointer`);
    return mk('add', tok, l.ty, { lhs: l, rhs: scaled(r, l.ty.base!, tok), start: Math.min(l.start, r.start), end: Math.max(l.end, r.end) });
  };
  const elemSize = (base: Type, tok: Token) => {
    if (base.kind === 'void' || base.kind === 'func') return 1; // GNU: arithmetic on void* and function pointers
    if (base.size === 0 && base.kind !== 'array') throw errorAt(tok, `arithmetic on a pointer to incomplete type ${typeName(base)}`);
    return base.size;
  };
  /** An integer offset multiplied by the element size, as an int (pointers are 32-bit). */
  const scaled = (r: Node, base: Type, tok: Token): Node => {
    const size = elemSize(base, tok);
    const i = cast(r, r.ty.unsigned && r.ty.size >= 4 ? T.uint : T.int);
    if (size === 1) return i;
    if (i.kind === 'num' && i.val !== undefined) return num(BigInt.asIntN(32, i.val * BigInt(size)), i.tok, i.ty);
    return mk('mul', tok, i.ty, { lhs: i, rhs: num(size, tok, i.ty), start: i.start, end: i.end, implicit: true });
  };
  const newSub = (l: Node, r: Node, tok: Token): Node => {
    l = scalar(l, '-');
    r = scalar(r, '-');
    if (isNumeric(l.ty) && isNumeric(r.ty)) return binaryArith('sub', l, r, tok);
    if (l.ty.kind === 'ptr' && isInteger(r.ty)) return mk('sub', tok, l.ty, { lhs: l, rhs: scaled(r, l.ty.base!, tok), start: l.start, end: r.end });
    if (l.ty.kind === 'ptr' && r.ty.kind === 'ptr') {
      const diff = mk('sub', tok, T.long, { lhs: cast(l, T.long), rhs: cast(r, T.long), start: l.start, end: r.end });
      const size = elemSize(l.ty.base!, tok);
      return size === 1 ? diff : mk('div', tok, T.long, { lhs: diff, rhs: num(size, tok, T.long), start: l.start, end: r.end, implicit: true });
    }
    throw errorAt(tok, `cannot subtract ${typeName(r.ty)} from ${typeName(l.ty)}`);
  };
  const compare = (kind: 'eq' | 'ne' | 'lt' | 'le', l: Node, r: Node, tok: Token): Node => {
    l = scalar(l, tok.text);
    r = scalar(r, tok.text);
    let ty: Type;
    if (isNumeric(l.ty) && isNumeric(r.ty)) ty = commonType(l.ty, r.ty);
    else ty = T.uint; // pointers compare as unsigned addresses
    return mk(kind, tok, T.int, { lhs: cast(l, ty), rhs: cast(r, ty), start: l.start, end: r.end });
  };

  const toBool = (n: Node): Node => scalar(n, 'a condition');

  const isLvalue = (n: Node) => n.kind === 'var' || n.kind === 'deref' || n.kind === 'member' || (n.kind === 'cast' && false);
  const checkAssignable = (n: Node, tok: Token) => {
    if (!isLvalue(n)) throw errorAt(tok, `the left side of ${tok.text} must be a variable, array element, member or *pointer`);
    if (n.ty.kind === 'array') throw errorAt(tok, 'cannot assign to an array');
    if (n.ty.kind === 'func') throw errorAt(tok, 'cannot assign to a function');
  };

  const newAssign = (l: Node, r: Node, tok: Token): Node => {
    checkAssignable(l, tok);
    r = l.ty.kind === 'struct' || l.ty.kind === 'union' ? r : rvalue(r);
    return mk('assign', tok, l.ty, { lhs: l, rhs: convertForAssign(r, l.ty, tok), start: l.start, end: r.end });
  };
  const convertForAssign = (r: Node, ty: Type, tok: Token): Node => {
    if (ty.kind === 'struct' || ty.kind === 'union') {
      if (r.ty !== ty) throw errorAt(tok, `cannot assign ${typeName(r.ty)} to ${typeName(ty)}`);
      return r;
    }
    r = rvalue(r);
    if (ty.kind === 'ptr' && isFloat(r.ty)) throw errorAt(tok, `cannot assign ${typeName(r.ty)} to a pointer`);
    if (isFloat(ty) && r.ty.kind === 'ptr') throw errorAt(tok, `cannot assign a pointer to ${typeName(ty)}`);
    if (r.ty.kind === 'struct' || r.ty.kind === 'union') throw errorAt(tok, `cannot assign ${typeName(r.ty)} to ${typeName(ty)}`);
    return cast(r, ty);
  };

  const deref = (n: Node, tok: Token): Node => {
    n = rvalue(n);
    if (n.ty.kind !== 'ptr') throw errorAt(tok, `cannot dereference ${typeName(n.ty)}: it is not a pointer`);
    if (n.ty.base!.kind === 'void') throw errorAt(tok, 'cannot dereference a void pointer');
    return mk('deref', tok, n.ty.base!, { lhs: n, start: Math.min(where(tok).offset, n.start), end: n.end });
  };
  const addrOf = (n: Node, tok: Token): Node => {
    if (n.kind === 'var' && n.obj!.isLocal) n.obj!.inMemory = true;
    if (n.kind === 'member') markAddressTaken(n);
    if (n.ty.kind === 'func' && n.kind === 'var') return mk('addr', tok, pointerTo(n.ty), { lhs: n, start: where(tok).offset, end: n.end });
    if (!isLvalue(n) && !(n.kind === 'stmtexpr')) throw errorAt(tok, 'cannot take the address of this expression');
    if (n.kind === 'member' && n.member!.bitWidth !== undefined) throw errorAt(tok, 'cannot take the address of a bit-field');
    return mk('addr', tok, pointerTo(n.ty), { lhs: n, start: Math.min(where(tok).offset, n.start), end: n.end });
  };
  const markAddressTaken = (n: Node) => {
    let x: Node | undefined = n;
    while (x && x.kind === 'member') x = x.lhs;
    if (x?.kind === 'var' && x.obj!.isLocal) x.obj!.inMemory = true;
  };

  // ------------------------------------------------------------ scopes

  const enterScope = () => scopes.push({ vars: new Map(), tags: new Map() });
  const leaveScope = () => scopes.pop();
  const findVar = (name: string): VarScope | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const v = scopes[i]!.vars.get(name);
      if (v) return v;
    }
    return undefined;
  };
  const findTag = (name: string): Type | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const v = scopes[i]!.tags.get(name);
      if (v) return v;
    }
    return undefined;
  };
  const top = () => scopes[scopes.length - 1]!;
  const isTypedef = (t: Token) => t.kind === 'ident' && !!findVar(t.text)?.typedef;

  const newObj = (name: string, ty: Type, tok: Token, isLocal: boolean): Obj => ({
    id: objIds++,
    name,
    ty,
    tok,
    file,
    isLocal,
    isFunction: ty.kind === 'func',
    isStatic: false,
    isDefinition: false,
  });
  const newLocal = (name: string, ty: Type, tok: Token): Obj => {
    const o = newObj(name, ty, tok, true);
    if (ty.kind === 'struct' || ty.kind === 'union' || ty.kind === 'array') o.inMemory = true;
    top().vars.set(name, { obj: o });
    fnLocals.push(o);
    return o;
  };
  const newGlobal = (name: string, ty: Type, tok: Token): Obj => {
    const o = newObj(name, ty, tok, false);
    globals.push(o);
    return o;
  };
  const anonGlobal = (ty: Type, tok: Token, prefix: string): Obj => {
    const o = newGlobal(`${prefix}.${stringCount++}`, ty, tok);
    o.anonymous = true;
    o.isStatic = true;
    o.isDefinition = true;
    return o;
  };

  const stringLiteral = (t: Token): Node => {
    const elem = t.elemSize === 2 ? T.ushort : t.elemSize === 4 ? T.int : T.char;
    const units = [...t.bytes!, 0];
    const key = `${t.elemSize}:${units.join(',')}`;
    let o = strings.get(key);
    if (!o) {
      o = anonGlobal(arrayOf(elem, units.length), t, '.str');
      const data = new Uint8Array(units.length * elem.size);
      const dv = new DataView(data.buffer);
      units.forEach((u, i) => (elem.size === 1 ? dv.setUint8(i, u & 0xff) : elem.size === 2 ? dv.setUint16(i * 2, u & 0xffff, true) : dv.setUint32(i * 4, u >>> 0, true)));
      o.data = data;
      o.relocs = [];
      o.literal = t.text;
      strings.set(key, o);
    }
    return mk('var', t, o.ty, { obj: o });
  };

  // ------------------------------------------------------------ types

  const isTypename = (t: Token = peek()): boolean => {
    if (t.kind === 'keyword')
      return /^(void|_Bool|char|short|int|long|float|double|struct|union|enum|signed|unsigned|typedef|static|extern|inline|const|volatile|auto|register|restrict|_Noreturn|_Alignas|_Thread_local|__restrict|__restrict__|__inline|__inline__|__signed__|__const|__volatile__|__attribute__|__extension__|typeof|__typeof__)$/.test(
        t.text,
      );
    return isTypedef(t);
  };

  const skipAttribute = () => {
    while (is('__attribute__')) {
      pos++;
      expect('(');
      expect('(');
      let depth = 2;
      while (depth > 0) {
        const t = peek();
        if (t.kind === 'eof') throw errorAt(t, '__attribute__ has no closing ))');
        if (is('(')) depth++;
        if (is(')')) depth--;
        pos++;
      }
    }
  };

  const declspec = (attr?: DeclAttr): Type => {
    const VOID = 1 << 0,
      BOOL = 1 << 2,
      CHAR = 1 << 4,
      SHORT = 1 << 6,
      INT = 1 << 8,
      LONG = 1 << 10,
      FLOAT = 1 << 12,
      DOUBLE = 1 << 14,
      OTHER = 1 << 16,
      SIGNED = 1 << 17,
      UNSIGNED = 1 << 18;
    let ty: Type = T.int;
    let counter = 0;
    let isConst = false;
    const start = peek();
    while (isTypename()) {
      const t = peek();
      if (/^(typedef|static|extern|inline|__inline|__inline__|_Thread_local)$/.test(t.text) && t.kind === 'keyword') {
        if (!attr) throw errorAt(t, `"${t.text}" is not allowed here`);
        if (t.text === 'typedef') attr.isTypedef = true;
        else if (t.text === 'static') attr.isStatic = true;
        else if (t.text === 'extern') attr.isExtern = true;
        else if (t.text.includes('inline')) attr.isInline = true;
        if (attr.isTypedef && (attr.isStatic || attr.isExtern)) throw errorAt(t, 'typedef cannot be combined with static or extern');
        pos++;
        continue;
      }
      if (/^(const|__const)$/.test(t.text) && t.kind === 'keyword') {
        isConst = true;
        pos++;
        continue;
      }
      if (/^(volatile|auto|register|restrict|__restrict|__restrict__|_Noreturn|__volatile__|__extension__)$/.test(t.text) && t.kind === 'keyword') {
        pos++;
        continue;
      }
      if (t.text === '__attribute__' && t.kind === 'keyword') {
        skipAttribute();
        continue;
      }
      if (t.text === '_Alignas' && t.kind === 'keyword') {
        pos++;
        expect('(');
        if (isTypename()) typename();
        else constExpr();
        expect(')');
        continue;
      }
      if (isTypedef(t) || /^(struct|union|enum|typeof|__typeof__)$/.test(t.text)) {
        if (counter) break; // `typedef int T; T x;` vs. `int T;`: a typedef name after a type is a declarator
        if (t.text === 'struct' || t.text === 'union') {
          pos++;
          ty = structDecl(t.text);
        } else if (t.text === 'enum') {
          pos++;
          ty = enumSpecifier();
        } else if (t.text === 'typeof' || t.text === '__typeof__') {
          pos++;
          expect('(');
          ty = isTypename() ? typename() : expr().ty;
          expect(')');
        } else {
          ty = findVar(t.text)!.typedef!;
          pos++;
        }
        counter += OTHER;
        continue;
      }
      const bits: Record<string, number> = { void: VOID, _Bool: BOOL, char: CHAR, short: SHORT, int: INT, long: LONG, float: FLOAT, double: DOUBLE, signed: SIGNED, __signed__: SIGNED, unsigned: UNSIGNED };
      counter += bits[t.text]!;
      pos++;
      const table: Record<number, Type> = {
        [VOID]: T.void,
        [BOOL]: T.bool,
        [CHAR]: T.char,
        [SIGNED + CHAR]: T.char,
        [UNSIGNED + CHAR]: T.uchar,
        [SHORT]: T.short,
        [SHORT + INT]: T.short,
        [SIGNED + SHORT]: T.short,
        [SIGNED + SHORT + INT]: T.short,
        [UNSIGNED + SHORT]: T.ushort,
        [UNSIGNED + SHORT + INT]: T.ushort,
        [INT]: T.int,
        [SIGNED]: T.int,
        [SIGNED + INT]: T.int,
        [UNSIGNED]: T.uint,
        [UNSIGNED + INT]: T.uint,
        [LONG]: T.long,
        [LONG + INT]: T.long,
        [SIGNED + LONG]: T.long,
        [SIGNED + LONG + INT]: T.long,
        [UNSIGNED + LONG]: T.ulong,
        [UNSIGNED + LONG + INT]: T.ulong,
        [LONG + LONG]: T.llong,
        [LONG + LONG + INT]: T.llong,
        [SIGNED + LONG + LONG]: T.llong,
        [SIGNED + LONG + LONG + INT]: T.llong,
        [UNSIGNED + LONG + LONG]: T.ullong,
        [UNSIGNED + LONG + LONG + INT]: T.ullong,
        [FLOAT]: T.float,
        [DOUBLE]: T.double,
        [LONG + DOUBLE]: T.ldouble,
      };
      const found = table[counter];
      if (!found) throw errorAt(t, `"${t.text}" does not combine with the type before it`);
      ty = found;
    }
    if (counter === 0 && !attr?.isTypedef && !attr?.isStatic && !attr?.isExtern && !isConst && peek() === start) {
      throw errorAt(start, `expected a type, found ${describe(start)}`);
    }
    return isConst ? withConst(ty) : ty;
  };

  const pointers = (ty: Type): Type => {
    while (take('*')) {
      ty = pointerTo(ty);
      while (/^(const|volatile|restrict|__restrict|__restrict__|__const|__volatile__)$/.test(peek().text) && peek().kind === 'keyword') {
        if (peek().text.includes('const')) ty = withConst(ty);
        pos++;
      }
      skipAttribute();
    }
    return ty;
  };

  /** Parses a declarator; returns its type and name (absent for abstract declarators). */
  const declarator = (ty: Type, abstract: 'no' | 'yes' | 'maybe' = 'no'): { ty: Type; name?: Token } => {
    skipAttribute();
    ty = pointers(ty);
    skipAttribute();
    // A nested declarator: `(*fp)(int)`. Parse what follows the parenthesis first.
    if (is('(') && (abstract === 'no' || is('*', 1) || is('(', 1) || is('[', 1) || is('__attribute__', 1) || (abstract === 'maybe' && peek(1).kind === 'ident' && !isTypedef(peek(1))))) {
      const start = pos;
      pos++;
      let depth = 1;
      while (depth > 0) {
        if (peek().kind === 'eof') throw errorAt(tokens[start]!, '( has no closing )');
        if (is('(')) depth++;
        if (is(')')) depth--;
        pos++;
      }
      const outer = typeSuffix(ty);
      const after = pos;
      pos = start + 1;
      const inner = declarator(outer, abstract);
      expect(')');
      pos = after;
      return inner;
    }
    let name: Token | undefined;
    if (peek().kind === 'ident' && abstract !== 'yes') name = ident('a name');
    else if (abstract === 'no') throw errorAt(peek(), `expected a name, found ${describe(peek())}`);
    ty = typeSuffix(ty);
    skipAttribute();
    return { ty, name };
  };

  const typeSuffix = (ty: Type): Type => {
    if (is('(')) {
      pos++;
      return funcParams(ty);
    }
    if (is('[')) {
      pos++;
      while (/^(static|const|restrict|volatile)$/.test(peek().text) && peek().kind === 'keyword') pos++;
      if (is('*') && is(']', 1)) pos++; // [*]: a variable-length array of unspecified size (prototypes only)
      if (take(']')) {
        const base = typeSuffix(ty);
        return arrayOf(base, -1);
      }
      const lenTok = peek();
      const lenExpr = conditional();
      if (fn && !isConstant(lenExpr)) {
        // A variable-length array: allocated on the stack when its declaration runs.
        expect(']');
        const base = typeSuffix(ty);
        const t = arrayOf(base, -1);
        t.vla = integer(lenExpr, 'an array size');
        return t;
      }
      const len = Number(constInt(lenExpr));
      if (len < 0) throw errorAt(lenTok, 'an array cannot have a negative size');
      expect(']');
      const base = typeSuffix(ty);
      if (base.kind === 'array' && base.len! < 0) throw errorAt(lenTok, 'only the first dimension of an array may be left out');
      return arrayOf(base, len);
    }
    return ty;
  };

  const funcParams = (ret: Type): Type => {
    if (ret.kind === 'array') throw errorAt(peek(), 'a function cannot return an array');
    if (ret.kind === 'func') throw errorAt(peek(), 'a function cannot return a function');
    const f = funcType(ret);
    if (is('void') && is(')', 1)) {
      pos += 2;
      return f;
    }
    if (take(')')) {
      f.noProto = true;
      return f;
    }
    // Old-style identifier list `f(a, b)` (types follow the declarator): parameters are ints until declared.
    if (peek().kind === 'ident' && !isTypedef(peek()) && (is(',', 1) || is(')', 1))) {
      f.noProto = true;
      f.oldStyleNames = [];
      for (;;) {
        f.oldStyleNames.push(ident('a parameter name'));
        if (take(')')) break;
        expect(',');
      }
      return f;
    }
    for (;;) {
      if (take('...')) {
        f.variadic = true;
        expect(')', 'after ...');
        break;
      }
      const base = declspec();
      let { ty, name } = declarator(base, 'maybe');
      if (ty.kind === 'array') ty = pointerTo(ty.base!);
      else if (ty.kind === 'func') ty = pointerTo(ty);
      if (ty.kind === 'void') throw errorAt(name ?? peek(), 'a parameter cannot have type void');
      f.params!.push(ty);
      f.paramNames!.push(name);
      if (take(')')) break;
      expect(',', 'between parameters');
    }
    return f;
  };

  const typename = (): Type => {
    const base = declspec();
    return declarator(base, 'yes').ty;
  };

  const structDecl = (kind: 'struct' | 'union'): Type => {
    skipAttribute();
    let tagTok: Token | undefined;
    if (peek().kind === 'ident') tagTok = ident('a tag');
    if (tagTok && !is('{')) {
      // A reference: find it, or declare it as incomplete (in this scope only for `struct S;`).
      const found = findTag(tagTok.text);
      if (found && !(is(';') && !top().tags.has(tagTok.text))) {
        if (found.kind !== kind) throw errorAt(tagTok, `${tagTok.text} is a ${found.kind}, not a ${kind}`);
        return found;
      }
      const ty = structType(kind, tagTok.text);
      top().tags.set(tagTok.text, ty);
      return ty;
    }
    expect('{');
    let ty: Type;
    const existing = tagTok ? top().tags.get(tagTok.text) : undefined;
    if (existing && !existing.complete && existing.kind === kind) ty = existing;
    else {
      if (existing?.complete) throw errorAt(tagTok!, `${kind} ${tagTok!.text} is already defined`);
      ty = structType(kind, tagTok?.text);
      if (tagTok) top().tags.set(tagTok.text, ty);
    }
    const members: Member[] = [];
    while (!take('}')) {
      if (is('_Static_assert')) {
        staticAssert();
        continue;
      }
      const attr: DeclAttr = { isTypedef: false, isStatic: false, isExtern: false, isInline: false };
      const base = declspec(attr);
      // An anonymous struct or union member: its members are reachable directly.
      if ((base.kind === 'struct' || base.kind === 'union') && take(';')) {
        members.push({ ty: base, offset: 0 });
        continue;
      }
      let first = true;
      while (!take(';')) {
        if (!first) expect(',');
        first = false;
        let d: { ty: Type; name?: Token } = { ty: base };
        if (!is(':')) d = declarator(base);
        const m: Member = { name: d.name, ty: d.ty, offset: 0 };
        if (take(':')) {
          const wTok = peek();
          m.bitWidth = Number(constInt(conditional()));
          if (!isInteger(d.ty)) throw errorAt(wTok, 'a bit-field must have an integer type');
          if (m.bitWidth < 0 || m.bitWidth > d.ty.size * 8) throw errorAt(wTok, `a bit-field of ${typeName(d.ty)} can be 0 to ${d.ty.size * 8} bits wide`);
        }
        skipAttribute();
        members.push(m);
      }
    }
    skipAttribute();
    // Flexible array member: the last member may be `T name[]`.
    const last = members[members.length - 1];
    if (last && last.ty.kind === 'array' && last.ty.len! < 0) {
      last.ty = arrayOf(last.ty.base!, 0);
      ty.flexible = true;
    }
    layout(ty, members, kind);
    return ty;
  };

  const layout = (ty: Type, members: Member[], kind: 'struct' | 'union') => {
    let bits = 0; // struct: offset in bits
    let align = 1;
    let size = 0;
    for (const m of members) {
      if (m.ty.size === 0 && m.ty.kind !== 'array' && !(m.ty.kind === 'struct' && m.ty.complete)) {
        if (!(m.ty.kind === 'struct' || m.ty.kind === 'union') || !m.ty.complete) throw errorAt(m.name ?? peek(), `member ${m.name?.text ?? ''} has incomplete type ${typeName(m.ty)}`);
      }
      if (kind === 'union') {
        m.offset = 0;
        if (m.bitWidth !== undefined) m.bitOffset = 0;
        size = Math.max(size, m.ty.size);
        if (!(m.bitWidth !== undefined && !m.name)) align = Math.max(align, m.ty.align);
        continue;
      }
      if (m.bitWidth !== undefined) {
        const unit = m.ty.size * 8;
        if (m.bitWidth === 0) {
          bits = alignTo(bits, unit);
          continue;
        }
        // Start a new unit if the field would straddle one (as GCC and clang do).
        if (Math.floor(bits / unit) !== Math.floor((bits + m.bitWidth - 1) / unit)) bits = alignTo(bits, unit);
        m.offset = Math.floor(bits / unit) * m.ty.size;
        m.bitOffset = bits - m.offset * 8;
        bits += m.bitWidth;
        if (m.name) align = Math.max(align, m.ty.align);
        continue;
      }
      bits = alignTo(bits, m.ty.align * 8);
      m.offset = bits / 8;
      bits += m.ty.size * 8;
      align = Math.max(align, m.ty.align);
    }
    if (kind === 'struct') size = Math.ceil(bits / 8);
    ty.members = members;
    ty.align = align;
    ty.size = alignTo(size, align);
    ty.complete = true;
  };

  /** Finds a member by name, looking inside anonymous members; returns the path. */
  const findMember = (ty: Type, name: string): Member[] | undefined => {
    for (const m of ty.members ?? []) {
      if (m.name?.text === name) return [m];
      if (!m.name && (m.ty.kind === 'struct' || m.ty.kind === 'union')) {
        const inner = findMember(m.ty, name);
        if (inner) return [m, ...inner];
      }
    }
    return undefined;
  };

  const memberAccess = (n: Node, nameTok: Token): Node => {
    if (n.ty.kind !== 'struct' && n.ty.kind !== 'union') throw errorAt(nameTok, `"${nameTok.text}" is not a member: the left side is ${typeName(n.ty)}, not a struct or union`);
    if (!n.ty.complete) throw errorAt(nameTok, `${typeName(n.ty)} is incomplete`);
    const path = findMember(n.ty, nameTok.text);
    if (!path) throw errorAt(nameTok, `${typeName(n.ty)} has no member named "${nameTok.text}"`);
    for (const m of path) n = mk('member', nameTok, m.ty, { lhs: n, member: m, start: n.start, end: where(nameTok).end });
    return n;
  };

  const enumSpecifier = (): Type => {
    const ty = enumType();
    let tagTok: Token | undefined;
    if (peek().kind === 'ident') tagTok = ident('a tag');
    if (tagTok && !is('{')) {
      const found = findTag(tagTok.text);
      if (found) {
        if (found.kind !== 'enum') throw errorAt(tagTok, `${tagTok.text} is not an enum`);
        return found;
      }
      top().tags.set(tagTok.text, ty);
      return ty; // GNU: forward-declared enum
    }
    expect('{');
    let val = 0n;
    let first = true;
    while (!take('}')) {
      if (!first) {
        expect(',');
        if (take('}')) break;
      }
      first = false;
      const name = ident('an enumerator name');
      if (take('=')) val = constInt(conditional());
      top().vars.set(name.text, { enumVal: val });
      if (val < 0n) ty.hasNegative = true;
      val++;
    }
    if (tagTok) top().tags.set(tagTok.text, ty);
    return ty;
  };

  // ------------------------------------------------------------ constants

  const evalValue = (n: Node): CVal => {
    const int = (v: bigint): CVal => ({ kind: 'int', v: wrap(v, n.ty) });
    const asInt = (x: Node): bigint => {
      const v = evalValue(x);
      if (v.kind === 'int') return v.v;
      if (v.kind === 'float') return BigInt(Math.trunc(v.v));
      if (!v.obj) return BigInt(v.addend);
      throw errorAt(x.tok, 'not a constant: an address is only known when the program is linked');
    };
    const asNum = (x: Node): number => {
      const v = evalValue(x);
      if (v.kind === 'float') return v.v;
      if (v.kind === 'int') return x.ty.unsigned ? Number(BigInt.asUintN(x.ty.size * 8, v.v)) : Number(v.v);
      throw errorAt(x.tok, 'not a constant');
    };
    const notConst = (): never => {
      throw errorAt(n.tok, 'not a constant expression');
    };
    switch (n.kind) {
      case 'num':
        return n.fval !== undefined ? { kind: 'float', v: n.fval } : int(n.val!);
      case 'cast': {
        const v = evalValue(n.lhs!);
        if (n.ty.kind === 'void') return v;
        if (isFloat(n.ty)) {
          const x = v.kind === 'float' ? v.v : v.kind === 'int' ? (n.lhs!.ty.unsigned ? Number(BigInt.asUintN(n.lhs!.ty.size * 8, v.v)) : Number(v.v)) : notConst();
          return { kind: 'float', v: n.ty.kind === 'float' ? Math.fround(x) : x };
        }
        if (n.ty.kind === 'bool') {
          if (v.kind === 'addr' && v.obj) return { kind: 'int', v: 1n };
          return { kind: 'int', v: (v.kind === 'float' ? v.v !== 0 : v.kind === 'int' ? v.v !== 0n : v.addend !== 0) ? 1n : 0n };
        }
        if (v.kind === 'float') return int(BigInt(Math.trunc(v.v)));
        if (v.kind === 'addr') return v.obj ? (n.ty.size >= 4 ? v : notConst()) : int(BigInt(v.addend));
        return int(v.v);
      }
      case 'add':
      case 'sub': {
        if (n.ty.kind === 'ptr') {
          const base = evalValue(n.lhs!);
          const off = Number(asInt(n.rhs!));
          const sign = n.kind === 'add' ? 1 : -1;
          if (base.kind === 'addr') return { ...base, addend: base.addend + sign * off };
          if (base.kind === 'int') return int(base.v + BigInt(sign * off));
          return notConst();
        }
        if (isFloat(n.ty)) return { kind: 'float', v: fround(n.ty, n.kind === 'add' ? asNum(n.lhs!) + asNum(n.rhs!) : asNum(n.lhs!) - asNum(n.rhs!)) };
        // Pointer difference of two addresses in the same object.
        const a = evalValue(n.lhs!);
        const b = evalValue(n.rhs!);
        if (a.kind === 'addr' && b.kind === 'addr' && a.obj === b.obj && n.kind === 'sub') return int(BigInt(a.addend - b.addend));
        if (a.kind === 'addr' || b.kind === 'addr') {
          if (a.kind === 'addr' && b.kind === 'int') return { ...a, addend: a.addend + (n.kind === 'add' ? 1 : -1) * Number(b.v) };
          return notConst();
        }
        return int(n.kind === 'add' ? asInt(n.lhs!) + asInt(n.rhs!) : asInt(n.lhs!) - asInt(n.rhs!));
      }
      case 'mul':
        return isFloat(n.ty) ? { kind: 'float', v: fround(n.ty, asNum(n.lhs!) * asNum(n.rhs!)) } : int(asInt(n.lhs!) * asInt(n.rhs!));
      case 'div':
      case 'mod': {
        if (isFloat(n.ty)) return { kind: 'float', v: fround(n.ty, n.kind === 'div' ? asNum(n.lhs!) / asNum(n.rhs!) : asNum(n.lhs!) % asNum(n.rhs!)) };
        let a = asInt(n.lhs!);
        let b = asInt(n.rhs!);
        if (b === 0n) throw errorAt(n.tok, 'division by zero in a constant expression');
        if (n.ty.unsigned) (a = BigInt.asUintN(n.ty.size * 8, a)), (b = BigInt.asUintN(n.ty.size * 8, b));
        return int(n.kind === 'div' ? a / b : a % b);
      }
      case 'band':
        return int(asInt(n.lhs!) & asInt(n.rhs!));
      case 'bor':
        return int(asInt(n.lhs!) | asInt(n.rhs!));
      case 'bxor':
        return int(asInt(n.lhs!) ^ asInt(n.rhs!));
      case 'shl':
        return int(asInt(n.lhs!) << (asInt(n.rhs!) & 63n));
      case 'shr': {
        let a = asInt(n.lhs!);
        if (n.ty.unsigned) a = BigInt.asUintN(n.ty.size * 8, a);
        return int(a >> (asInt(n.rhs!) & 63n));
      }
      case 'neg':
        return isFloat(n.ty) ? { kind: 'float', v: -asNum(n.lhs!) } : int(-asInt(n.lhs!));
      case 'bitnot':
        return int(~asInt(n.lhs!));
      case 'not':
        return int(truth(n.lhs!) ? 0n : 1n);
      case 'eq':
      case 'ne':
      case 'lt':
      case 'le': {
        const a = evalValue(n.lhs!);
        const b = evalValue(n.rhs!);
        if (a.kind === 'addr' || b.kind === 'addr') {
          if (a.kind === 'addr' && b.kind === 'addr' && a.obj === b.obj) return cmp(n.kind, BigInt(a.addend), BigInt(b.addend));
          if ((n.kind === 'eq' || n.kind === 'ne') && ((a.kind === 'addr' && a.obj && b.kind === 'int' && b.v === 0n) || (b.kind === 'addr' && b.obj && a.kind === 'int' && a.v === 0n)))
            return int(n.kind === 'ne' ? 1n : 0n);
          return notConst();
        }
        if (isFloat(n.lhs!.ty)) {
          const x = asNum(n.lhs!);
          const y = asNum(n.rhs!);
          return int((n.kind === 'eq' ? x === y : n.kind === 'ne' ? x !== y : n.kind === 'lt' ? x < y : x <= y) ? 1n : 0n);
        }
        const u = n.lhs!.ty.unsigned;
        const bitsz = n.lhs!.ty.size * 8;
        const x = u ? BigInt.asUintN(bitsz, asInt(n.lhs!)) : asInt(n.lhs!);
        const y = u ? BigInt.asUintN(bitsz, asInt(n.rhs!)) : asInt(n.rhs!);
        return cmp(n.kind, x, y);
      }
      case 'logand':
        return int(truth(n.lhs!) && truth(n.rhs!) ? 1n : 0n);
      case 'logor':
        return int(truth(n.lhs!) || truth(n.rhs!) ? 1n : 0n);
      case 'cond':
        return truth(n.cond!) ? evalValue(n.then!) : evalValue(n.els!);
      case 'comma':
        return evalValue(n.rhs!);
      case 'addr':
        return evalAddr(n.lhs!);
      case 'var':
        if (n.ty.kind === 'array' || n.ty.kind === 'func') return evalAddr(n);
        return notConst();
      case 'member':
      case 'deref':
        if (n.ty.kind === 'array') return evalAddr(n);
        return notConst();
      default:
        return notConst();
    }
    function truth(x: Node): boolean {
      const v = evalValue(x);
      return v.kind === 'int' ? v.v !== 0n : v.kind === 'float' ? v.v !== 0 : !!v.obj || v.addend !== 0;
    }
    function cmp(k: NodeKind, x: bigint, y: bigint): CVal {
      const r = k === 'eq' ? x === y : k === 'ne' ? x !== y : k === 'lt' ? x < y : x <= y;
      return { kind: 'int', v: r ? 1n : 0n };
    }
  };
  const evalAddr = (n: Node): CVal => {
    switch (n.kind) {
      case 'var':
        if (n.obj!.isLocal) throw errorAt(n.tok, `the address of local variable ${n.obj!.name} is not a constant`);
        return { kind: 'addr', obj: n.obj, addend: 0 };
      case 'member': {
        const base = evalAddr(n.lhs!);
        if (base.kind !== 'addr') throw errorAt(n.tok, 'not a constant');
        return { ...base, addend: base.addend + n.member!.offset };
      }
      case 'deref': {
        const v = evalValue(n.lhs!);
        if (v.kind === 'int') return { kind: 'addr', addend: Number(v.v) };
        return v;
      }
      case 'cast':
        return evalAddr(n.lhs!);
      default:
        throw errorAt(n.tok, 'not a constant address');
    }
  };
  const constInt = (n: Node): bigint => {
    if (!isInteger(n.ty) && n.ty.kind !== 'ptr') throw errorAt(n.tok, `expected an integer constant, not ${typeName(n.ty)}`);
    const v = evalValue(n);
    if (v.kind === 'int') return v.v;
    if (v.kind === 'addr' && !v.obj) return BigInt(v.addend);
    throw errorAt(n.tok, 'expected an integer constant');
  };
  const constExpr = () => constInt(conditional());
  const isConstant = (n: Node) => {
    try {
      return evalValue(n).kind === 'int';
    } catch {
      return false;
    }
  };

  const staticAssert = () => {
    const t = expect('_Static_assert');
    expect('(');
    const v = constExpr();
    let msg = '';
    if (take(',')) {
      const s = peek();
      if (s.kind !== 'str') throw errorAt(s, '_Static_assert needs a message string');
      pos++;
      msg = s.text;
    }
    expect(')');
    expect(';');
    if (v === 0n) throw errorAt(t, `static assertion failed${msg ? `: ${msg}` : ''}`);
  };

  // ------------------------------------------------------------ initializers

  const newInit = (ty: Type): Init => ({ ty, children: [] });
  const child = (init: Init, i: number): Init => {
    const ty = init.ty;
    if (ty.kind === 'array') {
      if (ty.len! >= 0 && i >= ty.len!) throw errorAt(peek(), `index ${i} is past the end of the array (${ty.len} elements)`);
      while (init.children.length <= i) init.children.push(newInit(ty.base!));
      return init.children[i]!;
    }
    while (init.children.length < ty.members!.length) init.children.push(newInit(ty.members![init.children.length]!.ty));
    return init.children[i]!;
  };
  const isEnd = () => is('}') || (is(',') && is('}', 1));
  const consumeEnd = () => {
    if (take('}')) return true;
    if (is(',') && is('}', 1)) {
      pos += 2;
      return true;
    }
    return false;
  };
  const skipExcess = () => {
    if (take('{')) {
      while (!consumeEnd()) {
        skipExcess();
        if (!is('}')) take(',');
      }
      return;
    }
    assign();
  };
  const arrayLen = (init: Init) => (init.ty.len! >= 0 ? init.ty.len! : Infinity);

  const initializer2 = (init: Init): void => {
    const ty = init.ty;
    if (ty.kind === 'array' && (peek().kind === 'str' || (is('{') && peek(1).kind === 'str' && (is('}', 2) || (is(',', 2) && is('}', 3))))) && isInteger(ty.base!)) {
      const braced = take('{');
      const s = peek();
      pos++;
      const units = [...s.bytes!, 0];
      const len = ty.len! < 0 ? units.length : ty.len!;
      if (ty.len! < 0) init.ty = arrayOf(ty.base!, len);
      for (let i = 0; i < Math.min(len, units.length); i++) {
        child(init, i).expr = num(ty.base!.size === 1 ? BigInt.asIntN(8, BigInt(units[i]!)) : BigInt(units[i]!), s, ty.base!);
      }
      if (braced) consumeEnd() || expect('}');
      return;
    }
    if (ty.kind === 'array') {
      if (is('{')) {
        pos++;
        let i = 0;
        let max = 0;
        let first = true;
        while (!consumeEnd()) {
          if (!first) expect(',', 'between initializers');
          first = false;
          if (is('[')) {
            pos++;
            i = Number(constExpr());
            let last = i;
            if (take('...')) last = Number(constExpr()); // GNU range [a ... b]
            expect(']');
            if (last > i) {
              // Every element in the range gets the same initializer (parsed again for each).
              const at = pos;
              for (let k = i; k <= last; k++) {
                pos = at;
                designation(child(init, k));
              }
              i = last;
            } else designation(child(init, i));
            i++;
          } else if (i < arrayLen(init)) {
            initializer2(child(init, i));
            i++;
          } else skipExcess();
          max = Math.max(max, i);
        }
        if (ty.len! < 0) init.ty = arrayOf(ty.base!, Math.max(max, init.children.length));
        return;
      }
      // Brace elision: as many elements as fit, from the enclosing list.
      for (let i = 0; i < arrayLen(init) && !isEnd() && peek().kind !== 'eof'; i++) {
        const save = pos;
        if (i > 0) expect(',');
        if (is('[') || is('.')) {
          pos = save;
          return;
        }
        initializer2(child(init, i));
        if (ty.len! < 0) init.ty = arrayOf(ty.base!, i + 1);
      }
      return;
    }
    if (ty.kind === 'struct' || ty.kind === 'union') {
      if (!ty.complete) throw errorAt(peek(), `cannot initialise incomplete ${typeName(ty)}`);
      if (!is('{')) {
        // An expression of the same struct type, or elided braces.
        const save = pos;
        const e = assign();
        if (e.ty === ty) {
          init.expr = e;
          return;
        }
        pos = save;
        let i = 0;
        for (; i < ty.members!.length && !isEnd(); i++) {
          const save2 = pos;
          if (i > 0) expect(',');
          if (is('[') || is('.')) {
            pos = save2;
            return;
          }
          if (ty.kind === 'union') init.mem = 0;
          initializer2(child(init, i));
          if (ty.kind === 'union') return;
        }
        return;
      }
      pos++;
      let i = 0;
      let first = true;
      while (!consumeEnd()) {
        if (!first) expect(',', 'between initializers');
        first = false;
        if (is('.')) {
          pos++;
          const name = ident('a member name');
          const path = findMember(ty, name.text);
          if (!path) throw errorAt(name, `${typeName(ty)} has no member named "${name.text}"`);
          i = ty.members!.indexOf(path[0]!);
          if (ty.kind === 'union') init.mem = i;
          let target = child(init, i);
          // A member inside an anonymous member: descend.
          for (const m of path.slice(1)) {
            const k = target.ty.members!.indexOf(m);
            if (target.ty.kind === 'union') target.mem = k;
            target = child(target, k);
          }
          designation(target);
          i++;
          continue;
        }
        if (ty.kind === 'union') {
          if (i === 0) {
            init.mem = 0;
            initializer2(child(init, 0));
          } else skipExcess();
          i++;
          continue;
        }
        if (i < ty.members!.length) {
          // Unnamed bit-fields take no initializer.
          while (i < ty.members!.length && ty.members![i]!.bitWidth !== undefined && !ty.members![i]!.name) i++;
          if (i < ty.members!.length) initializer2(child(init, i));
          else skipExcess();
          i++;
        } else skipExcess();
      }
      return;
    }
    if (take('{')) {
      // A scalar in braces: `int x = {3};`
      initializer2(init);
      consumeEnd() || expect('}');
      return;
    }
    init.expr = assign();
  };

  /** After a designator: more designators, then `=` and the initializer. */
  const designation = (init: Init): void => {
    if (is('[') && init.ty.kind === 'array') {
      pos++;
      const i = Number(constExpr());
      expect(']');
      designation(child(init, i));
      return;
    }
    if (is('.') && (init.ty.kind === 'struct' || init.ty.kind === 'union')) {
      pos++;
      const name = ident('a member name');
      const path = findMember(init.ty, name.text);
      if (!path) throw errorAt(name, `${typeName(init.ty)} has no member named "${name.text}"`);
      let target = init;
      for (const m of path) {
        const k = target.ty.members!.indexOf(m);
        if (target.ty.kind === 'union') target.mem = k;
        target = child(target, k);
      }
      designation(target);
      return;
    }
    take('=');
    initializer2(init);
  };

  const initializer = (ty: Type): Init => {
    const init = newInit(ty);
    initializer2(init);
    // A struct with a flexible array member takes its size from the initializer.
    return init;
  };

  /** Local initialisation: zero the object, then assign each initialised element. */
  const localInit = (obj: Obj, init: Init, tok: Token): Node => {
    const stmts: Node[] = [];
    const base = (): Node => mk('var', tok, obj.ty, { obj });
    if (obj.ty.kind === 'array' || obj.ty.kind === 'struct' || obj.ty.kind === 'union') {
      if (!init.expr) stmts.push(mk('memzero', tok, T.void, { obj }));
    }
    const walk = (it: Init, lv: () => Node) => {
      if (it.expr) {
        stmts.push(mk('exprstmt', it.expr.tok, T.void, { lhs: newAssign(lv(), it.expr, it.expr.tok), start: it.expr.start, end: it.expr.end }));
        return;
      }
      if (it.ty.kind === 'array') {
        it.children.forEach((c, i) => walk(c, () => deref(newAdd(lv(), num(i, tok), tok), tok)));
        return;
      }
      if (it.ty.kind === 'struct') {
        it.children.forEach((c, i) => walk(c, () => mk('member', tok, it.ty.members![i]!.ty, { lhs: lv(), member: it.ty.members![i]! })));
        return;
      }
      if (it.ty.kind === 'union') {
        const i = it.mem ?? 0;
        const c = it.children[i];
        if (c) walk(c, () => mk('member', tok, it.ty.members![i]!.ty, { lhs: lv(), member: it.ty.members![i]! }));
      }
    };
    walk(init, base);
    return mk('block', tok, T.void, { stmts });
  };

  /** Static initialisation: the object's bytes, with relocations for addresses. */
  const globalInit = (obj: Obj, init: Init) => {
    const size = obj.ty.size;
    const data = new Uint8Array(size);
    const dv = new DataView(data.buffer);
    const relocs: Reloc[] = [];
    const write = (it: Init, ty: Type, offset: number) => {
      if (it.expr) {
        if (ty.kind === 'struct' || ty.kind === 'union') {
          // A compound literal (GNU, as GCC accepts): copy its bytes.
          let e = it.expr;
          while (e.kind === 'cast') e = e.lhs!;
          const src = e.kind === 'var' && e.obj!.anonymous && e.obj!.data ? e.obj! : undefined;
          if (!src || src.ty !== ty) throw errorAt(it.expr.tok, 'a static struct can only be initialised with braces or a compound literal');
          data.set(src.data!.subarray(0, ty.size), offset);
          for (const r of src.relocs ?? []) relocs.push({ ...r, offset: offset + r.offset });
          return;
        }
        const e = convertForAssign(it.expr, ty, it.expr.tok);
        const v = evalValue(e);
        if (v.kind === 'addr') {
          if (v.obj) relocs.push({ offset, target: v.obj, addend: v.addend });
          else dv.setUint32(offset, v.addend >>> 0, true);
          return;
        }
        writeScalar(dv, offset, ty, v);
        return;
      }
      if (ty.kind === 'array') it.children.forEach((c, i) => write(c, ty.base!, offset + i * ty.base!.size));
      else if (ty.kind === 'struct') it.children.forEach((c, i) => writeMember(c, ty.members![i]!, offset));
      else if (ty.kind === 'union') {
        const i = it.mem ?? 0;
        const c = it.children[i];
        if (c) writeMember(c, ty.members![i]!, offset);
      }
    };
    const writeMember = (c: Init, m: Member, offset: number) => {
      if (m.bitWidth === undefined) return write(c, m.ty, offset + m.offset);
      if (!c.expr) return;
      const v = evalValue(convertForAssign(c.expr, m.ty, c.expr.tok));
      if (v.kind !== 'int') throw errorAt(c.expr.tok, 'a bit-field needs an integer constant');
      const at = offset + m.offset;
      const unitBits = BigInt(m.ty.size * 8);
      let unit = readUnit(dv, at, m.ty.size);
      const mask = ((1n << BigInt(m.bitWidth)) - 1n) << BigInt(m.bitOffset!);
      unit = (unit & ~mask) | ((v.v << BigInt(m.bitOffset!)) & mask);
      writeUnit(dv, at, m.ty.size, BigInt.asUintN(Number(unitBits), unit));
    };
    write(init, obj.ty, 0);
    obj.data = data;
    obj.relocs = relocs;
  };

  // ------------------------------------------------------------ declarations

  const declaration = (base: Type, attr: DeclAttr): Node => {
    const startTok = peek();
    const stmts: Node[] = [];
    let first = true;
    while (!take(';')) {
      if (!first) expect(',', 'between declarations');
      first = false;
      const { ty, name } = declarator(base);
      if (!name) throw errorAt(peek(), 'expected a variable name');
      if (attr.isTypedef) {
        top().vars.set(name.text, { typedef: ty });
        continue;
      }
      if (ty.kind === 'void') throw errorAt(name, `variable ${name.text} cannot have type void`);
      if (ty.kind === 'func') {
        // A function declared inside a function: it refers to the global one.
        const g = declareFunction(name, ty, { ...attr, isStatic: false });
        top().vars.set(name.text, { obj: g });
        continue;
      }
      if (attr.isStatic || attr.isExtern) {
        // Static locals live in data memory; extern ones refer to a global.
        let g: Obj;
        if (attr.isExtern) {
          g = findGlobal(name.text) ?? declareGlobalVar(name, ty, { ...attr, isStatic: false });
        } else {
          g = anonGlobal(ty, name, `${fn!.name}.${name.text}`);
          g.anonymous = false;
          g.name = `${fn!.name}.${name.text}`;
          if (take('=')) {
            const init = initializer(ty);
            g.ty = init.ty;
            globalInit(g, init);
          }
          if (g.ty.kind === 'array' && g.ty.len! < 0) throw errorAt(name, `array ${name.text} needs a size`);
        }
        top().vars.set(name.text, { obj: g });
        continue;
      }
      if (ty.vla) {
        // T a[n] becomes a pointer to n elements of stack space (sizeof a is not supported).
        const obj = newLocal(name.text, pointerTo(ty.base!), name);
        const size = mk('mul', name, T.uint, { lhs: cast(ty.vla, T.uint), rhs: num(ty.base!.size, name, T.uint) });
        const allocaTy = funcType(pointerTo(T.void));
        allocaTy.params = [T.uint];
        allocaTy.paramNames = [undefined];
        const alloca = declareFunction({ ...name, text: '__builtin_alloca' }, allocaTy, { isTypedef: false, isStatic: false, isExtern: true, isInline: false });
        const call = mk('call', name, allocaTy.ret!, { lhs: mk('var', name, allocaTy, { obj: alloca }), args: [size], fnTy: allocaTy });
        stmts.push(mk('exprstmt', name, T.void, { lhs: newAssign(mk('var', name, obj.ty, { obj }), call, name) }));
        continue;
      }
      const obj = newLocal(name.text, ty, name);
      if (take('=')) {
        const init = initializer(ty);
        obj.ty = init.ty;
        const n = localInit(obj, init, name);
        span(n, tokens.indexOf(startTok));
        stmts.push(n);
      }
      if (obj.ty.size === 0 && obj.ty.kind === 'array' && obj.ty.len! < 0) throw errorAt(name, `array ${name.text} needs a size or an initializer`);
      if ((obj.ty.kind === 'struct' || obj.ty.kind === 'union') && !obj.ty.complete) throw errorAt(name, `variable ${name.text} has incomplete type ${typeName(obj.ty)}`);
    }
    return mk('block', startTok, T.void, { stmts });
  };

  const findGlobal = (name: string): Obj | undefined => scopes[0]!.vars.get(name)?.obj;

  const declareFunction = (name: Token, ty: Type, attr: DeclAttr): Obj => {
    const existing = findGlobal(name.text);
    if (existing) {
      if (!existing.isFunction) throw errorAt(name, `${name.text} is already declared as a variable`);
      if (!sameType(existing.ty, ty)) throw errorAt(name, `conflicting types for ${name.text}: ${typeName(ty)} here, ${typeName(existing.ty)} before`);
      // A later prototype fills in an earlier `()` declaration.
      if (existing.ty.noProto && !ty.noProto) existing.ty = ty;
      if (attr.isStatic) existing.isStatic = true;
      return existing;
    }
    const o = newGlobal(name.text, ty, name);
    o.isStatic = attr.isStatic;
    o.isInline = attr.isInline;
    scopes[0]!.vars.set(name.text, { obj: o });
    return o;
  };

  const declareGlobalVar = (name: Token, ty: Type, attr: DeclAttr): Obj => {
    const existing = findGlobal(name.text);
    if (existing) {
      if (existing.isFunction) throw errorAt(name, `${name.text} is already declared as a function`);
      if (!sameType(existing.ty, ty)) throw errorAt(name, `conflicting types for ${name.text}: ${typeName(ty)} here, ${typeName(existing.ty)} before`);
      if (existing.ty.kind === 'array' && existing.ty.len! < 0 && ty.len! >= 0) existing.ty = ty;
      return existing;
    }
    const o = newGlobal(name.text, ty, name);
    o.isStatic = attr.isStatic;
    scopes[0]!.vars.set(name.text, { obj: o });
    return o;
  };

  const globalVariable = (base: Type, attr: DeclAttr, firstDecl: { ty: Type; name?: Token }) => {
    let d = firstDecl;
    for (;;) {
      const name = d.name!;
      if (d.ty.kind === 'func') declareFunction(name, d.ty, attr);
      else {
        if (d.ty.kind === 'void') throw errorAt(name, `variable ${name.text} cannot have type void`);
        const o = declareGlobalVar(name, d.ty, attr);
        if (take('=')) {
          if (o.isDefinition && o.data && !o.tentative) throw errorAt(name, `${name.text} is defined twice`);
          const init = initializer(o.ty);
          o.ty = init.ty;
          globalInit(o, init);
          o.isDefinition = true;
          o.tentative = false;
        } else if (!attr.isExtern && !o.isDefinition) {
          // A tentative definition: zero unless defined elsewhere in this file.
          o.isDefinition = true;
          o.tentative = true;
        }
      }
      if (take(';')) return;
      expect(',', 'between declarations');
      d = declarator(base);
      if (!d.name) throw errorAt(peek(), 'expected a name');
    }
  };

  const functionDefinition = (d: { ty: Type; name?: Token }, attr: DeclAttr, startIdx: number) => {
    const name = d.name!;
    let ty = d.ty;
    // Old-style definition: `int f(a, b) int a; char *b; { … }`.
    if (ty.oldStyleNames) {
      const types = new Map<string, Type>();
      while (!is('{')) {
        const b = declspec();
        let first = true;
        while (!take(';')) {
          if (!first) expect(',');
          first = false;
          const p = declarator(b);
          let pty = p.ty;
          if (pty.kind === 'array') pty = pointerTo(pty.base!);
          types.set(p.name!.text, pty);
        }
      }
      ty = { ...ty, noProto: false, params: ty.oldStyleNames.map((n) => promote(types.get(n.text) ?? T.int)), paramNames: ty.oldStyleNames, oldStyleNames: undefined };
      // Arguments arrive promoted (as with no prototype), so float parameters are not allowed here.
      for (const [k, v] of types) if (v.kind === 'float') throw errorAt(name, `old-style parameter ${k} of type float is not supported`);
    }
    const f = declareFunction(name, ty, attr);
    if (f.isDefinition) throw errorAt(name, `function ${name.text} is defined twice`);
    f.ty = ty;
    f.isDefinition = true;
    f.tok = name;
    fn = f;
    fnLocals = [];
    gotos = [];
    labels = new Set();
    enterScope();
    f.params = ty.params!.map((pty, i) => {
      const pn = ty.paramNames![i];
      const o = newLocal(pn?.text ?? `.param${i}`, pty, pn ?? name);
      o.isParam = true;
      if (!pn) top().vars.delete(o.name);
      return o;
    });
    if (ty.variadic) {
      f.vaArea = newLocal('__va_area', pointerTo(T.char), name);
      top().vars.delete('__va_area');
    }
    // __func__
    const fname = newObjString(name.text, name);
    top().vars.set('__func__', { obj: fname });
    top().vars.set('__FUNCTION__', { obj: fname });
    const body = compoundStmt();
    leaveScope();
    for (const g of gotos) if (!labels.has(g.label!)) throw errorAt(g.tok, `goto ${g.label}: there is no label ${g.label} in ${name.text}`);
    f.body = body;
    f.locals = fnLocals;
    f.labels = labels;
    f.needsDispatch = f.needsDispatch || gotos.length > 0;
    const a = where(tokens[startIdx]!);
    f.start = a.offset;
    f.end = where(tokens[pos - 1]!).end;
    fn = undefined;
  };

  const newObjString = (text: string, tok: Token): Obj => {
    const n = stringLiteral({ ...tok, kind: 'str', bytes: [...new TextEncoder().encode(text)], elemSize: 1, text: JSON.stringify(text) });
    return n.obj!;
  };

  // ------------------------------------------------------------ statements

  const compoundStmt = (): Node => {
    const open = expect('{');
    const startIdx = pos - 1;
    const stmts: Node[] = [];
    enterScope();
    blockDepth++;
    while (!take('}')) {
      if (peek().kind === 'eof') throw errorAt(open, '{ has no closing }');
      if (isTypename() && !is(':', 1)) {
        const attr: DeclAttr = { isTypedef: false, isStatic: false, isExtern: false, isInline: false };
        const base = declspec(attr);
        if (take(';')) continue; // `struct S { … };`
        stmts.push(declaration(base, attr));
        continue;
      }
      if (is('_Static_assert')) {
        staticAssert();
        continue;
      }
      stmts.push(stmt());
    }
    blockDepth--;
    leaveScope();
    return span(mk('block', open, T.void, { stmts }), startIdx);
  };

  const stmt = (): Node => {
    const t = peek();
    const startIdx = pos;
    if (t.kind === 'keyword') {
      switch (t.text) {
        case 'return': {
          pos++;
          if (take(';')) {
            if (fn!.ty.ret!.kind !== 'void' && false) throw errorAt(t, 'return needs a value');
            return span(mk('return', t, T.void), startIdx);
          }
          let e = expr();
          expect(';', 'after the return value');
          const ret = fn!.ty.ret!;
          if (ret.kind === 'void') {
            e = cast(e, T.void);
          } else e = convertForAssign(e, ret, t);
          return span(mk('return', t, T.void, { lhs: e }), startIdx);
        }
        case 'if': {
          pos++;
          expect('(', 'after if');
          const cond = toBool(expr());
          expect(')', 'after the if condition');
          const then = stmt();
          const els = take('else') ? stmt() : undefined;
          return span(mk('if', t, T.void, { cond, then, els }), startIdx);
        }
        case 'switch': {
          pos++;
          expect('(', 'after switch');
          let cond = integer(expr(), 'switch');
          cond = cast(cond, promote(cond.ty));
          expect(')');
          const node = mk('switch', t, T.void, { cond, cases: [], regular: true });
          const saved = curSwitch;
          curSwitch = { node, depth: blockDepth + 1 };
          breakable++;
          node.body = stmt();
          breakable--;
          curSwitch = saved;
          // Cases must be statements of the switch's own { } for the structured form.
          if (node.body.kind !== 'block') node.regular = node.cases!.length === 0 && !node.deflt;
          if (!node.regular) fn!.needsDispatch = true;
          return span(node, startIdx);
        }
        case 'case':
        case 'default': {
          pos++;
          if (!curSwitch) throw errorAt(t, `${t.text} is only allowed inside a switch`);
          const sw = curSwitch.node;
          let val: bigint | undefined;
          if (t.text === 'case') {
            val = BigInt.asIntN(sw.cond!.ty.size * 8, constExpr());
            if (sw.cond!.ty.unsigned) val = BigInt.asUintN(sw.cond!.ty.size * 8, val);
            if (sw.cases!.some((c) => c.caseVal === val)) throw errorAt(t, `duplicate case ${val}`);
          } else if (sw.deflt) throw errorAt(t, 'a switch can have only one default');
          expect(':');
          if (blockDepth !== curSwitch.depth) sw.regular = false;
          const node = mk('case', t, T.void, { caseVal: val });
          span(node, startIdx);
          node.body = is('}') ? mk('nop', t, T.void) : stmt();
          if (t.text === 'case') sw.cases!.push(node);
          else sw.deflt = node;
          return node;
        }
        case 'for': {
          pos++;
          expect('(', 'after for');
          enterScope();
          let init: Node | undefined;
          if (isTypename()) {
            const attr: DeclAttr = { isTypedef: false, isStatic: false, isExtern: false, isInline: false };
            init = declaration(declspec(attr), attr);
          } else if (!take(';')) {
            init = exprStmtNoSemi();
            expect(';');
          }
          const cond = is(';') ? undefined : toBool(expr());
          expect(';', 'after the for condition');
          const inc = is(')') ? undefined : expr();
          expect(')');
          breakable++;
          loopDepth++;
          const body = stmt();
          breakable--;
          loopDepth--;
          leaveScope();
          return span(mk('for', t, T.void, { init, cond, inc, body }), startIdx);
        }
        case 'while': {
          pos++;
          expect('(', 'after while');
          const cond = toBool(expr());
          expect(')');
          breakable++;
          loopDepth++;
          const body = stmt();
          breakable--;
          loopDepth--;
          return span(mk('for', t, T.void, { cond, body }), startIdx);
        }
        case 'do': {
          pos++;
          breakable++;
          loopDepth++;
          const body = stmt();
          breakable--;
          loopDepth--;
          expect('while', 'after the do body');
          expect('(');
          const cond = toBool(expr());
          expect(')');
          expect(';');
          return span(mk('do', t, T.void, { cond, body }), startIdx);
        }
        case 'goto': {
          pos++;
          if (is('*')) throw errorAt(t, 'computed goto (goto *p) is not supported');
          const l = ident('a label');
          expect(';');
          const n = span(mk('goto', t, T.void, { label: l.text }), startIdx);
          gotos.push(n);
          return n;
        }
        case 'break':
          pos++;
          if (!breakable) throw errorAt(t, 'break is only allowed in a loop or switch');
          expect(';');
          return span(mk('break', t, T.void), startIdx);
        case 'continue':
          pos++;
          if (!loopDepth) throw errorAt(t, 'continue is only allowed in a loop');
          expect(';');
          return span(mk('continue', t, T.void), startIdx);
      }
    }
    if (t.kind === 'ident' && is(':', 1)) {
      pos += 2;
      if (labels.has(t.text)) throw errorAt(t, `label ${t.text} is defined twice`);
      labels.add(t.text);
      fn!.needsDispatch = true;
      const node = mk('label', t, T.void, { label: t.text });
      node.body = is('}') ? mk('nop', t, T.void) : stmt();
      return span(node, startIdx);
    }
    if (is('{')) return compoundStmt();
    if (take(';')) return mk('nop', t, T.void);
    const e = exprStmtNoSemi();
    expect(';', 'after the expression');
    return span(e, startIdx);
  };

  const exprStmtNoSemi = (): Node => {
    const e = expr();
    return mk('exprstmt', e.tok, T.void, { lhs: e, start: e.start, end: e.end });
  };

  // ------------------------------------------------------------ expressions

  const expr = (): Node => {
    const startIdx = pos;
    let n = assign();
    while (is(',')) {
      const t = peek();
      pos++;
      const r = assign();
      n = mk('comma', t, decayIfNeeded(r).ty, { lhs: n, rhs: decayIfNeeded(r) });
      span(n, startIdx);
    }
    return n;
  };
  const decayIfNeeded = (n: Node) => (n.ty.kind === 'array' || n.ty.kind === 'func' ? decay(n) : n);

  const ASSIGN_OPS: Record<string, NodeKind> = { '+=': 'add', '-=': 'sub', '*=': 'mul', '/=': 'div', '%=': 'mod', '&=': 'band', '|=': 'bor', '^=': 'bxor', '<<=': 'shl', '>>=': 'shr' };

  const assign = (): Node => {
    const startIdx = pos;
    const l = conditional();
    const t = peek();
    if (t.kind === 'punct' && t.text === '=') {
      pos++;
      const r = assign();
      return span(newAssign(l, r, t), startIdx);
    }
    if (t.kind === 'punct' && t.text in ASSIGN_OPS) {
      pos++;
      const r = assign();
      return span(opAssign(ASSIGN_OPS[t.text]!, l, r, t), startIdx);
    }
    return l;
  };

  const opAssign = (op: NodeKind, l: Node, r: Node, t: Token): Node => {
    checkAssignable(l, t);
    r = rvalue(r);
    if (l.ty.kind === 'ptr' && (op === 'add' || op === 'sub')) {
      if (!isInteger(r.ty)) throw errorAt(t, `${t.text} on a pointer needs an integer`);
      return mk('opassign', t, l.ty, { lhs: l, rhs: scaled(r, l.ty.base!, t), op, opTy: l.ty });
    }
    if (!isNumeric(l.ty) || !isNumeric(r.ty)) throw errorAt(t, `${t.text} needs numbers, not ${typeName(l.ty)} and ${typeName(r.ty)}`);
    if (op === 'shl' || op === 'shr') {
      if (!isInteger(l.ty) || !isInteger(r.ty)) throw errorAt(t, `${t.text} needs integers`);
      const opTy = promote(l.ty);
      return mk('opassign', t, l.ty, { lhs: l, rhs: cast(r, opTy.kind === 'llong' ? T.llong : T.int), op, opTy });
    }
    if ((op === 'mod' || op === 'band' || op === 'bor' || op === 'bxor') && (!isInteger(l.ty) || !isInteger(r.ty))) throw errorAt(t, `${t.text} needs integers`);
    const opTy = commonType(l.ty, r.ty);
    return mk('opassign', t, l.ty, { lhs: l, rhs: cast(r, opTy), op, opTy });
  };

  const conditional = (): Node => {
    const startIdx = pos;
    const c = logor();
    if (!is('?')) return c;
    const t = peek();
    pos++;
    // GNU `a ?: b`
    if (is(':')) {
      pos++;
      throw errorAt(t, 'the GNU "a ?: b" form is not supported');
    }
    let a = expr();
    expect(':', 'in ?:');
    let b = conditional();
    const cond = toBool(c);
    let ty: Type;
    if (a.ty.kind === 'void' || b.ty.kind === 'void') {
      ty = T.void;
      a = cast(a, T.void);
      b = cast(b, T.void);
    } else if ((a.ty.kind === 'struct' || a.ty.kind === 'union') && a.ty === b.ty) ty = a.ty;
    else {
      a = rvalue(a);
      b = rvalue(b);
      if (isNumeric(a.ty) && isNumeric(b.ty)) ty = commonType(a.ty, b.ty);
      else if (a.ty.kind === 'ptr') ty = b.ty.kind === 'ptr' && a.ty.base!.kind === 'void' ? b.ty : a.ty;
      else if (b.ty.kind === 'ptr') ty = b.ty;
      else throw errorAt(t, `the two sides of ?: have incompatible types ${typeName(a.ty)} and ${typeName(b.ty)}`);
      a = cast(a, ty);
      b = cast(b, ty);
    }
    return span(mk('cond', t, ty, { cond, then: a, els: b }), startIdx);
  };

  const logical = (kind: 'logand' | 'logor', op: string, next: () => Node) => (): Node => {
    const startIdx = pos;
    let l = next();
    while (is(op)) {
      const t = peek();
      pos++;
      const r = next();
      l = span(mk(kind, t, T.int, { lhs: toBool(l), rhs: toBool(r) }), startIdx);
    }
    return l;
  };

  const bitwise = (kind: NodeKind, op: string, next: () => Node) => (): Node => {
    const startIdx = pos;
    let l = next();
    while (is(op)) {
      const t = peek();
      pos++;
      const r = integer(next(), op);
      l = span(binaryArith(kind, integer(l, op), r, t), startIdx);
    }
    return l;
  };

  const bitand = bitwise('band', '&', () => equality());
  const bitxor = bitwise('bxor', '^', () => bitand());
  const bitor = bitwise('bor', '|', () => bitxor());
  const logand = logical('logand', '&&', () => bitor());
  const logor = logical('logor', '||', () => logand());

  const equality = (): Node => {
    const startIdx = pos;
    let l = relational();
    for (;;) {
      const t = peek();
      if (t.kind !== 'punct' || (t.text !== '==' && t.text !== '!=')) return l;
      pos++;
      const r = relational();
      l = span(compare(t.text === '==' ? 'eq' : 'ne', l, r, t), startIdx);
    }
  };
  const relational = (): Node => {
    const startIdx = pos;
    let l = shift();
    for (;;) {
      const t = peek();
      if (t.kind !== 'punct' || !['<', '<=', '>', '>='].includes(t.text)) return l;
      pos++;
      const r = shift();
      // a > b is b < a (both sides are already evaluated left to right in C's sense: unsequenced).
      if (t.text === '<') l = compare('lt', l, r, t);
      else if (t.text === '<=') l = compare('le', l, r, t);
      else if (t.text === '>') l = swapped(compare('lt', r, l, t));
      else l = swapped(compare('le', r, l, t));
      span(l, startIdx);
    }
  };
  /** Marks a comparison built from > or >= (operands swapped), so the generator can keep source order. */
  const swapped = (n: Node) => ((n.implicit = true), n);

  const shift = (): Node => {
    const startIdx = pos;
    let l = add();
    for (;;) {
      const t = peek();
      if (t.kind !== 'punct' || (t.text !== '<<' && t.text !== '>>')) return l;
      pos++;
      const r = integer(add(), t.text);
      l = integer(l, t.text);
      const ty = promote(l.ty);
      l = span(mk(t.text === '<<' ? 'shl' : 'shr', t, ty, { lhs: cast(l, ty), rhs: cast(r, ty.kind === 'llong' ? T.llong : T.int) }), startIdx);
    }
  };
  const add = (): Node => {
    const startIdx = pos;
    let l = mul();
    for (;;) {
      const t = peek();
      if (t.kind !== 'punct' || (t.text !== '+' && t.text !== '-')) return l;
      pos++;
      const r = mul();
      l = span(t.text === '+' ? newAdd(l, r, t) : newSub(l, r, t), startIdx);
    }
  };
  const mul = (): Node => {
    const startIdx = pos;
    let l = castExpr();
    for (;;) {
      const t = peek();
      if (t.kind !== 'punct' || !['*', '/', '%'].includes(t.text)) return l;
      pos++;
      const r = castExpr();
      if (t.text === '%') l = binaryArith('mod', integer(l, '%'), integer(r, '%'), t);
      else l = binaryArith(t.text === '*' ? 'mul' : 'div', arith(l, t.text), arith(r, t.text), t);
      span(l, startIdx);
    }
  };

  const castExpr = (): Node => {
    if (is('(') && isTypename(peek(1))) {
      const startIdx = pos;
      const t = peek();
      pos++;
      const ty = typename();
      expect(')', 'after the type in a cast');
      // A compound literal: (type){ … }
      if (is('{')) return span(compoundLiteral(ty, t), startIdx);
      const e = castExpr();
      if (ty.kind === 'void') return span(mk('cast', t, T.void, { lhs: e }), startIdx);
      if ((ty.kind === 'struct' || ty.kind === 'union') && e.ty === ty) return span(e, startIdx); // GNU: a cast to its own type
      if (!isScalar(ty)) throw errorAt(t, `cannot cast to ${typeName(ty)}`);
      const v = scalar(e, 'a cast');
      if ((isFloat(ty) && v.ty.kind === 'ptr') || (ty.kind === 'ptr' && isFloat(v.ty))) throw errorAt(t, `cannot cast ${typeName(v.ty)} to ${typeName(ty)}`);
      const n = mk('cast', t, ty, { lhs: v, implicit: false });
      return span(n, startIdx);
    }
    return unary();
  };

  const compoundLiteral = (ty: Type, t: Token): Node => {
    if (!fn) {
      const o = anonGlobal(ty, t, '.compoundliteral');
      const init = initializer(ty);
      o.ty = init.ty;
      globalInit(o, init);
      return mk('var', t, o.ty, { obj: o });
    }
    const o = newLocal(`.compoundliteral${fnLocals.length}`, ty, t);
    top().vars.delete(o.name);
    const init = initializer(ty);
    o.ty = init.ty;
    o.inMemory = true;
    const initNode = localInit(o, init, t);
    const v = mk('var', t, o.ty, { obj: o });
    return mk('comma', t, o.ty, { lhs: mk('stmtexpr', t, T.void, { stmts: [initNode] }), rhs: v });
  };

  const unary = (): Node => {
    const t = peek();
    const startIdx = pos;
    if (t.kind === 'punct') {
      switch (t.text) {
        case '+': {
          pos++;
          const e = arith(castExpr(), 'unary +');
          return span(cast(e, promote(e.ty)), startIdx);
        }
        case '-': {
          pos++;
          let e = arith(castExpr(), 'unary -');
          e = cast(e, promote(e.ty));
          return span(mk('neg', t, e.ty, { lhs: e }), startIdx);
        }
        case '!': {
          pos++;
          return span(mk('not', t, T.int, { lhs: toBool(castExpr()) }), startIdx);
        }
        case '~': {
          pos++;
          let e = integer(castExpr(), '~');
          e = cast(e, promote(e.ty));
          return span(mk('bitnot', t, e.ty, { lhs: e }), startIdx);
        }
        case '&': {
          pos++;
          const e = castExpr();
          return span(addrOf(e, t), startIdx);
        }
        case '*': {
          pos++;
          const e = castExpr();
          if (e.ty.kind === 'func') return e; // *f is f
          if (e.ty.kind === 'ptr' && e.ty.base!.kind === 'func') return span(mk('deref', t, e.ty.base!, { lhs: e }), startIdx);
          return span(deref(e, t), startIdx);
        }
        case '++':
        case '--': {
          pos++;
          const e = unary();
          return span(incdec(e, t, t.text === '++' ? 1 : -1, true), startIdx);
        }
      }
    }
    if (t.kind === 'keyword' && t.text === 'sizeof') {
      pos++;
      let ty: Type;
      if (is('(') && isTypename(peek(1))) {
        pos++;
        ty = typename();
        expect(')');
        if (is('{')) ty = postfixFrom(compoundLiteral(ty, t), startIdx).ty;
      } else ty = unary().ty;
      if (ty.kind === 'func') throw errorAt(t, 'sizeof cannot be applied to a function');
      if ((ty.kind === 'struct' || ty.kind === 'union') && !ty.complete) throw errorAt(t, `sizeof an incomplete ${typeName(ty)}`);
      if (ty.kind === 'array' && ty.len! < 0) throw errorAt(t, 'sizeof an array of unknown size');
      return span(num(ty.kind === 'void' ? 1 : ty.size, t, T.ulong), startIdx);
    }
    if (t.kind === 'keyword' && (t.text === '_Alignof' || t.text === '__alignof__')) {
      pos++;
      expect('(');
      const ty = isTypename() ? typename() : expr().ty;
      expect(')');
      return span(num(ty.align, t, T.ulong), startIdx);
    }
    if (t.kind === 'keyword' && t.text === '__extension__') {
      pos++;
      return castExpr();
    }
    return postfix();
  };

  const incdec = (e: Node, t: Token, sign: 1 | -1, prefix: boolean): Node => {
    checkAssignable(e, t);
    if (!isScalar(e.ty)) throw errorAt(t, `${t.text} needs a number or a pointer, not ${typeName(e.ty)}`);
    if (prefix) {
      const one = isFloat(e.ty) ? fnum(1, t, e.ty) : num(1, t, e.ty.kind === 'ptr' ? T.int : e.ty);
      return opAssign(sign === 1 ? 'add' : 'sub', e, one, t);
    }
    const delta = e.ty.kind === 'ptr' ? sign * elemSize(e.ty.base!, t) : sign;
    return mk('postinc', t, e.ty, { lhs: e, delta, start: e.start, end: where(t).end });
  };

  const postfix = (): Node => {
    const startIdx = pos;
    // A compound literal can also start a postfix expression: (type){…}.x
    return postfixFrom(primary(), startIdx);
  };

  const postfixFrom = (n: Node, startIdx: number): Node => {
    for (;;) {
      const t = peek();
      if (t.kind !== 'punct') return n;
      if (t.text === '(') {
        pos++;
        n = span(funcall(n, t), startIdx);
        continue;
      }
      if (t.text === '[') {
        pos++;
        const idx = expr();
        expect(']');
        n = span(deref(newAdd(n, idx, t), t), startIdx);
        continue;
      }
      if (t.text === '.') {
        pos++;
        n = span(memberAccess(n, ident('a member name')), startIdx);
        continue;
      }
      if (t.text === '->') {
        pos++;
        const nameTok = ident('a member name');
        n = span(memberAccess(deref(n, t), nameTok), startIdx);
        continue;
      }
      if (t.text === '++' || t.text === '--') {
        pos++;
        n = span(incdec(n, t, t.text === '++' ? 1 : -1, false), startIdx);
        continue;
      }
      return n;
    }
  };

  const funcall = (fnNode: Node, t: Token): Node => {
    let fty: Type;
    if (fnNode.ty.kind === 'func') fty = fnNode.ty;
    else if (fnNode.ty.kind === 'ptr' && fnNode.ty.base!.kind === 'func') fty = fnNode.ty.base!;
    else throw errorAt(fnNode.tok, `${fnNode.kind === 'var' ? fnNode.obj!.name : 'this'} is not a function (it is ${typeName(fnNode.ty)})`);
    const args: Node[] = [];
    while (!take(')')) {
      if (args.length) expect(',', 'between arguments');
      let a = assign();
      const i = args.length;
      if (!fty.noProto && i < fty.params!.length) a = convertForAssign(a, fty.params![i]!, a.tok);
      else {
        if (!fty.noProto && !fty.variadic) throw errorAt(a.tok, `too many arguments: ${callName(fnNode)} takes ${fty.params!.length}`);
        // Default argument promotions.
        a = a.ty.kind === 'struct' || a.ty.kind === 'union' ? a : rvalue(a);
        if (a.ty.kind === 'float') a = cast(a, T.double);
        else if (isInteger(a.ty)) a = cast(a, promote(a.ty));
      }
      args.push(a);
    }
    if (!fty.noProto && args.length < fty.params!.length) throw errorAt(t, `too few arguments: ${callName(fnNode)} takes ${fty.params!.length}${fty.variadic ? ' or more' : ''}, got ${args.length}`);
    if (fty.ret!.kind !== 'void' && (fty.ret!.kind === 'struct' || fty.ret!.kind === 'union') && !fty.ret!.complete) throw errorAt(t, 'calling a function that returns an incomplete type');
    return mk('call', t, fty.ret!, { lhs: fnNode, args, fnTy: fty, start: fnNode.start });
  };
  const callName = (n: Node) => (n.kind === 'var' ? n.obj!.name : 'the function');

  const primary = (): Node => {
    const t = peek();
    const startIdx = pos;
    if (is('(') && is('{', 1)) {
      // GNU statement expression ({ … })
      pos++;
      const body = compoundStmt();
      expect(')');
      const stmts = body.stmts!;
      const last = stmts[stmts.length - 1];
      const ty = last?.kind === 'exprstmt' ? decayIfNeeded(last.lhs!).ty : T.void;
      return span(mk('stmtexpr', t, ty, { stmts }), startIdx);
    }
    if (take('(')) {
      const e = expr();
      expect(')', 'to close (');
      return span({ ...e }, startIdx);
    }
    if (t.kind === 'keyword' && (t.text === '__builtin_va_start' || t.text === '__builtin_va_end' || t.text === '__builtin_va_copy' || t.text === '__builtin_va_arg')) {
      pos++;
      expect('(');
      const ap = assign();
      if (!fn) throw errorAt(t, `${t.text} is only allowed inside a function`);
      if (t.text === '__builtin_va_arg') {
        expect(',');
        const ty = typename();
        expect(')');
        checkAssignable(ap, t);
        return span(mk('vaarg', t, ty, { lhs: ap }), startIdx);
      }
      if (t.text === '__builtin_va_copy') {
        expect(',');
        const src = assign();
        expect(')');
        return span(newAssign(ap, src, t), startIdx);
      }
      if (t.text === '__builtin_va_start') {
        expect(',');
        assign();
        expect(')');
        if (!fn.vaArea) throw errorAt(t, `va_start is only allowed in a function with "..." parameters, and ${fn.name} has none`);
        return span(newAssign(ap, mk('var', t, fn.vaArea.ty, { obj: fn.vaArea }), t), startIdx);
      }
      expect(')');
      return span(mk('cast', t, T.void, { lhs: ap }), startIdx);
    }
    if (t.kind === 'keyword' && t.text === '__builtin_offsetof') {
      pos++;
      expect('(');
      let ty = typename();
      expect(',');
      let off = 0;
      for (;;) {
        const name = ident('a member name');
        const path = findMember(ty, name.text);
        if (!path) throw errorAt(name, `${typeName(ty)} has no member ${name.text}`);
        for (const m of path) off += m.offset;
        ty = path[path.length - 1]!.ty;
        while (take('[')) {
          off += Number(constExpr()) * ty.base!.size;
          ty = ty.base!;
          expect(']');
        }
        if (!take('.')) break;
      }
      expect(')');
      return span(num(off, t, T.ulong), startIdx);
    }
    if (t.kind === 'keyword' && t.text === '_Generic') {
      pos++;
      expect('(');
      const ctrl = rvalue(assign());
      let chosen: Node | undefined;
      let deflt: Node | undefined;
      while (take(',')) {
        if (take('default')) {
          expect(':');
          deflt = assign();
          continue;
        }
        const ty = typename();
        expect(':');
        const e = assign();
        if (!chosen && exactType(ctrl.ty.isConst ? { ...ctrl.ty, isConst: false } : ctrl.ty, ty)) chosen = e;
      }
      expect(')');
      const r = chosen ?? deflt;
      if (!r) throw errorAt(t, `_Generic has no association for ${typeName(ctrl.ty)}`);
      return r;
    }
    if (t.kind === 'ident') {
      pos++;
      // A call to an undeclared function: C89 implicit declaration int f().
      const v = findVar(t.text);
      if (!v) {
        if (is('(')) {
          const ty = funcType(T.int);
          ty.noProto = true;
          const o = declareFunction(t, ty, { isTypedef: false, isStatic: false, isExtern: false, isInline: false });
          return mk('var', t, o.ty, { obj: o });
        }
        throw errorAt(t, `"${t.text}" is not declared`);
      }
      if (v.typedef) throw errorAt(t, `"${t.text}" is a type name, not a value`);
      if (v.enumVal !== undefined) return num(v.enumVal, t, T.int);
      return mk('var', t, v.obj!.ty, { obj: v.obj });
    }
    if (t.kind === 'str') {
      pos++;
      return stringLiteral(t);
    }
    if (t.kind === 'num') {
      pos++;
      const ty = CONST_TYPES[t.ctype!]!;
      if (t.fval !== undefined) return fnum(t.fval, t, ty);
      return num(wrap(t.ival!, ty), t, ty);
    }
    throw errorAt(t, `expected an expression, found ${describe(t)}`);
  };

  // ------------------------------------------------------------ the translation unit

  while (peek().kind !== 'eof') {
    if (is('_Static_assert')) {
      staticAssert();
      continue;
    }
    if (take(';')) continue;
    if (is('asm') || is('__asm__')) throw errorAt(peek(), 'inline assembly is not supported');
    const startIdx = pos;
    const attr: DeclAttr = { isTypedef: false, isStatic: false, isExtern: false, isInline: false };
    const startTok = peek();
    const base = isTypename() ? declspec(attr) : (() => {
      // C89 implicit int: `main() { … }`
      if (peek().kind === 'ident' && is('(', 1)) return T.int;
      throw errorAt(startTok, `expected a declaration, found ${describe(startTok)}`);
    })();
    if (take(';')) continue;
    const d = declarator(base);
    if (attr.isTypedef) {
      let dd = d;
      for (;;) {
        top().vars.set(dd.name!.text, { typedef: dd.ty });
        if (take(';')) break;
        expect(',');
        dd = declarator(base);
      }
      continue;
    }
    if (d.ty.kind === 'func' && (is('{') || (d.ty.oldStyleNames && !is(';') && !is(',')))) {
      functionDefinition(d, attr, startIdx);
      continue;
    }
    globalVariable(base, attr, d);
  }
  void globalsAcross;
  return { file, globals, nodes };
}

// ---------------------------------------------------------------- helpers

declare module './types' {
  interface Type {
    oldStyleNames?: Token[];
    /** A variable-length array's size expression. */
    vla?: Node;
    /** An enum with a negative enumerator (otherwise its bit-fields are unsigned, as in GCC). */
    hasNegative?: boolean;
  }
}

/** Type identity for _Generic: qualifiers of what pointers point to count. */
function exactType(a: Type, b: Type): boolean {
  if (!!a.isConst !== !!b.isConst) return false;
  if (a.kind !== b.kind || a.unsigned !== b.unsigned) return a.kind === 'enum' && b.kind === 'int' ? !b.unsigned : a.kind === 'int' && b.kind === 'enum' ? !a.unsigned : false;
  if (a.kind === 'ptr') return exactType(a.base!, b.base!);
  if (a.kind === 'array') return a.len === b.len && exactType(a.base!, b.base!);
  return sameType(a, b);
}
declare module './ast' {
  interface Obj {
    tentative?: boolean;
  }
}

export const CONST_TYPES: Record<string, Type> = {
  int: T.int,
  unsigned: T.uint,
  long: T.long,
  'unsigned long': T.ulong,
  'long long': T.llong,
  'unsigned long long': T.ullong,
  float: T.float,
  double: T.double,
  'long double': T.ldouble,
  'unsigned short': T.ushort,
};

/** Reduces an integer to the range of `ty`. */
export function wrap(v: bigint, ty: Type): bigint {
  if (ty.kind === 'bool') return v !== 0n ? 1n : 0n;
  if (!isInteger(ty) && ty.kind !== 'ptr') return v;
  const bits = ty.size * 8;
  return ty.unsigned ? BigInt.asUintN(bits, v) : BigInt.asIntN(bits, v);
}

const fround = (ty: Type, v: number) => (ty.kind === 'float' ? Math.fround(v) : v);

function writeScalar(dv: DataView, offset: number, ty: Type, v: CVal) {
  if (ty.kind === 'float') return dv.setFloat32(offset, v.kind === 'float' ? v.v : Number(v.kind === 'int' ? v.v : 0), true);
  if (ty.kind === 'double' || ty.kind === 'ldouble') return dv.setFloat64(offset, v.kind === 'float' ? v.v : Number(v.kind === 'int' ? v.v : 0), true);
  const x = v.kind === 'int' ? v.v : v.kind === 'float' ? BigInt(Math.trunc(v.v)) : BigInt(v.addend);
  writeUnit(dv, offset, ty.size, BigInt.asUintN(ty.size * 8, x));
}
function writeUnit(dv: DataView, offset: number, size: number, x: bigint) {
  if (size === 1) dv.setUint8(offset, Number(x & 0xffn));
  else if (size === 2) dv.setUint16(offset, Number(x & 0xffffn), true);
  else if (size === 4) dv.setUint32(offset, Number(x & 0xffffffffn), true);
  else dv.setBigUint64(offset, BigInt.asUintN(64, x), true);
}
function readUnit(dv: DataView, offset: number, size: number): bigint {
  if (size === 1) return BigInt(dv.getUint8(offset));
  if (size === 2) return BigInt(dv.getUint16(offset, true));
  if (size === 4) return BigInt(dv.getUint32(offset, true));
  return dv.getBigUint64(offset, true);
}
