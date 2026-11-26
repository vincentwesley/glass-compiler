// The typed syntax tree the parser builds and the code generator reads.

import type { Member, Type } from './types';
import type { SourceFile, Token } from './tokenize';

export type NodeKind =
  // expressions
  | 'num'
  | 'var'
  | 'member'
  | 'addr'
  | 'deref'
  | 'neg'
  | 'not'
  | 'bitnot'
  | 'add'
  | 'sub'
  | 'mul'
  | 'div'
  | 'mod'
  | 'band'
  | 'bor'
  | 'bxor'
  | 'shl'
  | 'shr'
  | 'eq'
  | 'ne'
  | 'lt'
  | 'le'
  | 'assign'
  | 'opassign'
  | 'postinc'
  | 'cond'
  | 'comma'
  | 'logand'
  | 'logor'
  | 'cast'
  | 'call'
  | 'stmtexpr'
  | 'memzero'
  | 'vaarg'
  | 'vastart'
  // statements
  | 'return'
  | 'if'
  | 'for'
  | 'do'
  | 'switch'
  | 'case'
  | 'block'
  | 'goto'
  | 'label'
  | 'break'
  | 'continue'
  | 'exprstmt'
  | 'nop';

export interface Node {
  id: number;
  kind: NodeKind;
  tok: Token;
  /** Expression type; `void` for statements. */
  ty: Type;
  /** Source span (UTF-16 offsets in the file the node's first token came from). */
  start: number;
  end: number;
  lhs?: Node;
  rhs?: Node;
  /** opassign: the arithmetic operator, and the type it is computed in. */
  op?: NodeKind;
  opTy?: Type;
  /** postinc: the amount added (negative for --), already scaled for pointers. */
  delta?: number;
  // control flow
  cond?: Node;
  then?: Node;
  els?: Node;
  init?: Node;
  inc?: Node;
  body?: Node;
  stmts?: Node[];
  args?: Node[];
  /** Integer constant (num nodes of integer or pointer type). */
  val?: bigint;
  /** Floating constant. */
  fval?: number;
  obj?: Obj;
  member?: Member;
  /** goto and labels: the label's name. */
  label?: string;
  /** switch: its case and default statements; whether every case sits directly in its body. */
  cases?: Node[];
  deflt?: Node;
  regular?: boolean;
  /** case: the value (and GNU range end). */
  caseVal?: bigint;
  /** call: the called function's type. */
  fnTy?: Type;
  /** cast to void etc.: an implicit conversion (not written in the source). */
  implicit?: boolean;
}

export interface Reloc {
  offset: number;
  target: Obj;
  addend: number;
}

export interface Obj {
  id: number;
  name: string;
  ty: Type;
  tok: Token;
  file: SourceFile;
  isLocal: boolean;
  isFunction: boolean;
  isStatic: boolean;
  isDefinition: boolean;
  isParam?: boolean;
  /** A local whose address is taken (or an aggregate): it lives in the stack frame, not a Wasm local. */
  inMemory?: boolean;
  // Globals:
  data?: Uint8Array;
  relocs?: Reloc[];
  /** String literal or compound literal at file scope. */
  anonymous?: boolean;
  /** A string literal: its text (for the page). */
  literal?: string;
  // Functions:
  params?: Obj[];
  locals?: Obj[];
  body?: Node;
  /** The variadic area pointer parameter. */
  vaArea?: Obj;
  /** Contains goto or a case label below the top of its switch: compiled as a block dispatcher. */
  needsDispatch?: boolean;
  labels?: Set<string>;
  isInline?: boolean;
  /** The function's source span, for the page. */
  start?: number;
  end?: number;
}

export interface TranslationUnit {
  file: SourceFile;
  globals: Obj[];
  /** Every node the parser made, by id (for the page). */
  nodes: Node[];
}
