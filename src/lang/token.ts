/** A half-open range of character offsets into the source: [start, end). */
export interface Span {
  start: number;
  end: number;
}

export type TokenKind =
  // literals and names
  | 'NUMBER'
  | 'STRING'
  | 'IDENT'
  // keywords
  | 'LET'
  | 'FN'
  | 'RETURN'
  | 'IF'
  | 'ELSE'
  | 'WHILE'
  | 'PRINT'
  | 'TRUE'
  | 'FALSE'
  | 'NIL'
  | 'AND'
  | 'OR'
  | 'NOT'
  // punctuation
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACE'
  | 'RBRACE'
  | 'COMMA'
  | 'SEMI'
  // operators
  | 'PLUS'
  | 'MINUS'
  | 'STAR'
  | 'SLASH'
  | 'PERCENT'
  | 'EQ'
  | 'EQ_EQ'
  | 'BANG_EQ'
  | 'LT'
  | 'LT_EQ'
  | 'GT'
  | 'GT_EQ'
  | 'EOF';

export interface Token {
  /** Position in the token list. */
  index: number;
  kind: TokenKind;
  /** The exact source text of the token. */
  lexeme: string;
  span: Span;
  /** Parsed value for NUMBER and STRING tokens. */
  value?: number | string;
}

export const KEYWORDS: Readonly<Record<string, TokenKind>> = {
  let: 'LET',
  fn: 'FN',
  return: 'RETURN',
  if: 'IF',
  else: 'ELSE',
  while: 'WHILE',
  print: 'PRINT',
  true: 'TRUE',
  false: 'FALSE',
  nil: 'NIL',
  and: 'AND',
  or: 'OR',
  not: 'NOT',
};

/** Broad groups used for colouring tokens consistently in every panel. */
export type TokenCategory = 'keyword' | 'literal' | 'string' | 'name' | 'operator' | 'punct' | 'eof';

export function tokenCategory(kind: TokenKind): TokenCategory {
  switch (kind) {
    case 'NUMBER':
    case 'TRUE':
    case 'FALSE':
    case 'NIL':
      return 'literal';
    case 'STRING':
      return 'string';
    case 'IDENT':
      return 'name';
    case 'LET':
    case 'FN':
    case 'RETURN':
    case 'IF':
    case 'ELSE':
    case 'WHILE':
    case 'PRINT':
    case 'AND':
    case 'OR':
    case 'NOT':
      return 'keyword';
    case 'LPAREN':
    case 'RPAREN':
    case 'LBRACE':
    case 'RBRACE':
    case 'COMMA':
    case 'SEMI':
      return 'punct';
    case 'EOF':
      return 'eof';
    default:
      return 'operator';
  }
}
