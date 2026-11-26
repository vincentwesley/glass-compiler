import { Highlighter } from '@glass/ui/highlight';
import type { State } from './store';

/** Small C's highlighter: keys are syntax-tree node ids (selected node mint, its descendants lavender). */
export class NodeHighlighter extends Highlighter<number> {
  sync(s: State): Element | undefined {
    return this.apply({ selected: s.selected, related: s.selected !== null ? s.links.subtree(s.selected) : [] });
  }
}
