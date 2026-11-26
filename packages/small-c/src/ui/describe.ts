// How the page names each syntax-tree node.

import type { Node } from '../lang/ast';
import { typeName } from '../lang/types';

const OPS: Partial<Record<Node['kind'], string>> = {
  add: '+',
  sub: '-',
  mul: '*',
  div: '/',
  mod: '%',
  band: '&',
  bor: '|',
  bxor: '^',
  shl: '<<',
  shr: '>>',
  eq: '==',
  ne: '!=',
  lt: '<',
  le: '<=',
  logand: '&&',
  logor: '||',
  neg: 'unary -',
  not: '!',
  bitnot: '~',
  addr: '& (address of)',
  deref: '* (load through)',
  assign: '=',
  comma: ',',
  cond: '? :',
};

export interface NodeText {
  kind: string;
  detail: string;
  /** The expression's C type, or '' for statements. */
  type: string;
  /** Something C does without it being written (a conversion, a scaling). */
  implicit: boolean;
}

const STATEMENTS = new Set(['return', 'if', 'for', 'do', 'switch', 'case', 'block', 'goto', 'label', 'break', 'continue', 'exprstmt', 'nop', 'memzero']);

export function describeNode(n: Node): NodeText {
  const type = STATEMENTS.has(n.kind) || n.ty.kind === 'void' ? '' : typeName(n.ty);
  const r = (kind: string, detail = '', implicit = false): NodeText => ({ kind, detail, type, implicit });
  switch (n.kind) {
    case 'num':
      return r('constant', n.fval !== undefined ? String(n.fval) : String(n.val));
    case 'var': {
      const o = n.obj!;
      if (o.literal) return r('string', o.literal);
      if (o.isFunction) return r('function', o.name);
      if (o.name.startsWith('.compoundliteral')) return r('compound literal');
      return r(o.isParam ? 'parameter' : o.isLocal ? 'local' : 'global', o.name);
    }
    case 'member':
      return r('member', `.${n.member!.name?.text ?? '(anonymous)'}`);
    case 'cast':
      if (n.ty.kind === 'void') return r('discard', '(void)', n.implicit);
      return n.implicit ? r('convert', `${typeName(n.lhs!.ty)} → ${typeName(n.ty)}`, true) : r('cast', `(${typeName(n.ty)})`);
    case 'lt':
    case 'le':
      // Built from > or >=: show what was written.
      return r('operator', n.implicit ? (n.kind === 'lt' ? '>' : '>=') : OPS[n.kind]!);
    case 'mul':
    case 'div':
      return r('operator', OPS[n.kind]!, !!n.implicit);
    case 'opassign':
      return r('operator', `${OPS[n.op!]}=`);
    case 'postinc':
      return r('operator', n.delta! > 0 ? 'x++' : 'x--');
    case 'call':
      return r('call', n.lhs!.kind === 'var' ? `${n.lhs!.obj!.name}()` : '(*f)()');
    case 'stmtexpr':
      return r('statement expression', '({ … })');
    case 'vaarg':
      return r('va_arg');
    case 'memzero':
      return r('zero', n.obj!.name.startsWith('.') ? 'the literal' : n.obj!.name);
    case 'return':
      return r('return');
    case 'if':
      return r('if');
    case 'for':
      return r(n.init || n.inc ? 'for' : 'while');
    case 'do':
      return r('do … while');
    case 'switch':
      return r('switch');
    case 'case':
      return r(n.caseVal === undefined ? 'default' : 'case', n.caseVal === undefined ? '' : String(n.caseVal));
    case 'block':
      return n.decl ? r('declaration', n.stmts!.length ? '' : '(no initialiser)') : r('block', '{ }');
    case 'goto':
      return r('goto', n.label!);
    case 'label':
      return r('label', `${n.label!}:`);
    case 'break':
      return r('break');
    case 'continue':
      return r('continue');
    case 'exprstmt':
      return r('expression;');
    case 'nop':
      return r('empty statement');
    default:
      return r('operator', OPS[n.kind] ?? n.kind);
  }
}
