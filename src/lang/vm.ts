import { formatValue, type CompiledProgram, type FunctionValue, type Instr, type Value } from './bytecode';
import type { Diagnostic } from './errors';

export const MAX_STEPS = 10_000;
export const MAX_FRAMES = 64;

export interface LocalSnapshot {
  name: string;
  slot: number;
  value: Value;
}

export interface FrameSnapshot {
  chunk: number;
  name: string;
  /** Next instruction this frame will run (for callers: where it resumes). */
  ip: number;
  /** Stack index of slot 0. */
  base: number;
  locals: LocalSnapshot[];
}

/** The machine state just before an instruction runs (or after the program ends, when `at` is null). */
export interface Snapshot {
  at: { chunk: number; ip: number } | null;
  stack: Value[];
  frames: FrameSnapshot[];
  globals: [string, Value][];
  /** How many output lines exist at this moment. */
  outputLength: number;
}

export interface OutputLine {
  text: string;
  /** The step whose PRINT produced this line. */
  step: number;
}

export interface Trace {
  /** snapshots[i] is the state before step i; the last one is the final state. */
  snapshots: Snapshot[];
  output: OutputLine[];
  status: 'finished' | 'error' | 'step-limit';
  error?: Diagnostic & { step: number };
}

interface Frame {
  fn: { chunk: number; name: string };
  ip: number;
  base: number;
}

class RuntimeError extends Error {}

const typeName = (v: Value): string => {
  if (v === null) return 'nil';
  if (typeof v === 'object') return 'a function';
  if (typeof v === 'string') return 'a string';
  if (typeof v === 'number') return 'a number';
  return 'a boolean';
};
const describe = (v: Value) => (typeof v === 'object' && v !== null ? `<fn ${v.name}>` : `${typeName(v)} (${formatValue(v, true)})`);
export const isTruthy = (v: Value) => v !== null && v !== false;

const equal = (a: Value, b: Value): boolean => {
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) return a.chunk === b.chunk;
  return a === b;
};

/** Run a compiled program to completion, recording a snapshot before every instruction. */
export function run(program: CompiledProgram, maxSteps = MAX_STEPS): Trace {
  const stack: Value[] = [];
  const globals = new Map<string, Value>();
  const output: OutputLine[] = [];
  const frames: Frame[] = [{ fn: { chunk: 0, name: 'main' }, ip: 0, base: 0 }];
  const snapshots: Snapshot[] = [];

  const snapshot = (at: Snapshot['at']): Snapshot => ({
    at,
    stack: stack.slice(),
    frames: frames.map((f) => {
      const chunk = program.chunks[f.fn.chunk]!;
      const locals = chunk.locals
        .filter((l) => l.from <= f.ip && f.ip <= l.to && f.base + l.slot < stack.length)
        .map((l) => ({ name: l.name, slot: l.slot, value: stack[f.base + l.slot]! }));
      return { chunk: f.fn.chunk, name: f.fn.name, ip: f.ip, base: f.base, locals };
    }),
    globals: [...globals.entries()],
    outputLength: output.length,
  });

  const pop = (): Value => stack.pop()!;
  const peek = (): Value => stack[stack.length - 1]!;

  let instr: Instr | undefined;
  const fail = (message: string): never => {
    throw new RuntimeError(message);
  };
  const numbers = (verb: string): [number, number] => {
    const b = pop();
    const a = pop();
    if (typeof a !== 'number' || typeof b !== 'number') {
      fail(`Can't ${verb} ${describe(a)} and ${describe(b)}: both must be numbers.`);
    }
    return [a as number, b as number];
  };
  const compare = (test: (a: number | string, b: number | string) => boolean, symbol: string) => {
    const b = pop();
    const a = pop();
    if ((typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string')) {
      stack.push(test(a, b));
    } else {
      fail(`Can't compare ${describe(a)} ${symbol} ${describe(b)}: both must be numbers or both strings.`);
    }
  };

  let status: Trace['status'] = 'finished';
  let error: Trace['error'];

  for (;;) {
    const frame = frames[frames.length - 1]!;
    const chunk = program.chunks[frame.fn.chunk]!;
    instr = chunk.code[frame.ip];
    if (!instr) {
      // Defensive: compiled code always ends in HALT or RETURN.
      break;
    }
    if (snapshots.length >= maxSteps) {
      status = 'step-limit';
      error = {
        stage: 'vm',
        message: `Stopped after ${maxSteps.toLocaleString('en')} steps. Is there a loop that never ends?`,
        span: instr.span,
        nodeId: instr.nodeId,
        step: snapshots.length,
      };
      break;
    }
    snapshots.push(snapshot({ chunk: frame.fn.chunk, ip: frame.ip }));
    frame.ip++;

    try {
      const arg = instr.arg;
      switch (instr.op) {
        case 'CONST':
          stack.push(chunk.constants[arg as number]!);
          break;
        case 'NIL':
          stack.push(null);
          break;
        case 'TRUE':
          stack.push(true);
          break;
        case 'FALSE':
          stack.push(false);
          break;
        case 'POP':
          pop();
          break;
        case 'DUP':
          stack.push(peek());
          break;
        case 'GET_LOCAL':
          stack.push(stack[frame.base + (arg as number)]!);
          break;
        case 'SET_LOCAL':
          stack[frame.base + (arg as number)] = peek();
          break;
        case 'GET_GLOBAL': {
          const name = arg as string;
          if (!globals.has(name)) fail(`"${name}" has not been defined. Declare it first with "let ${name} = ...;".`);
          stack.push(globals.get(name)!);
          break;
        }
        case 'SET_GLOBAL': {
          const name = arg as string;
          if (!globals.has(name)) fail(`Can't assign to "${name}": it has not been declared. Use "let ${name} = ...;" first.`);
          globals.set(name, peek());
          break;
        }
        case 'DEF_GLOBAL':
          globals.set(arg as string, pop());
          break;
        case 'ADD': {
          const b = pop();
          const a = pop();
          if (typeof a === 'number' && typeof b === 'number') stack.push(a + b);
          else if (typeof a === 'string' || typeof b === 'string') stack.push(formatValue(a) + formatValue(b));
          else fail(`Can't add ${describe(a)} and ${describe(b)}.`);
          break;
        }
        case 'SUB': {
          const [a, b] = numbers('subtract');
          stack.push(a - b);
          break;
        }
        case 'MUL': {
          const [a, b] = numbers('multiply');
          stack.push(a * b);
          break;
        }
        case 'DIV': {
          const [a, b] = numbers('divide');
          if (b === 0) fail('Division by zero.');
          stack.push(a / b);
          break;
        }
        case 'MOD': {
          const [a, b] = numbers('take the remainder of');
          if (b === 0) fail('Remainder of division by zero.');
          stack.push(a % b);
          break;
        }
        case 'NEG': {
          const v = pop();
          if (typeof v !== 'number') fail(`Can't negate ${describe(v)}: it must be a number.`);
          stack.push(-(v as number));
          break;
        }
        case 'NOT':
          stack.push(!isTruthy(pop()));
          break;
        case 'EQ': {
          const b = pop();
          stack.push(equal(pop(), b));
          break;
        }
        case 'NE': {
          const b = pop();
          stack.push(!equal(pop(), b));
          break;
        }
        case 'LT':
          compare((a, b) => a < b, '<');
          break;
        case 'LE':
          compare((a, b) => a <= b, '<=');
          break;
        case 'GT':
          compare((a, b) => a > b, '>');
          break;
        case 'GE':
          compare((a, b) => a >= b, '>=');
          break;
        case 'PRINT':
          output.push({ text: formatValue(pop()), step: snapshots.length - 1 });
          break;
        case 'JUMP':
        case 'LOOP':
          frame.ip = arg as number;
          break;
        case 'JUMP_IF_FALSE':
          if (!isTruthy(pop())) frame.ip = arg as number;
          break;
        case 'JUMP_IF_TRUE':
          if (isTruthy(pop())) frame.ip = arg as number;
          break;
        case 'CALL': {
          const argc = arg as number;
          const callee = stack[stack.length - 1 - argc]!;
          if (typeof callee !== 'object' || callee === null) {
            fail(`Can't call ${describe(callee)}: only functions can be called.`);
          }
          const fn = callee as FunctionValue;
          if (fn.arity !== argc) {
            fail(`${fn.name}() expects ${fn.arity} argument${fn.arity === 1 ? '' : 's'} but got ${argc}.`);
          }
          if (frames.length >= MAX_FRAMES) fail(`Too many nested calls (more than ${MAX_FRAMES}). Does a function call itself forever?`);
          frames.push({ fn: { chunk: fn.chunk, name: fn.name }, ip: 0, base: stack.length - argc });
          break;
        }
        case 'RETURN': {
          const result = pop();
          frames.pop();
          // Drop the arguments, locals and the function value itself.
          stack.length = frame.base - 1;
          stack.push(result);
          break;
        }
        case 'HALT':
          snapshots.push(snapshot(null));
          return { snapshots, output, status };
      }
    } catch (e) {
      if (!(e instanceof RuntimeError)) throw e;
      status = 'error';
      error = { stage: 'vm', message: e.message, span: instr.span, nodeId: instr.nodeId, step: snapshots.length - 1 };
      frame.ip--;
      // Show the machine as it was just before the failing instruction.
      snapshots.push({ ...snapshots[snapshots.length - 1]!, at: null });
      return { snapshots, output, status, error };
    }
  }

  snapshots.push(snapshot(null));
  const trace: Trace = { snapshots, output, status };
  if (error) trace.error = error;
  return trace;
}
