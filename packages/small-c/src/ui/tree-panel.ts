import { h, resetRoving, revealInPanel, roving } from '@glass/ui/dom';
import { typeName } from '../lang/types';
import { describeNode } from './describe';
import { NodeHighlighter } from './highlight';
import type { TreeItem } from './links';
import type { Store } from './store';

/** Stage 2: the typed syntax tree, as an outline. Conversions C makes on its own are shown, marked "implicit". */
export function mountTree(body: HTMLElement, count: HTMLElement, store: Store) {
  const hl = new NodeHighlighter();
  const root = h('div', { class: 'tree-outline', role: 'group', 'aria-label': 'Syntax tree. Use arrow keys to move.' });
  body.append(root);
  roving(root, '.trow');
  root.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('.trow');
    if (row?.dataset.node) store.select(Number(row.dataset.node), 'tree');
  });

  const render = () => {
    const { links, build } = store.state;
    hl.reset();
    let n = 0;
    const itemEl = (it: TreeItem): HTMLElement => {
      n++;
      const d = describeNode(it.node);
      const row = h(
        'button',
        { type: 'button', class: `trow${d.implicit ? ' is-implicit' : ''}`, 'data-node': it.node.id, tabindex: '-1' },
        it.role ? h('span', { class: 'trole' }, it.role) : null,
        h('span', { class: 'tkind' }, d.kind),
        d.detail ? h('span', { class: 'tdetail' }, d.detail) : null,
        d.type ? h('span', { class: 'ttype' }, d.type) : null,
        d.implicit ? h('span', { class: 'timplicit' }, 'implicit') : null,
      );
      hl.add(it.node.id, row);
      // Blocks with one child and expression statements add little: keep them, but flat.
      return h('li', null, row, it.children.length ? h('ul', null, ...it.children.map(itemEl)) : null);
    };
    const parts: HTMLElement[] = [];
    for (const t of links.top) {
      const o = t.obj;
      const head = h(
        'div',
        { class: 'tree-top' },
        h('span', { class: 'pixel-label' }, t.kind === 'function' ? 'function' : 'global'),
        ' ',
        h('code', null, o.name),
        h('span', { class: 'ttype' }, typeName(o.ty)),
      );
      parts.push(h('section', { class: 'tree-fn' }, head, t.body ? h('ul', { class: 'tree-root' }, itemEl(t.body)) : null));
    }
    if (!parts.length) parts.push(h('p', { class: 'empty' }, build.diagnostics.length ? 'Fix the errors in the source and the tree appears here.' : 'No functions yet.'));
    root.replaceChildren(...parts);
    count.textContent = String(n);
    resetRoving(root, '.trow');
  };

  store.subscribe((s, prev) => {
    if (s.build !== prev.build) render();
    if (s.build !== prev.build || s.selected !== prev.selected) {
      const first = hl.sync(s);
      if (s.selected !== prev.selected && s.origin !== 'tree') revealInPanel(first);
    }
  });
  render();
  hl.sync(store.state);
}
