import { h, resetRoving, revealInPanel, roving } from '@glass/ui/dom';
import { tokenCategories } from './editor';
import { NodeHighlighter } from './highlight';
import type { Store } from './store';

const KIND: Record<string, string> = { ident: 'name', punct: 'punct', 'pp-num': 'number', char: 'char', str: 'string', keyword: 'keyword', header: 'header' };

/** Stage 1: the lexer's tokens, one row per source line (before the preprocessor runs). */
export function mountTokens(body: HTMLElement, count: HTMLElement, store: Store) {
  const hl = new NodeHighlighter();
  const list = h('div', { class: 'token-lines', role: 'group', 'aria-label': 'Tokens, grouped by line. Use arrow keys to move.' });
  body.append(list);
  roving(list, '.chip');
  list.addEventListener('click', (e) => {
    const chip = (e.target as Element).closest<HTMLElement>('.chip');
    if (!chip) return;
    const owner = Number(chip.dataset.node);
    store.select(owner >= 0 ? owner : null, 'tokens');
  });

  const render = () => {
    const { build, links } = store.state;
    hl.reset();
    list.replaceChildren();
    const cats = tokenCategories(build.tokens);
    let row: HTMLElement | null = null;
    let line = -1;
    let total = 0;
    build.tokens.forEach((t, i) => {
      if (t.kind === 'eof') return;
      total++;
      if (t.line !== line || !row) {
        line = t.line;
        row = h('div', { class: 'token-line' }, h('span', { class: 'token-ln', 'aria-hidden': 'true' }, String(line)));
        list.append(row);
      }
      const owner = links.tokenOwner[i] ?? -1;
      const kind = cats[i] === 'keyword' ? 'keyword' : (KIND[t.kind] ?? t.kind);
      const chip = h(
        'button',
        { type: 'button', class: `chip cat-${cats[i]}`, 'data-node': owner, title: `${kind} token on line ${line}` },
        h('span', { class: 'chip-kind' }, kind),
        ' ',
        h('span', { class: 'chip-lex' }, t.text),
      );
      row.append(chip);
      if (owner >= 0) hl.add(owner, chip);
    });
    if (total === 0) list.append(h('p', { class: 'empty' }, 'No tokens yet. Type some C in the editor.'));
    count.textContent = String(total);
    resetRoving(list, '.chip');
  };

  store.subscribe((s, prev) => {
    if (s.build !== prev.build) render();
    if (s.build !== prev.build || s.selected !== prev.selected) {
      const first = hl.sync(s);
      if (s.selected !== prev.selected && s.origin !== 'tokens') revealInPanel(first);
    }
  });
  render();
  hl.sync(store.state);
}
