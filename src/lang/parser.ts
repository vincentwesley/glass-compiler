import {
  children,
  type BinaryOp,
  type Block,
  type Expr,
  type FnDecl,
  type If,
  type LogicalOp,
  type Node,
  type Program,
  type Stmt,
} from './ast';
import type { Diagnostic } from './errors';
import type { Span, Token, TokenKind } from './token';

export interface ParseResult {
  program: Program;
  /** For each token index, the id of the node that owns it, or -1. */
  tokenOwner: number[];
  /** Every node by id. */
  nodes: Map<number, Node>;
  errors: Diagnostic[];
}

/**
 * Binding powers for infix operators, matklad-style: each operator has a
 * left and a right power. Higher binds tighter. Left-associative operators
 * have right = left + 1; right-associative ones have right = left - 1.
 */
export interface OperatorInfo {
  ops: string[];
  name: string;
  left: number;
  right: number;
  assoc: 'left' | 'right' | 'prefix' | 'postfix';
}

export const OPERATOR_TABLE: readonly OperatorInfo[] = [
  { ops: ['='], name: 'assignment', left: 2, right: 1, assoc: 'right' },
  { ops: ['or'], name: 'logical or', left: 3, right: 4, assoc: 'left' },
  { ops: ['and'], name: 'logical and', left: 5, right: 6, assoc: 'left' },
  { ops: ['not'], name: 'logical not', left: 0, right: 7, assoc: 'prefix' },
  { ops: ['==', '!='], name: 'equality', left: 7, right: 8, assoc: 'left' },
  { ops: ['<', '<=', '>', '>='], name: 'comparison', left: 9, right: 10, assoc: 'left' },
  { ops: ['+', '-'], name: 'sum', left: 11, right: 12, assoc: 'left' },
  { ops: ['*', '/', '%'], name: 'product', left: 13, right: 14, assoc: 'left' },
  { ops: ['-'], name: 'negation', left: 0, right: 15, assoc: 'prefix' },
  { ops: ['( )'], name: 'call', left: 17, right: 0, assoc: 'postfix' },
];

const INFIX: Partial<Record<TokenKind, { left: number; right: number; op: BinaryOp | LogicalOp | '=' }>> = {
  EQ: { left: 2, right: 1, op: '=' },
  OR: { left: 3, right: 4, op: 'or' },
  AND: { left: 5, right: 6, op: 'and' },
  EQ_EQ: { left: 7, right: 8, op: '==' },
  BANG_EQ: { left: 7, right: 8, op: '!=' },
  LT: { left: 9, right: 10, op: '<' },
  LT_EQ: { left: 9, right: 10, op: '<=' },
  GT: { left: 9, right: 10, op: '>' },
  GT_EQ: { left: 9, right: 10, op: '>=' },
  PLUS: { left: 11, right: 12, op: '+' },
  MINUS: { left: 11, right: 12, op: '-' },
  STAR: { left: 13, right: 14, op: '*' },
  SLASH: { left: 13, right: 14, op: '/' },
  PERCENT: { left: 13, right: 14, op: '%' },
};
const NOT_RIGHT = 7;
const NEG_RIGHT = 15;
const CALL_LEFT = 17;

/** How deeply the parser may recurse (nested brackets, blocks, right-hand sides). */
const MAX_DEPTH = 200;
/** How deep the finished tree may be (long operator chains nest without recursing). */
export const MAX_TREE_DEPTH = 300;

const DESCRIBE: Partial<Record<TokenKind, string>> = {
  SEMI: '";"',
  LPAREN: '"("',
  RPAREN: '")"',
  LBRACE: '"{"',
  RBRACE: '"}"',
  EQ: '"="',
  IDENT: 'a name',
  EOF: 'the end of the program',
};

class ParseError extends Error {}

/** Parse tokens into a syntax tree. Errors are collected and parsing resumes at the next statement. */
export function parse(tokens: Token[]): ParseResult {
  let pos = 0;
  let nextId = 0;
  let depth = 0;
  const errors: Diagnostic[] = [];
  const tokenOwner: number[] = new Array<number>(tokens.length).fill(-1);
  const nodes = new Map<number, Node>();

  const peek = (): Token => tokens[pos]!;
  const prev = (): Token => tokens[pos - 1]!;
  const at = (kind: TokenKind) => peek().kind === kind;
  const advance = (): Token => {
    const t = peek();
    if (t.kind !== 'EOF') pos++;
    return t;
  };

  const describe = (t: Token) => (t.kind === 'EOF' ? 'the end of the program' : `"${t.lexeme}"`);

  const fail = (message: string, span: Span = peek().span): never => {
    errors.push({ stage: 'parser', message, span });
    throw new ParseError(message);
  };

  const expect = (kind: TokenKind, context: string): Token => {
    if (at(kind)) return advance();
    return fail(`Expected ${DESCRIBE[kind] ?? kind} ${context}, but found ${describe(peek())}.`);
  };

  /** Depth of the subtree under each node, so very deep trees can be refused. */
  const heights = new Map<number, number>();
  /** The IDENT token behind each Variable node, so assignment can take it over. */
  const nameTokens = new Map<number, Token>();

  /** Create a node, record it, and mark the given tokens as owned by it. */
  const make = <T extends Node>(fields: Omit<T, 'id'>, owned: Token[]): T => {
    const node = { id: nextId++, ...fields } as T;
    const height = 1 + Math.max(0, ...children(node).map((c) => heights.get(c.node.id) ?? 0));
    if (height > MAX_TREE_DEPTH) fail('This part of the program is nested too deeply to show.', node.span);
    heights.set(node.id, height);
    nodes.set(node.id, node);
    for (const t of owned) tokenOwner[t.index] = node.id;
    return node;
  };

  /** Run a recursive parse step with a depth guard that is always unwound. */
  const nested = <T>(what: string, parseStep: () => T): T => {
    depth++;
    try {
      if (depth > MAX_DEPTH) fail(`This ${what} is nested too deeply.`);
      return parseStep();
    } finally {
      depth--;
    }
  };

  const span = (from: Span, to: Span): Span => ({ start: from.start, end: to.end });

  // ---------- expressions (Pratt) ----------

  function expression(minBp = 0): Expr {
    return nested('expression', () => {
      let lhs = prefix();
      for (;;) {
        const t = peek();
        if (t.kind === 'LPAREN') {
          if (CALL_LEFT < minBp) break;
          lhs = call(lhs);
          continue;
        }
        const info = INFIX[t.kind];
        if (!info || info.left < minBp) break;
        advance();
        const rhs = expression(info.right);
        if (info.op === '=') {
          if (lhs.type !== 'Variable') {
            fail('Only a variable name can go on the left of "=".', lhs.span);
          }
          const target = lhs as Extract<Expr, { type: 'Variable' }>;
          // The Assign node replaces the Variable: it owns the name token and "=".
          nodes.delete(target.id);
          const nameToken = nameTokens.get(target.id)!;
          lhs = make<Expr>({ type: 'Assign', name: target.name, value: rhs, span: span(lhs.span, rhs.span) } as Omit<Expr, 'id'>, [nameToken, t]);
        } else if (info.op === 'and' || info.op === 'or') {
          lhs = make<Expr>({ type: 'Logical', op: info.op, left: lhs, right: rhs, span: span(lhs.span, rhs.span) } as Omit<Expr, 'id'>, [t]);
        } else {
          lhs = make<Expr>({ type: 'Binary', op: info.op, left: lhs, right: rhs, span: span(lhs.span, rhs.span) } as Omit<Expr, 'id'>, [t]);
        }
      }
      return lhs;
    });
  }

  function prefix(): Expr {
    const t = advance();
    switch (t.kind) {
      case 'NUMBER':
      case 'STRING':
        return make<Expr>({ type: 'Literal', value: t.value!, span: t.span } as Omit<Expr, 'id'>, [t]);
      case 'TRUE':
      case 'FALSE':
        return make<Expr>({ type: 'Literal', value: t.kind === 'TRUE', span: t.span } as Omit<Expr, 'id'>, [t]);
      case 'NIL':
        return make<Expr>({ type: 'Literal', value: null, span: t.span } as Omit<Expr, 'id'>, [t]);
      case 'IDENT': {
        const v = make<Expr>({ type: 'Variable', name: t.lexeme, span: t.span } as Omit<Expr, 'id'>, [t]);
        nameTokens.set(v.id, t);
        return v;
      }
      case 'MINUS':
      case 'NOT': {
        const operand = expression(t.kind === 'MINUS' ? NEG_RIGHT : NOT_RIGHT);
        return make<Expr>(
          { type: 'Unary', op: t.kind === 'MINUS' ? '-' : 'not', operand, span: span(t.span, operand.span) } as Omit<Expr, 'id'>,
          [t],
        );
      }
      case 'LPAREN': {
        const inner = expression(0);
        const close = expect('RPAREN', 'to close the bracket');
        return make<Expr>({ type: 'Group', expr: inner, span: span(t.span, close.span) } as Omit<Expr, 'id'>, [t, close]);
      }
      default:
        pos = Math.max(0, pos - (t.kind === 'EOF' ? 0 : 1));
        return fail(`Expected a value or expression, but found ${describe(t)}.`, t.span);
    }
  }

  function call(callee: Expr): Expr {
    const open = advance();
    const owned = [open];
    const args: Expr[] = [];
    if (!at('RPAREN')) {
      do {
        if (args.length > 0) owned.push(prev());
        args.push(expression(0));
      } while (at('COMMA') && advance());
    }
    const close = expect('RPAREN', 'after the arguments');
    owned.push(close);
    return make<Expr>({ type: 'Call', callee, args, span: span(callee.span, close.span) } as Omit<Expr, 'id'>, owned);
  }

  // ---------- statements ----------

  function statement(): Stmt {
    switch (peek().kind) {
      case 'LET':
        return letStmt();
      case 'FN':
        return fnDecl();
      case 'RETURN':
        return returnStmt();
      case 'IF':
        return ifStmt();
      case 'WHILE':
        return whileStmt();
      case 'PRINT': {
        const kw = advance();
        const expr = expression();
        const semi = expect('SEMI', 'after the value to print');
        return make<Stmt>({ type: 'Print', expr, span: span(kw.span, semi.span) } as Omit<Stmt, 'id'>, [kw, semi]);
      }
      case 'LBRACE':
        return block();
      default: {
        const expr = expression();
        const semi = expect('SEMI', 'at the end of the statement');
        return make<Stmt>({ type: 'ExprStmt', expr, span: span(expr.span, semi.span) } as Omit<Stmt, 'id'>, [semi]);
      }
    }
  }

  function letStmt(): Stmt {
    const kw = advance();
    const name = expect('IDENT', 'after "let"');
    const eq = expect('EQ', `after "let ${name.lexeme}" (every variable needs a starting value)`);
    const init = expression();
    const semi = expect('SEMI', 'after the variable\'s value');
    return make<Stmt>({ type: 'Let', name: name.lexeme, init, span: span(kw.span, semi.span) } as Omit<Stmt, 'id'>, [kw, name, eq, semi]);
  }

  function fnDecl(): FnDecl {
    const kw = advance();
    const name = expect('IDENT', 'after "fn"');
    const owned = [kw, name, expect('LPAREN', 'after the function name')];
    const params: string[] = [];
    if (!at('RPAREN')) {
      do {
        if (params.length > 0) owned.push(prev());
        const p = expect('IDENT', 'for a parameter name');
        if (params.includes(p.lexeme)) fail(`The parameter "${p.lexeme}" is listed twice.`, p.span);
        params.push(p.lexeme);
        owned.push(p);
      } while (at('COMMA') && advance());
    }
    owned.push(expect('RPAREN', 'after the parameters'));
    const body = block();
    return make<FnDecl>({ type: 'Fn', name: name.lexeme, params, body, span: span(kw.span, body.span) }, owned);
  }

  function returnStmt(): Stmt {
    const kw = advance();
    const value = at('SEMI') ? null : expression();
    const semi = expect('SEMI', 'after "return"');
    return make<Stmt>({ type: 'Return', value, span: span(kw.span, semi.span) } as Omit<Stmt, 'id'>, [kw, semi]);
  }

  function ifStmt(): If {
    return nested('"else if" chain', ifStmtInner);
  }

  function ifStmtInner(): If {
    const kw = advance();
    const cond = expression();
    const then = block();
    const owned = [kw];
    let otherwise: Block | If | null = null;
    if (at('ELSE')) {
      owned.push(advance());
      otherwise = at('IF') ? ifStmt() : block();
    }
    return make<If>({ type: 'If', cond, then, otherwise, span: span(kw.span, (otherwise ?? then).span) }, owned);
  }

  function whileStmt(): Stmt {
    const kw = advance();
    const cond = expression();
    const body = block();
    return make<Stmt>({ type: 'While', cond, body, span: span(kw.span, body.span) } as Omit<Stmt, 'id'>, [kw]);
  }

  function block(): Block {
    return nested('block', blockInner);
  }

  function blockInner(): Block {
    const open = expect('LBRACE', 'to start a block');
    const body = statementsUntil('RBRACE');
    if (!at('RBRACE')) {
      errors.push({ stage: 'parser', message: 'This block is missing its closing "}".', span: open.span });
      return make<Block>({ type: 'Block', body, span: span(open.span, prev().span) }, [open]);
    }
    const close = advance();
    return make<Block>({ type: 'Block', body, span: span(open.span, close.span) }, [open, close]);
  }

  function statementsUntil(end: TokenKind | null): Stmt[] {
    const body: Stmt[] = [];
    while (!at('EOF') && (end === null || !at(end))) {
      if (end === null && at('RBRACE')) {
        // A closing brace at the top level has nothing to close.
        const t = advance();
        errors.push({ stage: 'parser', message: 'Unexpected "}" with no matching "{".', span: t.span });
        continue;
      }
      const startPos = pos;
      try {
        body.push(statement());
      } catch (e) {
        if (!(e instanceof ParseError)) throw e;
        synchronize(startPos);
      }
    }
    return body;
  }

  /** Skip tokens until a likely statement boundary so one mistake doesn't hide the rest. */
  function synchronize(startPos: number) {
    if (pos === startPos) advance();
    while (!at('EOF')) {
      if (prev().kind === 'SEMI' && pos > startPos) return;
      switch (peek().kind) {
        case 'LET':
        case 'FN':
        case 'IF':
        case 'WHILE':
        case 'PRINT':
        case 'RETURN':
        case 'RBRACE':
          return;
        default:
          advance();
      }
    }
  }

  const body = statementsUntil(null);
  const eof = peek();
  // Built directly: the root is never refused, whatever the depth of its statements.
  const program: Program = { id: nextId++, type: 'Program', body, span: { start: 0, end: eof.span.end } };
  nodes.set(program.id, program);
  return { program, tokenOwner, nodes, errors };
}
