import { h, resetRoving, revealInPanel, roving } from '@glass/ui/dom';
import { encodeBytes } from '@glass/ui/share';
import type { Ins } from '@glass/wasm-encode';
import { NodeHighlighter } from './highlight';
import type { Store } from './store';

const text = (ins: Ins) => (ins.imm?.length ? `${ins.op} ${ins.imm.map(String).join(' ')}` : ins.op);

/** Stage 3: the WebAssembly module, the program's functions instruction by instruction. */
export function mountWasm(body: HTMLElement, meta: HTMLElement, actions: HTMLElement, store: Store) {
  const hl = new NodeHighlighter();
  const list = h('div', { class: 'wasm-funcs', role: 'group', 'aria-label': 'WebAssembly instructions. Use arrow keys to move.' });
  const library = h('details', { class: 'wasm-runtime' });
  const open = h('a', { class: 'btn btn-small btn-primary', href: '../wasm/', 'data-testid': 'open-in-glass-wasm' }, 'Open in Glass Wasm');
  actions.append(open);
  body.append(list, library);
  roving(list, '.winstr');
  list.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('.winstr');
    if (row?.dataset.node) store.select(Number(row.dataset.node), 'wasm');
  });

  const render = () => {
    const { build } = store.state;
    hl.reset();
    const w = build.wasm;
    if (!w) {
      list.replaceChildren(h('p', { class: 'empty' }, 'Fix the errors in the source and the WebAssembly appears here.'));
      library.replaceChildren();
      meta.textContent = 'no module';
      open.setAttribute('aria-disabled', 'true');
      open.removeAttribute('href');
      return;
    }
    let n = 0;
    const own = w.functions.filter((f) => f.kind === 'c');
    list.replaceChildren(
      ...own.map((f) => {
        let depth = 0;
        const section = h(
          'section',
          { class: 'chunk', 'aria-label': `WebAssembly function $${f.name}` },
          h(
            'h3',
            { class: 'chunk-title' },
            h('span', { class: 'pixel-label' }, 'func'),
            ` $${f.name}`,
            h('span', { class: 'wasm-sig' }, `${f.params.map((p) => ` (param $${p.name} ${p.type})`).join('')}${f.results.length ? ` (result ${f.results.join(' ')})` : ''}`),
          ),
        );
        f.body.forEach((ins, pc) => {
          if (ins.op === 'end' || ins.op === 'else') depth = Math.max(0, depth - 1);
          const row = h(
            'button',
            { type: 'button', class: `winstr d${Math.min(depth, 6)}`, 'data-node': ins.node ?? '', tabindex: '-1' },
            h('span', { class: 'addr' }, String(pc).padStart(2, '0')),
            ' ',
            h('span', { class: 'wop' }, text(ins)),
          );
          if (ins.node !== undefined) hl.add(ins.node, row);
          section.append(row);
          n++;
          if (ins.op === 'block' || ins.op === 'loop' || ins.op === 'if' || ins.op === 'else') depth++;
        });
        return section;
      }),
    );
    const lib = w.functions.filter((f) => f.kind === 'libc');
    library.replaceChildren(
      h('summary', null, `C library: ${lib.length} functions linked in`),
      h(
        'p',
        { class: 'small muted' },
        "printf, malloc and the rest are C too, compiled by Small C with your program. Only the functions it reaches are kept. They talk to the outside world through two host imports: c.write and c.exit.",
      ),
      h('p', { class: 'wasm-rt-names' }, lib.map((f) => `$${f.name}`).join('  ')),
    );
    meta.textContent = `${w.bytes.length.toLocaleString('en-GB')} bytes · ${n} instructions of yours`;
    open.removeAttribute('aria-disabled');
    open.setAttribute('href', `../wasm/#wasm=${encodeBytes(w.bytes)}`);
    resetRoving(list, '.winstr');
  };

  store.subscribe((s, prev) => {
    if (s.build !== prev.build) render();
    if (s.build !== prev.build || s.selected !== prev.selected) {
      const first = hl.sync(s);
      if (s.selected !== prev.selected && s.origin !== 'wasm') revealInPanel(first);
    }
  });
  render();
  hl.sync(store.state);
}
