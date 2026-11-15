import type { Diagnostic } from './errors';
import { KEYWORDS, type Token, type TokenKind } from './token';

export interface LexResult {
  tokens: Token[];
  errors: Diagnostic[];
}

const SINGLE: Readonly<Record<string, TokenKind>> = {
  '(': 'LPAREN',
  ')': 'RPAREN',
  '{': 'LBRACE',
  '}': 'RBRACE',
  ',': 'COMMA',
  ';': 'SEMI',
  '+': 'PLUS',
  '-': 'MINUS',
  '*': 'STAR',
  '/': 'SLASH',
  '%': 'PERCENT',
};

const isDigit = (c: string) => c >= '0' && c <= '9';
const isAlpha = (c: string) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';

/**
 * Turn source text into tokens. Whitespace and `#` comments are skipped.
 * The lexer never throws: unknown characters become diagnostics and scanning
 * carries on, so later stages still get as much as possible to work with.
 */
export function lex(source: string): LexResult {
  const tokens: Token[] = [];
  const errors: Diagnostic[] = [];
  let pos = 0;

  const push = (kind: TokenKind, start: number, value?: number | string) => {
    const token: Token = { index: tokens.length, kind, lexeme: source.slice(start, pos), span: { start, end: pos } };
    if (value !== undefined) token.value = value;
    tokens.push(token);
  };

  while (pos < source.length) {
    const start = pos;
    const c = source[pos]!;

    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
      pos++;
      continue;
    }
    if (c === '#') {
      while (pos < source.length && source[pos] !== '\n') pos++;
      continue;
    }

    if (isDigit(c)) {
      while (pos < source.length && isDigit(source[pos]!)) pos++;
      if (source[pos] === '.' && pos + 1 < source.length && isDigit(source[pos + 1]!)) {
        pos++;
        while (pos < source.length && isDigit(source[pos]!)) pos++;
      }
      push('NUMBER', start, Number(source.slice(start, pos)));
      continue;
    }

    if (isAlpha(c)) {
      while (pos < source.length && (isAlpha(source[pos]!) || isDigit(source[pos]!))) pos++;
      const word = source.slice(start, pos);
      push(Object.hasOwn(KEYWORDS, word) ? KEYWORDS[word]! : 'IDENT', start);
      continue;
    }

    if (c === '"') {
      pos++;
      let value = '';
      let closed = false;
      while (pos < source.length) {
        const ch = source[pos]!;
        if (ch === '"') {
          pos++;
          closed = true;
          break;
        }
        if (ch === '\n') break;
        if (ch === '\\' && pos + 1 < source.length) {
          const esc = source[pos + 1]!;
          const mapped = esc === 'n' ? '\n' : esc === 't' ? '\t' : esc === '"' ? '"' : esc === '\\' ? '\\' : undefined;
          if (mapped === undefined) {
            errors.push({ stage: 'lexer', message: `Unknown escape "\\${esc}" in string.`, span: { start: pos, end: pos + 2 } });
            value += esc;
          } else {
            value += mapped;
          }
          pos += 2;
          continue;
        }
        value += ch;
        pos++;
      }
      if (!closed) {
        errors.push({ stage: 'lexer', message: 'This string is never closed with a ".', span: { start, end: pos } });
      }
      push('STRING', start, value);
      continue;
    }

    const next = source[pos + 1];
    if (c === '=' || c === '!' || c === '<' || c === '>') {
      if (next === '=') {
        pos += 2;
        push(c === '=' ? 'EQ_EQ' : c === '!' ? 'BANG_EQ' : c === '<' ? 'LT_EQ' : 'GT_EQ', start);
        continue;
      }
      if (c === '!') {
        pos++;
        errors.push({ stage: 'lexer', message: 'Pane uses "not" instead of "!" (and "!=" for not-equal).', span: { start, end: pos } });
        continue;
      }
      pos++;
      push(c === '=' ? 'EQ' : c === '<' ? 'LT' : 'GT', start);
      continue;
    }

    if (Object.hasOwn(SINGLE, c)) {
      pos++;
      push(SINGLE[c]!, start);
      continue;
    }

    // Unknown character: report it, skip it (whole code point) and keep going.
    const cp = source.codePointAt(pos)!;
    pos += cp > 0xffff ? 2 : 1;
    errors.push({ stage: 'lexer', message: `Unexpected character "${source.slice(start, pos)}".`, span: { start, end: pos } });
  }

  tokens.push({ index: tokens.length, kind: 'EOF', lexeme: '', span: { start: source.length, end: source.length } });
  return { tokens, errors };
}
