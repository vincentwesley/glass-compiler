import { OP_HELP, formatOperand, formatValue, instrKey } from '../lang';
import { h, resetRoving, revealInPanel, roving } from './dom';
import { NodeHighlighter } from './highlight';
import type { Store } from './store';

/** Stage 3: bytecode, one section per chunk (main plus one per function). */
export function mountBytecode(body: HTMLElement, count: HTMLElement, help: HTMLElement, store: Store) {
  const hl = new NodeHighlighter();
  const rows = new Map<string, HTMLElement>();
  let pc: HTMLElement | undefined;
  const list = h('div', { class: 'chunks', role: 'group', 'aria-label': 'Bytecode instructions. Use arrow keys to move.' });
  body.append(list);
  roving(list, '.instr');

  list.addEventListener('click', (e) => {
    const row = (e.target as Element).closest<HTMLElement>('.instr');
    if (row) store.select(Number(row.dataset.node), 'bytecode');
  });

  const render = () => {
    const { build } = store.state;
    hl.reset();
    rows.clear();
    pc = undefined;
    list.replaceChildren();
    let total = 0;
    for (const chunk of build.compiled.chunks) {
      const title = chunk.index === 0 ? 'main' : `fn ${chunk.name}(${chunk.params.join(', ')})`;
      const section = h('section', { class: 'chunk', 'aria-label': `Chunk ${title}` }, h('h3', { class: 'chunk-title' }, h('span', { class: 'pixel-label' }, chunk.index === 0 ? 'Chunk' : 'Function'), ' ', title));
      if (chunk.constants.length > 0) {
        section.append(
          h('p', { class: 'consts' }, h('span', { class: 'pixel-label' }, 'Constants'), ' ', chunk.constants.map((c, i) => `#${i} ${formatValue(c, true)}`).join('   ')),
        );
      }
      chunk.code.forEach((instr, ip) => {
        total++;
        const operand = formatOperand(chunk, instr);
        const row = h(
          'button',
          { type: 'button', class: `instr op-${instr.op}`, 'data-node': instr.nodeId, 'data-key': instrKey(chunk.index, ip) },
          h('span', { class: 'addr' }, String(ip).padStart(2, '0')),
          ' ',
          h('span', { class: 'op' }, instr.op),
          ' ',
          h('span', { class: 'operand' }, operand),
        );
        rows.set(instrKey(chunk.index, ip), row);
        hl.add(instr.nodeId, row);
        section.append(row);
      });
      list.append(section);
    }
    if (build.diagnostics.length > 0) {
      list.prepend(h('p', { class: 'note' }, 'Partial bytecode: fix the errors in the source to run it.'));
    }
    count.textContent = String(total);
    resetRoving(list, '.instr');
  };

  const showHelp = () => {
    const s = store.state;
    const exec = s.links.instrAtStep(s.step);
    const selectedKey = s.selected !== null ? s.links.instrsByNode.get(s.selected)?.[0] : undefined;
    const instr = selectedKey ? s.links.instr(selectedKey) : exec?.instr;
    help.replaceChildren(
      instr ? h('span', null, h('strong', { class: 'help-op' }, instr.op), ' ', OP_HELP[instr.op]) : 'Select an instruction to see what it does.',
    );
  };

  store.subscribe((s, prev) => {
    if (s.build !== prev.build) render();
    if (s.build !== prev.build || s.selected !== prev.selected || s.step !== prev.step) {
      const first = hl.apply(s);
      pc?.classList.remove('is-pc');
      const exec = s.links.instrAtStep(s.step);
      pc = exec ? rows.get(instrKey(exec.chunk, exec.ip)) : undefined;
      pc?.classList.add('is-pc');
      if (s.selected !== prev.selected && s.origin !== 'bytecode') revealInPanel(first);
      else if (s.step !== prev.step) revealInPanel(pc);
      showHelp();
    }
  });
  render();
  hl.apply(store.state);
  showHelp();
}
