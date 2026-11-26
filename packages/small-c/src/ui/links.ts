// How the stages point at each other: syntax-tree nodes ↔ source spans ↔ the
// program's own tokens ↔ WebAssembly instructions.

import type { Node, Obj } from '../lang/ast';
import type { Build } from '../lang/compile';

export interface TreeItem {
  node: Node;
  /** The role this node plays under its parent ("cond", "then", "arg 1"…). */
  role: string;
  children: TreeItem[];
}

export interface TopItem {
  kind: 'function' | 'global';
  obj: Obj;
  body: TreeItem | null;
}

export interface Links {
  top: TopItem[];
  nodes: Map<number, Node>;
  /** For each of the program's tokens (by index), the innermost tree node it belongs to, or -1. */
  tokenOwner: number[];
  /** Descendants of each node (itself included). */
  subtree(id: number): number[];
  parentOf: Map<number, number>;
  /** Wasm instruction keys ("func:pc") by node. */
  instrsByNode: Map<number, string[]>;
}

const CHILDREN: [keyof Node, string][] = [
  ['init', 'init'],
  ['cond', 'condition'],
  ['lhs', ''],
  ['rhs', ''],
  ['then', 'then'],
  ['els', 'else'],
  ['inc', 'step'],
  ['body', 'body'],
];

export function buildLinks(b: Build): Links {
  const nodes = new Map<number, Node>();
  const parentOf = new Map<number, number>();
  const kids = new Map<number, number[]>();
  const top: TopItem[] = [];
  const isUser = (n: Node) => (n.tok.origin ?? n.tok).file.user;

  const item = (n: Node, role: string, parent: number | null, seen: Set<Node>): TreeItem => {
    nodes.set(n.id, n);
    if (parent !== null && !parentOf.has(n.id)) {
      parentOf.set(n.id, parent);
      const k = kids.get(parent) ?? [];
      k.push(n.id);
      kids.set(parent, k);
    }
    const children: TreeItem[] = [];
    if (seen.has(n)) return { node: n, role, children };
    seen.add(n);
    for (const [key, r] of CHILDREN) {
      const c = n[key] as Node | undefined;
      if (c && typeof c === 'object' && 'kind' in c) children.push(item(c, r || roleFor(n, key), n.id, seen));
    }
    n.stmts?.forEach((s) => children.push(item(s, '', n.id, seen)));
    n.args?.forEach((a, i) => children.push(item(a, `argument ${i + 1}`, n.id, seen)));
    return { node: n, role, children };
  };

  if (b.unit) {
    for (const g of b.unit.globals) {
      if (!(g.tok.origin ?? g.tok).file.user || g.anonymous) continue;
      if (g.isFunction && !g.body) continue;
      top.push({ kind: g.isFunction ? 'function' : 'global', obj: g, body: g.body ? item(g.body, 'body', null, new Set()) : null });
    }
  }

  // Each token belongs to the smallest node whose span holds it.
  const userNodes = [...nodes.values()].filter(isUser);
  const tokenOwner = b.tokens.map((t) => {
    let best: Node | undefined;
    for (const n of userNodes) {
      if (n.start <= t.offset && t.end <= n.end && (!best || n.end - n.start < best.end - best.start)) best = n;
    }
    return best ? best.id : -1;
  });

  const instrsByNode = new Map<number, string[]>();
  for (const f of b.wasm?.functions ?? []) {
    if (f.kind !== 'c') continue;
    f.body.forEach((ins, pc) => {
      if (ins.node === undefined) return;
      const list = instrsByNode.get(ins.node) ?? [];
      list.push(`${f.index}:${pc}`);
      instrsByNode.set(ins.node, list);
    });
  }

  const subtree = (id: number): number[] => {
    const out = [id];
    for (let i = 0; i < out.length; i++) out.push(...(kids.get(out[i]!) ?? []));
    return out;
  };
  return { top, nodes, tokenOwner, subtree, parentOf, instrsByNode };
}

function roleFor(n: Node, key: keyof Node): string {
  if (key === 'lhs') {
    if (n.kind === 'call') return 'callee';
    if (n.kind === 'assign' || n.kind === 'opassign') return 'target';
    if (n.kind === 'return') return 'value';
    return n.rhs ? 'left' : '';
  }
  if (key === 'rhs') return n.kind === 'assign' || n.kind === 'opassign' ? 'value' : 'right';
  return '';
}
