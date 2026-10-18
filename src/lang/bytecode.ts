import type { Span } from './token';

export type Op =
  | 'CONST'
  | 'NIL'
  | 'TRUE'
  | 'FALSE'
  | 'POP'
  | 'DUP'
  | 'GET_LOCAL'
  | 'SET_LOCAL'
  | 'GET_GLOBAL'
  | 'SET_GLOBAL'
  | 'DEF_GLOBAL'
  | 'ADD'
  | 'SUB'
  | 'MUL'
  | 'DIV'
  | 'MOD'
  | 'NEG'
  | 'NOT'
  | 'EQ'
  | 'NE'
  | 'LT'
  | 'LE'
  | 'GT'
  | 'GE'
  | 'PRINT'
  | 'JUMP'
  | 'JUMP_IF_FALSE'
  | 'JUMP_IF_TRUE'
  | 'LOOP'
  | 'CALL'
  | 'RETURN'
  | 'HALT';

/** A plain-English description of each opcode, shown in the bytecode panel. */
export const OP_HELP: Readonly<Record<Op, string>> = {
  CONST: 'Push a constant from the constant pool.',
  NIL: 'Push nil.',
  TRUE: 'Push true.',
  FALSE: 'Push false.',
  POP: 'Throw away the value on top of the stack.',
  DUP: 'Push a copy of the top value.',
  GET_LOCAL: 'Push the local variable in this stack slot.',
  SET_LOCAL: 'Store the top value into a local slot (the value stays on the stack).',
  GET_GLOBAL: 'Push the value of a global variable.',
  SET_GLOBAL: 'Store the top value into an existing global (the value stays on the stack).',
  DEF_GLOBAL: 'Pop a value and create a global variable with it.',
  ADD: 'Pop two values, push their sum (or joined string).',
  SUB: 'Pop two numbers, push left − right.',
  MUL: 'Pop two numbers, push their product.',
  DIV: 'Pop two numbers, push left ÷ right.',
  MOD: 'Pop two numbers, push the remainder of left ÷ right.',
  NEG: 'Pop a number, push it negated.',
  NOT: 'Pop a value, push true if it was false or nil.',
  EQ: 'Pop two values, push whether they are equal.',
  NE: 'Pop two values, push whether they differ.',
  LT: 'Pop two values, push left < right.',
  LE: 'Pop two values, push left ≤ right.',
  GT: 'Pop two values, push left > right.',
  GE: 'Pop two values, push left ≥ right.',
  PRINT: 'Pop a value and print it.',
  JUMP: 'Continue at another address.',
  JUMP_IF_FALSE: 'Pop a value; jump if it is false or nil.',
  JUMP_IF_TRUE: 'Pop a value; jump unless it is false or nil.',
  LOOP: 'Jump back to the start of a loop.',
  CALL: 'Call the function sitting below its arguments.',
  RETURN: 'Pop the result, drop this call frame and push the result for the caller.',
  HALT: 'Stop the program.',
};

export interface Instr {
  op: Op;
  /** Constant index, local slot, global name, jump target address or argument count. */
  arg?: number | string;
  /** The syntax-tree node that produced this instruction. */
  nodeId: number;
  span: Span;
}

export interface FunctionValue {
  kind: 'function';
  name: string;
  arity: number;
  chunk: number;
}

export type Value = number | string | boolean | null | FunctionValue;

export interface LocalInfo {
  name: string;
  slot: number;
  /** First address where the local holds its value. */
  from: number;
  /** Address after which the local no longer exists. */
  to: number;
}

export interface Chunk {
  index: number;
  name: string;
  /** The Fn node this chunk was compiled from, or the Program node for main. */
  nodeId: number;
  arity: number;
  params: string[];
  code: Instr[];
  constants: Value[];
  locals: LocalInfo[];
}

export interface CompiledProgram {
  chunks: Chunk[];
}

/** A short id for an instruction, unique across all chunks. */
export const instrKey = (chunk: number, addr: number) => `${chunk}:${addr}`;

export function formatValue(v: Value, quoteStrings = false): string {
  if (v === null) return 'nil';
  if (typeof v === 'string') return quoteStrings ? JSON.stringify(v) : v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(12)));
  if (typeof v === 'boolean') return String(v);
  return `<fn ${v.name}>`;
}

/** The operand rendered for humans, e.g. `0 (42)` for a constant or `→ 12` for a jump. */
export function formatOperand(chunk: Chunk, instr: Instr, addr: number): string {
  if (instr.arg === undefined) return '';
  switch (instr.op) {
    case 'CONST':
      return formatValue(chunk.constants[instr.arg as number] ?? null, true);
    case 'JUMP':
    case 'JUMP_IF_FALSE':
    case 'JUMP_IF_TRUE':
    case 'LOOP':
      return `→ ${String(instr.arg).padStart(2, '0')}`;
    case 'GET_LOCAL':
    case 'SET_LOCAL': {
      const local = chunk.locals.find((l) => l.slot === instr.arg && l.from <= addr && addr <= l.to);
      return local ? `[${instr.arg}] ${local.name}` : `[${instr.arg}]`;
    }
    case 'CALL':
      return `${instr.arg} arg${instr.arg === 1 ? '' : 's'}`;
    default:
      return String(instr.arg);
  }
}
