import { h } from '@glass/ui/dom';
import { lineColAt, stepsFor } from '../vm';
import { instrHelp } from './help';
import { parseKey, type State, type WasmStore } from './state';

/** The strip at the bottom: where the selected instruction came from and when it runs. */
export function mountLineage(el: HTMLElement, store: WasmStore, select: (k: string | null) => void, goto: (step: number) => void) {
  const render = (s: State) => {
    if (!s.selected || !s.info) {
      el.replaceChildren(h('p', { class: 'lineage-hint' }, 'Select an instruction to see the line of the module it came from and every step that runs it.'));
      return;
    }
    const { func, pc } = parseKey(s.selected);
    const f = s.info.funcs.find((x) => x.index === func);
    const line = f?.lines[pc];
    if (!f || !line) {
      el.replaceChildren();
      return;
    }
    const steps = stepsFor(s.trace, func, pc);
    const next = steps.find((x) => x > s.step) ?? null;
    const where = line.offset >= 0 ? lineColAt(s.source, line.offset) : null;
    const srcLine = where ? s.source.split('\n')[where.line - 1] ?? '' : '';
    const excerpt = where
      ? h(
          'code',
          { class: 'lin-src' },
          srcLine.slice(0, where.col - 1).trimStart(),
          h('mark', null, srcLine.slice(where.col - 1).split(/[\s()]/)[0] || srcLine.slice(where.col - 1, where.col)),
          srcLine.slice(where.col - 1 + (srcLine.slice(where.col - 1).split(/[\s()]/)[0]?.length || 1)),
        )
      : null;
    const parts: Node[] = [
      h(
        'div',
        { class: 'lineage-row' },
        h('span', { class: 'lin-seg' }, h('span', { class: 'pixel-label' }, 'instr'), h('span', { class: 'lin-val' }, `${line.text} · ${f.name} ${String(pc).padStart(2, '0')}`)),
        h('span', { class: 'lin-arrow', 'aria-hidden': 'true' }, '←'),
        h('span', { class: 'lin-seg' }, h('span', { class: 'pixel-label' }, 'source'), h('span', { class: 'lin-val' }, where ? `line ${where.line}, col ${where.col}` : 'no source position')),
        h('span', { class: 'lin-arrow', 'aria-hidden': 'true' }, '→'),
        h('span', { class: 'lin-seg' }, h('span', { class: 'pixel-label' }, 'ran'), h('span', { class: 'lin-val' }, `${steps.length}×`)),
        next !== null ? h('button', { type: 'button', class: 'btn btn-small', 'data-testid': 'lineage-next', onclick: () => goto(next) }, `Next run: step ${next}`) : null,
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => select(null) }, 'Clear'),
      ),
    ];
    if (excerpt) parts.push(h('p', { class: 'lineage-help' }, excerpt));
    parts.push(h('p', { class: 'lineage-help' }, instrHelp(line.text)));
    el.replaceChildren(...parts);
  };
  store.subscribe((s, p) => {
    if (s.selected !== p.selected || s.trace !== p.trace || s.step !== p.step || s.info !== p.info) render(s);
  });
  render(store.state);
}
