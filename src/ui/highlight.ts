import type { State } from './store';

/**
 * Tracks which elements in a panel belong to which syntax-tree node and keeps
 * the highlight classes in sync with the store:
 *  - is-selected: the selected node itself
 *  - is-related:  a descendant of the selected node
 *  - is-exec:     the node whose instruction the VM is about to run
 */
export class NodeHighlighter {
  private byNode = new Map<number, Element[]>();
  private lit: Element[] = [];

  reset() {
    this.byNode.clear();
    this.lit = [];
  }

  add(nodeId: number, el: Element) {
    const list = this.byNode.get(nodeId);
    if (list) list.push(el);
    else this.byNode.set(nodeId, [el]);
  }

  /** Apply classes; returns the first element of the selected node, if any. */
  apply(s: State, opts: { related?: boolean } = {}): Element | undefined {
    for (const el of this.lit) el.classList.remove('is-selected', 'is-related', 'is-exec');
    this.lit = [];
    let first: Element | undefined;
    if (s.selected !== null) {
      if (opts.related !== false) {
        for (const id of s.links.subtree(s.selected)) {
          if (id === s.selected) continue;
          for (const el of this.byNode.get(id) ?? []) this.mark(el, 'is-related');
        }
      }
      for (const el of this.byNode.get(s.selected) ?? []) {
        first ??= el;
        this.mark(el, 'is-selected');
      }
    }
    const exec = s.links.instrAtStep(s.step);
    if (exec) for (const el of this.byNode.get(exec.instr.nodeId) ?? []) this.mark(el, 'is-exec');
    return first;
  }

  private mark(el: Element, cls: string) {
    el.classList.add(cls);
    this.lit.push(el);
  }
}
