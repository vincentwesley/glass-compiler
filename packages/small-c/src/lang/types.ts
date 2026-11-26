// C types for the wasm32 target, ILP32 like clang's wasm32: char 1, short 2,
// int 4, long 4, long long 8, pointers 4, float 4, double 8. long double is a
// plain double here (DECISIONS S18). char is signed.

import type { Token } from './tokenize';

export type TypeKind =
  | 'void'
  | 'bool'
  | 'char'
  | 'short'
  | 'int'
  | 'long'
  | 'llong'
  | 'float'
  | 'double'
  | 'ldouble'
  | 'enum'
  | 'ptr'
  | 'array'
  | 'func'
  | 'struct'
  | 'union';

export interface Member {
  name?: Token;
  ty: Type;
  offset: number;
  /** Bit-fields: width in bits and position within the storage unit at `offset`. */
  bitWidth?: number;
  bitOffset?: number;
}

export interface Type {
  kind: TypeKind;
  size: number;
  align: number;
  unsigned: boolean;
  /** Element type of a pointer or array. */
  base?: Type;
  /** Array length; -1 for an incomplete array (`int a[]`). */
  len?: number;
  // Functions:
  ret?: Type;
  params?: Type[];
  paramNames?: (Token | undefined)[];
  variadic?: boolean;
  /** Declared with `()`: no prototype, arguments take the default promotions. */
  noProto?: boolean;
  // Structs and unions (shared object: completing it completes every use):
  members?: Member[];
  complete?: boolean;
  flexible?: boolean;
  tag?: string;
  isConst?: boolean;
}

const prim = (kind: TypeKind, size: number, unsigned = false): Type => ({ kind, size, align: size || 1, unsigned });

export const T = {
  void: prim('void', 1),
  bool: prim('bool', 1, true),
  char: prim('char', 1),
  uchar: prim('char', 1, true),
  short: prim('short', 2),
  ushort: prim('short', 2, true),
  int: prim('int', 4),
  uint: prim('int', 4, true),
  long: prim('long', 4),
  ulong: prim('long', 4, true),
  llong: prim('llong', 8),
  ullong: prim('llong', 8, true),
  float: prim('float', 4),
  double: prim('double', 8),
  ldouble: prim('ldouble', 8),
};

export const isInteger = (t: Type) => ['bool', 'char', 'short', 'int', 'long', 'llong', 'enum'].includes(t.kind);
export const isFloat = (t: Type) => t.kind === 'float' || t.kind === 'double' || t.kind === 'ldouble';
export const isNumeric = (t: Type) => isInteger(t) || isFloat(t);
export const isPointerLike = (t: Type) => t.kind === 'ptr' || t.kind === 'array';
export const isScalar = (t: Type) => isNumeric(t) || t.kind === 'ptr';
export const isAggregate = (t: Type) => t.kind === 'struct' || t.kind === 'union' || t.kind === 'array';

export const pointerTo = (base: Type): Type => ({ kind: 'ptr', size: 4, align: 4, unsigned: true, base });
export const arrayOf = (base: Type, len: number): Type => ({ kind: 'array', size: len < 0 ? 0 : base.size * len, align: base.align, unsigned: false, base, len });
export const funcType = (ret: Type): Type => ({ kind: 'func', size: 1, align: 1, unsigned: false, ret, params: [], paramNames: [] });
export const enumType = (): Type => ({ kind: 'enum', size: 4, align: 4, unsigned: false });
export const structType = (kind: 'struct' | 'union', tag?: string): Type => ({ kind, size: 0, align: 1, unsigned: false, members: [], complete: false, tag });

export const withConst = (t: Type): Type => (t.kind === 'struct' || t.kind === 'union' ? t : { ...t, isConst: true });

/** The WebAssembly value type a scalar of this C type lives in. */
export function wasmType(t: Type): 'i32' | 'i64' | 'f32' | 'f64' {
  if (t.kind === 'llong') return 'i64';
  if (t.kind === 'float') return 'f32';
  if (t.kind === 'double' || t.kind === 'ldouble') return 'f64';
  return 'i32'; // everything else, including addresses of aggregates and function table indexes
}

const RANK: Partial<Record<TypeKind, number>> = { bool: 0, char: 1, short: 2, int: 3, enum: 3, long: 4, llong: 5 };

/** Integer promotions (C11 6.3.1.1): anything narrower than int becomes int. */
export function promote(t: Type): Type {
  if (isInteger(t) && (RANK[t.kind] ?? 3) < 3) return T.int;
  if (t.kind === 'enum') return T.int;
  return t;
}

/** The usual arithmetic conversions (C11 6.3.1.8). */
export function commonType(a: Type, b: Type): Type {
  if (a.kind === 'ldouble' || b.kind === 'ldouble') return T.ldouble;
  if (a.kind === 'double' || b.kind === 'double') return T.double;
  if (a.kind === 'float' || b.kind === 'float') return T.float;
  a = promote(a);
  b = promote(b);
  if (a.unsigned === b.unsigned) return RANK[a.kind]! >= RANK[b.kind]! ? a : b;
  const [u, s] = a.unsigned ? [a, b] : [b, a];
  if (RANK[u.kind]! >= RANK[s.kind]!) return u;
  if (s.size > u.size) return s;
  return unsignedOf(s);
}

export function unsignedOf(t: Type): Type {
  switch (t.kind) {
    case 'char':
      return T.uchar;
    case 'short':
      return T.ushort;
    case 'int':
    case 'enum':
      return T.uint;
    case 'long':
      return T.ulong;
    case 'llong':
      return T.ullong;
    default:
      return t;
  }
}

/** Types the same for assignment and redeclaration purposes (qualifiers ignored). */
export function sameType(a: Type, b: Type): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'ptr':
      return sameType(a.base!, b.base!);
    case 'array':
      return sameType(a.base!, b.base!) && (a.len === b.len || a.len! < 0 || b.len! < 0);
    case 'func':
      return sameType(a.ret!, b.ret!) && (!!a.noProto || !!b.noProto || (a.params!.length === b.params!.length && a.params!.every((p, i) => sameType(p, b.params![i]!))));
    case 'struct':
    case 'union':
      return a === b;
    default:
      return a.unsigned === b.unsigned && a.size === b.size;
  }
}

/** How the page and error messages spell a type. */
export function typeName(t: Type): string {
  const c = t.isConst ? 'const ' : '';
  switch (t.kind) {
    case 'void':
      return c + 'void';
    case 'bool':
      return c + '_Bool';
    case 'char':
      return c + (t.unsigned ? 'unsigned char' : 'char');
    case 'short':
      return c + (t.unsigned ? 'unsigned short' : 'short');
    case 'int':
      return c + (t.unsigned ? 'unsigned int' : 'int');
    case 'long':
      return c + (t.unsigned ? 'unsigned long' : 'long');
    case 'llong':
      return c + (t.unsigned ? 'unsigned long long' : 'long long');
    case 'float':
      return c + 'float';
    case 'double':
      return c + 'double';
    case 'ldouble':
      return c + 'long double';
    case 'enum':
      return c + 'enum';
    case 'struct':
    case 'union':
      return `${c}${t.kind} ${t.tag ?? '(anonymous)'}`;
    case 'ptr':
      return t.base!.kind === 'func' ? `${typeName(t.base!.ret!)} (*)(${funcParams(t.base!)})` : `${typeName(t.base!)} *`;
    case 'array':
      return `${typeName(t.base!)} [${t.len! < 0 ? '' : t.len}]`;
    case 'func':
      return `${typeName(t.ret!)} (${funcParams(t)})`;
  }
}

const funcParams = (t: Type) => (t.noProto ? '' : t.params!.length === 0 && !t.variadic ? 'void' : [...t.params!.map(typeName), ...(t.variadic ? ['...'] : [])].join(', '));

export const alignTo = (n: number, a: number) => Math.ceil(n / a) * a;
