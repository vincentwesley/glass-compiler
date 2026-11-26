import { h, resetRoving, revealInPanel, roving } from '@glass/ui/dom';
import { Highlighter } from '@glass/ui/highlight';
import { instrHelp } from './help';
import { decodePane, type PaneView } from './pane-values';
import { key, parseKey, type State, type WasmStore } from './state';

/** Stage 1: the validated module's functions, one row per instruction. */
export function mountCode(body: HTMLElement, count: HTMLElement, help: HTMLElement, store: WasmStore, select: (k: string | null) => void, paneView: () => PaneView | null) {
  const hl = new Highlighter<string>();
  const rows = new Map<string, HTMLElement>();

  /** For a module compiled from Pane, what an i64 constant means. */
  const constNote = (text: string) => {
    const view = paneView();
    const m = /^i64\.const (-?\d+)$/.exec(text);
    if (!view || !m) return null;
    const pane = decodePane({ type: 'i64', value: m[1]!, bits: '' }, view);
    return pane ? h('span', { class: 'code-note' }, ` ;; ${pane.text}`) : null;
  };

  const render = (s: State) => {
    hl.reset();
    rows.clear();
    if (!s.info) {
      body.replaceChildren(h('p', { class: 'empty' }, 'Fix the module and its code appears here.'));
      count.textContent = '0';
      return;
    }
    let n = 0;
    const funcs = s.info.funcs.map((f) =>
      h(
        'section',
        { class: 'code-func', 'aria-label': `Function ${f.name}` },
        h('h3', { class: 'code-func-head' }, h('span', { class: 'code-func-name' }, f.name), h('span', { class: 'code-func-type' }, f.type)),
        h(
          'ol',
          { class: 'code-lines' },
          ...f.lines.map((line, pc) => {
            n++;
            const k = key(f.index, pc);
            const btn = h(
              'button',
              { type: 'button', class: `code-line d${Math.min(line.depth, 8)}`, 'data-key': k, tabindex: '-1' },
              h('span', { class: 'code-pc', 'aria-hidden': 'true' }, String(pc).padStart(2, '0')),
              h('span', { class: 'code-text' }, line.text),
              constNote(line.text),
            );
            hl.add(k, btn);
            rows.set(k, btn);
            return h('li', null, btn);
          }),
        ),
      ),
    );
    count.textContent = String(n);
    body.replaceChildren(...funcs);
    resetRoving(body, '.code-line');
  };

  const highlight = (s: State) => {
    const at = s.machine?.at;
    const first = hl.apply({ selected: s.selected, exec: at ? [key(at.func, at.pc)] : [] });
    if (s.selected && s.origin !== 'code') revealInPanel(first);
    else if (!s.selected && at && s.playing) revealInPanel(rows.get(key(at.func, at.pc)));
    if (s.selected && s.info) {
      const { func, pc } = parseKey(s.selected);
      const line = s.info.funcs.find((f) => f.index === func)?.lines[pc];
      help.replaceChildren(h('code', null, line?.text ?? ''), ' ', instrHelp(line?.text ?? ''));
    } else {
      help.textContent = 'Select an instruction to see what it does and when it runs.';
    }
  };

  body.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('.code-line');
    if (row) select(row.dataset.key === store.state.selected ? null : row.dataset.key!);
  });
  roving(body, '.code-line');

  store.subscribe((s, prev) => {
    if (s.info !== prev.info) render(s);
    if (s.info !== prev.info || s.selected !== prev.selected || s.machine !== prev.machine) highlight(s);
  });
  render(store.state);
  highlight(store.state);
}
