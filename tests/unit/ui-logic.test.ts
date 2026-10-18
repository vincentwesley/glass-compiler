import { describe, expect, it } from 'vitest';
import { build, instrKey, type Node } from '../../src/lang';
import { EXAMPLES } from '../../src/examples';
import { buildLinks } from '../../src/ui/links';
import { BOX_HEIGHT, boxWidth, layoutTree } from '../../src/ui/tree-layout';

describe('tree layout', () => {
  it('never overlaps boxes on the same level, for every example', () => {
    for (const ex of EXAMPLES) {
      const layout = layoutTree(build(ex.source).program);
      const byDepth = new Map<number, { left: number; right: number }[]>();
      for (const n of layout.nodes) {
        const list = byDepth.get(n.depth) ?? [];
        list.push({ left: n.x - n.width / 2, right: n.x + n.width / 2 });
        byDepth.set(n.depth, list);
      }
      for (const [depth, boxes] of byDepth) {
        boxes.sort((a, b) => a.left - b.left);
        for (let i = 1; i < boxes.length; i++) {
          expect(boxes[i]!.left, `${ex.id} depth ${depth}`).toBeGreaterThanOrEqual(boxes[i - 1]!.right);
        }
      }
    }
  });

  it('keeps every box inside the canvas and puts children below parents', () => {
    const layout = layoutTree(build(EXAMPLES[4]!.source).program);
    for (const n of layout.nodes) {
      expect(n.x - n.width / 2).toBeGreaterThanOrEqual(0);
      expect(n.x + n.width / 2).toBeLessThanOrEqual(layout.width);
      expect(n.y + BOX_HEIGHT).toBeLessThanOrEqual(layout.height);
      if (n.parent) expect(n.y).toBeGreaterThan(n.parent.y);
    }
  });

  it('centres a parent over its children', () => {
    const layout = layoutTree(build('print 1 + 2;').program);
    const plus = layout.nodes.find((n) => n.kind === 'Binary')!;
    const kids = layout.nodes.filter((n) => n.parent === plus);
    expect(plus.x).toBeCloseTo((kids[0]!.x + kids[1]!.x) / 2);
  });

  it('sizes boxes from their labels', () => {
    expect(boxWidth('Literal', '1')).toBeLessThan(boxWidth('Literal', '"a much longer string"'));
    expect(boxWidth('', '')).toBe(44);
  });
});

describe('links between stages', () => {
  const b = build('let a = 2;\nprint a * 3;\nprint a * 3;');
  const links = buildLinks(b);
  const mul = [...b.nodes.values()].filter((n: Node) => n.type === 'Binary');

  it('maps nodes to their tokens and instructions', () => {
    const first = mul[0]!;
    expect(links.tokensByNode.get(first.id)!.map((i) => b.tokens[i]!.lexeme)).toEqual(['*']);
    expect(links.instrsByNode.get(first.id)!.map((k) => links.instr(k)!.op)).toEqual(['MUL']);
  });

  it('maps instructions to the steps that ran them', () => {
    const steps = links.stepsForNode(mul[0]!.id);
    expect(steps).toHaveLength(1);
    expect(links.instrAtStep(steps[0]!)!.instr.op).toBe('MUL');
  });

  it('collects every step of a loop body', () => {
    const loop = build('let i = 0; while i < 4 { i = i + 1; }');
    const l = buildLinks(loop);
    const plus = [...loop.nodes.values()].find((n) => n.type === 'Binary' && n.op === '+')!;
    expect(l.stepsForNode(plus.id)).toHaveLength(4);
    const key = l.instrsByNode.get(plus.id)![0]!;
    expect(l.stepsByInstr.get(key)).toHaveLength(4);
    expect(key.startsWith(`${instrKey(0, 0).split(':')[0]}:`)).toBe(true);
  });

  it('finds the token under a cursor, preferring the one it is inside', () => {
    expect(links.tokenAt(0)!.lexeme).toBe('let');
    expect(links.tokenAt(3)!.lexeme).toBe('let');
    expect(links.tokenAt(4)!.lexeme).toBe('a');
    expect(links.tokenAt(5)!.lexeme).toBe('a');
  });

  it('includes a node and all its descendants in its subtree', () => {
    const print = b.program.body[1]!;
    const ids = links.subtree(print.id);
    expect(ids.has(print.id)).toBe(true);
    expect(ids.has(mul[0]!.id)).toBe(true);
    expect(ids.has(mul[1]!.id)).toBe(false);
    expect(links.parent.get(mul[0]!.id)).toBe(print.id);
  });

  it('has no steps when the program did not compile', () => {
    const broken = buildLinks(build('print 1 +;'));
    expect(broken.instrAtStep(0)).toBeNull();
    expect(broken.stepsByInstr.size).toBe(0);
  });
});
