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
export { parse, OPERATOR_TABLE } from './parser';
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
