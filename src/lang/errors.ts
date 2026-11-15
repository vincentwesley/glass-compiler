import type { Span } from './token';

export type Stage = 'lexer' | 'parser' | 'compiler' | 'vm';

/** A problem found in the program, pointing at the source it came from. */
export interface Diagnostic {
  stage: Stage;
  message: string;
  span: Span;
  /** The syntax-tree node involved, when there is one. */
  nodeId?: number;
}

/** Convert a character offset to a 1-based line and column. */
export function lineCol(source: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  const end = Math.min(offset, source.length);
  for (let i = 0; i < end; i++) {
    if (source[i] === '\n') {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}
