import type { Span } from './token';

interface Base {
  /** Unique id within one parse. Links tokens, instructions and VM steps. */
  id: number;
  span: Span;
}

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=';
export type LogicalOp = 'and' | 'or';
export type UnaryOp = '-' | 'not';
export type LiteralValue = number | string | boolean | null;

export interface Literal extends Base { type: 'Literal'; value: LiteralValue }
export interface Variable extends Base { type: 'Variable'; name: string }
export interface Assign extends Base { type: 'Assign'; name: string; value: Expr }
export interface Unary extends Base { type: 'Unary'; op: UnaryOp; operand: Expr }
export interface Binary extends Base { type: 'Binary'; op: BinaryOp; left: Expr; right: Expr }
export interface Logical extends Base { type: 'Logical'; op: LogicalOp; left: Expr; right: Expr }
export interface Call extends Base { type: 'Call'; callee: Expr; args: Expr[] }
export interface Group extends Base { type: 'Group'; expr: Expr }

export type Expr = Literal | Variable | Assign | Unary | Binary | Logical | Call | Group;

export interface Let extends Base { type: 'Let'; name: string; init: Expr }
export interface Print extends Base { type: 'Print'; expr: Expr }
export interface ExprStmt extends Base { type: 'ExprStmt'; expr: Expr }
export interface Block extends Base { type: 'Block'; body: Stmt[] }
export interface If extends Base { type: 'If'; cond: Expr; then: Block; otherwise: Block | If | null }
export interface While extends Base { type: 'While'; cond: Expr; body: Block }
export interface FnDecl extends Base { type: 'Fn'; name: string; params: string[]; body: Block }
export interface Return extends Base { type: 'Return'; value: Expr | null }

export type Stmt = Let | Print | ExprStmt | Block | If | While | FnDecl | Return;

export interface Program extends Base { type: 'Program'; body: Stmt[] }

export type Node = Program | Stmt | Expr;

/** The direct children of a node, in source order, with a role label for drawing edges. */
export function children(node: Node): { role: string; node: Node }[] {
  switch (node.type) {
    case 'Program':
    case 'Block':
      return node.body.map((n) => ({ role: '', node: n }));
    case 'Literal':
    case 'Variable':
      return [];
    case 'Assign':
      return [{ role: 'value', node: node.value }];
    case 'Unary':
      return [{ role: '', node: node.operand }];
    case 'Binary':
    case 'Logical':
      return [
        { role: 'left', node: node.left },
        { role: 'right', node: node.right },
      ];
    case 'Call':
      return [{ role: 'callee', node: node.callee }, ...node.args.map((a, i) => ({ role: `arg ${i + 1}`, node: a }))];
    case 'Group':
      return [{ role: '', node: node.expr }];
    case 'Let':
      return [{ role: 'init', node: node.init }];
    case 'Print':
    case 'ExprStmt':
      return [{ role: '', node: node.expr }];
    case 'If': {
      const out: { role: string; node: Node }[] = [
        { role: 'cond', node: node.cond },
        { role: 'then', node: node.then },
      ];
      if (node.otherwise) out.push({ role: 'else', node: node.otherwise });
      return out;
    }
    case 'While':
      return [
        { role: 'cond', node: node.cond },
        { role: 'body', node: node.body },
      ];
    case 'Fn':
      return [{ role: 'body', node: node.body }];
    case 'Return':
      return node.value ? [{ role: '', node: node.value }] : [];
  }
}

/** Short human label for a node, used in the tree and the lineage strip. */
export function nodeLabel(node: Node): { kind: string; detail: string } {
  switch (node.type) {
    case 'Literal':
      return { kind: 'Literal', detail: formatLiteral(node.value) };
    case 'Variable':
      return { kind: 'Var', detail: node.name };
    case 'Assign':
      return { kind: 'Assign', detail: `${node.name} =` };
    case 'Unary':
    case 'Binary':
    case 'Logical':
      return { kind: node.type, detail: node.op };
    case 'Call':
      return { kind: 'Call', detail: node.callee.type === 'Variable' ? `${node.callee.name}()` : '()' };
    case 'Group':
      return { kind: 'Group', detail: '( )' };
    case 'Let':
      return { kind: 'Let', detail: node.name };
    case 'Fn':
      return { kind: 'Fn', detail: `${node.name}(${node.params.join(', ')})` };
    case 'ExprStmt':
      return { kind: 'Expr', detail: ';' };
    case 'Return':
      return { kind: 'Return', detail: '' };
    default:
      return { kind: node.type, detail: '' };
  }
}

export function formatLiteral(value: LiteralValue): string {
  if (value === null) return 'nil';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

/** Visit every node, parents before children. */
export function walk(node: Node, visit: (node: Node, parent: Node | null, depth: number) => void): void {
  const go = (n: Node, parent: Node | null, depth: number) => {
    visit(n, parent, depth);
    for (const c of children(n)) go(c.node, n, depth + 1);
  };
  go(node, null, 0);
}
