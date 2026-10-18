import { tokenCategory } from '../lang';
import { h, resetRoving, revealInPanel, roving } from './dom';
import { NodeHighlighter } from './highlight';
import type { Store } from './store';

/** Stage 1: the token stream, one row per source line. */
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
    const { build } = store.state;
    hl.reset();
    list.replaceChildren();
    let line = -1;
    let row: HTMLElement | null = null;
    let total = 0;
    let lineNo = 1;
    let nl = 0;
    for (const t of build.tokens) {
      if (t.kind === 'EOF') continue;
      total++;
      while (nl < t.span.start) {
        if (build.source[nl] === '\n') lineNo++;
        nl++;
      }
      const l = lineNo;
      if (l !== line || !row) {
        line = l;
        row = h('div', { class: 'token-line' }, h('span', { class: 'token-ln', 'aria-hidden': 'true' }, String(l)));
        list.append(row);
      }
      const owner = build.tokenOwner[t.index] ?? -1;
      const chip = h(
        'button',
        {
          type: 'button',
          class: `chip cat-${tokenCategory(t.kind)}`,
          'data-node': owner,
          title: `${t.kind} token on line ${l}`,
        },
        h('span', { class: 'chip-kind' }, t.kind),
        ' ',
        h('span', { class: 'chip-lex' }, t.lexeme),
      );
      row.append(chip);
      if (owner >= 0) hl.add(owner, chip);
    }
    if (total === 0) list.append(h('p', { class: 'empty' }, 'No tokens yet. Type some Pane code in the editor.'));
    count.textContent = String(total);
    resetRoving(list, '.chip');
  };

  store.subscribe((s, prev) => {
    if (s.build !== prev.build) render();
    if (s.build !== prev.build || s.selected !== prev.selected || s.step !== prev.step) {
      const first = hl.apply(s);
      if (s.selected !== prev.selected && s.origin !== 'tokens') revealInPanel(first);
    }
  });
  render();
  hl.apply(store.state);
}
