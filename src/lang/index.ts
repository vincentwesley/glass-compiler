import type { Program, Node } from './ast';
import type { CompiledProgram } from './bytecode';
import { compile } from './compiler';
import type { Diagnostic } from './errors';
import { lex } from './lexer';
import { parse } from './parser';
import type { Token } from './token';
import { run, type Trace } from './vm';

export * from './ast';
export * from './bytecode';
export * from './errors';
export * from './token';
export { lex } from './lexer';
export { parse, OPERATOR_TABLE, MAX_TREE_DEPTH } from './parser';
export { compile } from './compiler';
export { run, MAX_STEPS, MAX_FRAMES, isTruthy } from './vm';
export type { Trace, Snapshot, FrameSnapshot, OutputLine } from './vm';

/** Everything the UI needs: every stage's output plus all problems found. */
export interface Build {
  source: string;
  tokens: Token[];
  program: Program;
  nodes: Map<number, Node>;
  tokenOwner: number[];
  compiled: CompiledProgram;
  /** Present only when there were no compile-time errors. */
  trace: Trace | null;
  /** Lexer, parser and compiler problems (runtime errors live on the trace). */
  diagnostics: Diagnostic[];
}

/** Run source text through every stage. Never throws. */
export function build(source: string): Build {
  try {
    return buildStages(source);
  } catch (e) {
    // Every stage reports problems as diagnostics, so this is only a last line
    // of defence (for example a stack overflow on pathological input).
    const message = e instanceof RangeError ? 'This program is too large or too deeply nested to compile.' : 'The compiler hit an internal error on this program.';
    const empty: Program = { id: 0, type: 'Program', body: [], span: { start: 0, end: source.length } };
    return {
      source,
      tokens: [{ index: 0, kind: 'EOF', lexeme: '', span: { start: source.length, end: source.length } }],
      program: empty,
      nodes: new Map([[0, empty]]),
      tokenOwner: [-1],
      compiled: { chunks: [{ index: 0, name: 'main', nodeId: 0, arity: 0, params: [], code: [], constants: [], locals: [] }] },
      trace: null,
      diagnostics: [{ stage: 'compiler', message, span: { start: 0, end: Math.min(source.length, 1) } }],
    };
  }
}

function buildStages(source: string): Build {
  const lexed = lex(source);
  const parsed = parse(lexed.tokens);
  const compiled = compile(parsed.program);
  const diagnostics = [...lexed.errors, ...parsed.errors, ...compiled.errors].sort((a, b) => a.span.start - b.span.start);
  const trace = diagnostics.length === 0 ? run(compiled.program) : null;
  return {
    source,
    tokens: lexed.tokens,
    program: parsed.program,
    nodes: parsed.nodes,
    tokenOwner: parsed.tokenOwner,
    compiled: compiled.program,
    trace,
    diagnostics,
  };
}
