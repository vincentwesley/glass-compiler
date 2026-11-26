/**
 * The Glass highlight language, shared by every debugger panel:
 *  - is-selected (mint):     the thing you picked
 *  - is-related  (lavender): things inside it
 *  - is-exec     (peach):    what the machine runs next
 *
 * A panel registers its elements under keys (a tree-node id, an address, a
 * register name...) and the highlighter keeps the classes in sync.
 */
export interface Highlight<K> {
  selected: K | null;
  related?: Iterable<K>;
  exec?: Iterable<K>;
}

export const HIGHLIGHT_CLASSES = ['is-selected', 'is-related', 'is-exec'] as const;

export class Highlighter<K = number> {
  private byKey = new Map<K, Element[]>();
  private lit: Element[] = [];

  reset() {
    this.byKey.clear();
    this.lit = [];
  }

  add(key: K, el: Element) {
    const list = this.byKey.get(key);
    if (list) list.push(el);
    else this.byKey.set(key, [el]);
  }

  elements(key: K): readonly Element[] {
    return this.byKey.get(key) ?? [];
  }

  /** Apply classes; returns the first element of the selected key, if any. */
  apply(h: Highlight<K>): Element | undefined {
    for (const el of this.lit) el.classList.remove(...HIGHLIGHT_CLASSES);
    this.lit = [];
    let first: Element | undefined;
    if (h.selected !== null) {
      for (const key of h.related ?? []) {
        if (key === h.selected) continue;
        for (const el of this.elements(key)) this.mark(el, 'is-related');
      }
      for (const el of this.elements(h.selected)) {
        first ??= el;
        this.mark(el, 'is-selected');
      }
    }
    for (const key of h.exec ?? []) for (const el of this.elements(key)) this.mark(el, 'is-exec');
    return first;
  }

  private mark(el: Element, cls: string) {
    el.classList.add(cls);
    this.lit.push(el);
  }
}
