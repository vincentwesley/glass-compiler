import { Highlighter } from '@glass/ui/highlight';
import type { State } from './store';

/**
 * Glass Compiler's highlighter: keys are syntax-tree node ids.
 *  - is-selected: the selected node itself
 *  - is-related:  a descendant of the selected node
 *  - is-exec:     the node whose instruction the VM is about to run
 */
export class NodeHighlighter extends Highlighter<number> {
  /** Apply classes from the store; returns the first element of the selected node, if any. */
  sync(s: State, opts: { related?: boolean } = {}): Element | undefined {
    const exec = s.links.instrAtStep(s.step);
    return this.apply({
      selected: s.selected,
      related: s.selected !== null && opts.related !== false ? s.links.subtree(s.selected) : [],
      exec: exec ? [exec.instr.nodeId] : [],
    });
  }
}
