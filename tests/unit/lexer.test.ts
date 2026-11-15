import { describe, expect, it } from 'vitest';
import { lex } from '../../src/lang/lexer';
import { tokenCategory, type TokenKind } from '../../src/lang/token';

const kinds = (src: string) => lex(src).tokens.map((t) => t.kind);

describe('lexer', () => {
  it('ends every token list with EOF at the end of the source', () => {
    const { tokens } = lex('');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({ kind: 'EOF', span: { start: 0, end: 0 } });
    expect(lex('  1 ').tokens.at(-1)!.span).toEqual({ start: 4, end: 4 });
  });

  it('recognises every keyword', () => {
    const src = 'let fn return if else while print true false nil and or not';
    expect(kinds(src)).toEqual<TokenKind[]>([
      'LET', 'FN', 'RETURN', 'IF', 'ELSE', 'WHILE', 'PRINT', 'TRUE', 'FALSE', 'NIL', 'AND', 'OR', 'NOT', 'EOF',
    ]);
  });

  it('treats keyword prefixes and suffixes as identifiers', () => {
    expect(kinds('lets iffy _print fn2 Let')).toEqual(['IDENT', 'IDENT', 'IDENT', 'IDENT', 'IDENT', 'EOF']);
  });

  it('does not treat Object.prototype names as keywords', () => {
    expect(kinds('constructor toString __proto__')).toEqual(['IDENT', 'IDENT', 'IDENT', 'EOF']);
  });

  it('recognises every operator and punctuation mark', () => {
    expect(kinds('( ) { } , ; + - * / % = == != < <= > >=')).toEqual<TokenKind[]>([
      'LPAREN', 'RPAREN', 'LBRACE', 'RBRACE', 'COMMA', 'SEMI', 'PLUS', 'MINUS', 'STAR', 'SLASH', 'PERCENT',
      'EQ', 'EQ_EQ', 'BANG_EQ', 'LT', 'LT_EQ', 'GT', 'GT_EQ', 'EOF',
    ]);
  });

  it('prefers the longest operator', () => {
    expect(kinds('a<=b==c')).toEqual(['IDENT', 'LT_EQ', 'IDENT', 'EQ_EQ', 'IDENT', 'EOF']);
    expect(kinds('a = = b')).toEqual(['IDENT', 'EQ', 'EQ', 'IDENT', 'EOF']);
  });

  it('reads integers and decimals with their values', () => {
    const { tokens } = lex('0 42 3.25 7.');
    expect(tokens.slice(0, 3).map((t) => t.value)).toEqual([0, 42, 3.25]);
    // "7." is the number 7 followed by an unexpected "."
    expect(tokens[3]).toMatchObject({ kind: 'NUMBER', value: 7, lexeme: '7' });
    expect(lex('7.').errors[0]!.message).toContain('Unexpected character ".".');
  });

  it('reads strings with escapes', () => {
    const { tokens, errors } = lex('"hi" "a\\"b" "line\\nbreak\\t\\\\"');
    expect(errors).toEqual([]);
    expect(tokens.slice(0, 3).map((t) => t.value)).toEqual(['hi', 'a"b', 'line\nbreak\t\\']);
    expect(tokens[1]!.lexeme).toBe('"a\\"b"');
  });

  it('reports unknown escapes but keeps the string', () => {
    const { tokens, errors } = lex('"a\\qb"');
    expect(tokens[0]!.value).toBe('aqb');
    expect(errors[0]).toMatchObject({ stage: 'lexer', span: { start: 2, end: 4 } });
  });

  it('reports an unclosed string and stops it at the end of the line', () => {
    const { tokens, errors } = lex('"open\nprint 1;');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('never closed');
    expect(tokens[0]).toMatchObject({ kind: 'STRING', value: 'open', span: { start: 0, end: 5 } });
    expect(tokens[1]!.kind).toBe('PRINT');
  });

  it('skips whitespace and # comments', () => {
    expect(kinds('# a comment\nprint 1; # trailing\n\t\r\n')).toEqual(['PRINT', 'NUMBER', 'SEMI', 'EOF']);
  });

  it('records exact spans and indexes', () => {
    const src = 'let x = 10;';
    const { tokens } = lex(src);
    for (const t of tokens) expect(src.slice(t.span.start, t.span.end)).toBe(t.lexeme);
    expect(tokens.map((t) => t.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(tokens[3]!.span).toEqual({ start: 8, end: 10 });
  });

  it('reports unexpected characters and keeps going', () => {
    const { tokens, errors } = lex('1 @ 2 $');
    expect(tokens.map((t) => t.kind)).toEqual(['NUMBER', 'NUMBER', 'EOF']);
    expect(errors.map((e) => e.span)).toEqual([{ start: 2, end: 3 }, { start: 6, end: 7 }]);
  });

  it('skips astral characters as one unit', () => {
    const { errors } = lex('😀');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.span).toEqual({ start: 0, end: 2 });
  });

  it('suggests "not" for a lone "!"', () => {
    const { errors } = lex('!x');
    expect(errors[0]!.message).toContain('"not"');
  });

  it('categorises tokens for colouring', () => {
    expect(tokenCategory('LET')).toBe('keyword');
    expect(tokenCategory('NUMBER')).toBe('literal');
    expect(tokenCategory('NIL')).toBe('literal');
    expect(tokenCategory('STRING')).toBe('string');
    expect(tokenCategory('IDENT')).toBe('name');
    expect(tokenCategory('PLUS')).toBe('operator');
    expect(tokenCategory('SEMI')).toBe('punct');
    expect(tokenCategory('EOF')).toBe('eof');
  });
});
