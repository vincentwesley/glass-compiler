import { children, nodeLabel, type Node } from '../lang';

export interface LaidOutNode {
  node: Node;
  /** Role of this node in its parent ("cond", "then", ...), possibly empty. */
  role: string;
  kind: string;
  detail: string;
  /** Centre x and top y of the box. */
  x: number;
  y: number;
  width: number;
  depth: number;
  parent: LaidOutNode | null;
}

export interface TreeLayout {
  nodes: LaidOutNode[];
  width: number;
  height: number;
}

export const BOX_HEIGHT = 40;
export const LEVEL_GAP = 34;
export const SIBLING_GAP = 14;
export const CHAR_WIDTH = 7.8;
const PADDING_X = 14;
const MARGIN = 16;

/** Width of a node's box from its label lengths (monospace-ish, so this is predictable). */
export function boxWidth(kind: string, detail: string): number {
  const chars = Math.max(kind.length * 1.15, detail.length);
  return Math.max(44, Math.round(chars * CHAR_WIDTH + PADDING_X * 2));
}

/**
 * Simple tidy-tree layout: every subtree gets its own horizontal band, wide
 * enough for its children side by side; parents sit centred over their
 * children. Subtrees never overlap.
 */
export function layoutTree(root: Node): TreeLayout {
  const out: LaidOutNode[] = [];
  let maxDepth = 0;

  interface Measured {
    node: Node;
    role: string;
    kind: string;
    detail: string;
    box: number;
    width: number;
    kids: Measured[];
  }

  const measure = (node: Node, role: string): Measured => {
    const { kind, detail } = nodeLabel(node);
    const kids = children(node).map((c) => measure(c.node, c.role));
    const box = boxWidth(kind, detail);
    const kidsWidth = kids.reduce((sum, k) => sum + k.width, 0) + SIBLING_GAP * Math.max(0, kids.length - 1);
    return { node, role, kind, detail, box, width: Math.max(box, kidsWidth), kids };
  };

  const place = (m: Measured, left: number, depth: number, parent: LaidOutNode | null): LaidOutNode => {
    maxDepth = Math.max(maxDepth, depth);
    const laid: LaidOutNode = {
      node: m.node,
      role: m.role,
      kind: m.kind,
      detail: m.detail,
      x: 0,
      y: MARGIN + depth * (BOX_HEIGHT + LEVEL_GAP),
      width: m.box,
      depth,
      parent,
    };
    out.push(laid);
    const kidsWidth = m.kids.reduce((sum, k) => sum + k.width, 0) + SIBLING_GAP * Math.max(0, m.kids.length - 1);
    let cursor = left + (m.width - kidsWidth) / 2;
    const placed = m.kids.map((k) => {
      const child = place(k, cursor, depth + 1, laid);
      cursor += k.width + SIBLING_GAP;
      return child;
    });
    laid.x = placed.length > 0 ? (placed[0]!.x + placed[placed.length - 1]!.x) / 2 : left + m.width / 2;
    return laid;
  };

  const measured = measure(root, '');
  place(measured, MARGIN, 0, null);
  return {
    nodes: out,
    width: Math.ceil(measured.width + MARGIN * 2),
    height: MARGIN * 2 + maxDepth * (BOX_HEIGHT + LEVEL_GAP) + BOX_HEIGHT,
  };
}
