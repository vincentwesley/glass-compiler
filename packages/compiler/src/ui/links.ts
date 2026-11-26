import { instrKey, walk, type Build, type Instr, type Node, type Token } from '../lang';

/** Indexes that connect every stage of a build through node ids. */
export interface Links {
  tokensByNode: Map<number, number[]>;
  instrsByNode: Map<number, string[]>;
  stepsByInstr: Map<string, number[]>;
  parent: Map<number, number>;
  /** Node ids of a node and all its descendants. */
  subtree(nodeId: number): Set<number>;
  /** Steps that executed one of this node's own instructions, in order. */
  stepsForNode(nodeId: number): number[];
  tokenAt(offset: number): Token | undefined;
  instrAtStep(step: number): { chunk: number; ip: number; instr: Instr } | null;
  instr(key: string): Instr | undefined;
}

const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

export function buildLinks(b: Build): Links {
  const tokensByNode = new Map<number, number[]>();
  b.tokenOwner.forEach((owner, i) => {
    if (owner >= 0) push(tokensByNode, owner, i);
  });

  const instrsByNode = new Map<number, string[]>();
  const instrs = new Map<string, Instr>();
  for (const chunk of b.compiled.chunks) {
    chunk.code.forEach((instr, ip) => {
      const key = instrKey(chunk.index, ip);
      instrs.set(key, instr);
      push(instrsByNode, instr.nodeId, key);
    });
  }

  const stepsByInstr = new Map<string, number[]>();
  b.trace?.snapshots.forEach((s, step) => {
    if (s.at) push(stepsByInstr, instrKey(s.at.chunk, s.at.ip), step);
  });

  const parent = new Map<number, number>();
  const childrenOf = new Map<number, Node[]>();
  walk(b.program, (n, p) => {
    if (p) {
      parent.set(n.id, p.id);
      push(childrenOf, p.id, n);
    }
  });

  const subtreeCache = new Map<number, Set<number>>();
  const subtree = (id: number): Set<number> => {
    const cached = subtreeCache.get(id);
    if (cached) return cached;
    const out = new Set<number>([id]);
    const stack = [id];
    while (stack.length) {
      for (const c of childrenOf.get(stack.pop()!) ?? []) {
        out.add(c.id);
        stack.push(c.id);
      }
    }
    subtreeCache.set(id, out);
    return out;
  };

  const realTokens = b.tokens.filter((t) => t.kind !== 'EOF');

  return {
    tokensByNode,
    instrsByNode,
    stepsByInstr,
    parent,
    subtree,
    stepsForNode(id) {
      const steps: number[] = [];
      for (const key of instrsByNode.get(id) ?? []) steps.push(...(stepsByInstr.get(key) ?? []));
      return steps.sort((a, c) => a - c);
    },
    tokenAt(offset) {
      // Prefer the token the cursor is inside, then the one just before it.
      let before: Token | undefined;
      for (const t of realTokens) {
        if (t.span.start <= offset && offset < t.span.end) return t;
        if (t.span.end === offset) before = t;
        if (t.span.start > offset) break;
      }
      return before;
    },
    instrAtStep(step) {
      const at = b.trace?.snapshots[step]?.at;
      if (!at) return null;
      const instr = b.compiled.chunks[at.chunk]?.code[at.ip];
      return instr ? { ...at, instr } : null;
    },
    instr: (key) => instrs.get(key),
  };
}
