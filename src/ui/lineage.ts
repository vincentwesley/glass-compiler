import { lineCol, nodeLabel } from '../lang';
import { h, prefersReducedMotion } from './dom';
import { nodeHelp } from './help';
import type { Store } from './store';

const goTo = (id: string) => () => {
  document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
};

const MAX_LISTED = 4;

/** The strip that explains the current selection across all stages, in words. */
export function mountLineage(root: HTMLElement, store: Store) {
  let nextBtn: HTMLButtonElement | null = null;
  let steps: number[] = [];
  const nextStep = () => steps.find((x) => x > store.state.step) ?? steps[0]!;
  const updateNext = () => {
    if (!nextBtn) return;
    nextBtn.textContent = steps.length === 1 ? `Go to step ${steps[0]}` : `Next run: step ${nextStep()}`;
  };

  const render = () => {
    nextBtn = null;
    const s = store.state;
    const node = s.selected !== null ? s.build.nodes.get(s.selected) : undefined;
    if (!node) {
      root.replaceChildren(
        h('span', { class: 'pixel-label' }, 'Lineage'),
        h('p', { class: 'lineage-hint' }, 'Click any token, tree node, instruction or output line to trace it through every stage.'),
      );
      return;
    }

    const tokens = (s.links.tokensByNode.get(node.id) ?? []).map((i) => s.build.tokens[i]!);
    const instrKeys = s.links.instrsByNode.get(node.id) ?? [];
    steps = s.links.stepsForNode(node.id);
    const { kind, detail } = nodeLabel(node);
    const { line } = lineCol(s.build.source, node.span.start);

    const seg = (stage: string, target: string, ...content: (Node | string)[]) =>
      h('button', { type: 'button', class: `lin-seg lin-${stage}`, onclick: goTo(target) }, h('span', { class: 'pixel-label' }, stage), h('span', { class: 'lin-val' }, ...content));
    const arrow = () => h('span', { class: 'lin-arrow', 'aria-hidden': 'true' }, '→');

    const tokText = tokens.length === 0 ? 'none' : tokens.slice(0, MAX_LISTED).map((t) => t.lexeme).join(' ') + (tokens.length > MAX_LISTED ? ' …' : '');
    const instrText =
      instrKeys.length === 0
        ? 'no code'
        : instrKeys
            .slice(0, MAX_LISTED)
            .map((k) => s.links.instr(k)!.op)
            .join(', ') + (instrKeys.length > MAX_LISTED ? ` +${instrKeys.length - MAX_LISTED}` : '');
    const stepText = !s.build.trace ? 'not run' : steps.length === 0 ? 'never ran' : `ran ${steps.length}×`;

    root.replaceChildren(
      h('div', { class: 'lineage-row' },
        seg('Tokens', 'panel-tokens', h('code', null, tokText)),
        arrow(),
        seg('Tree', 'panel-tree', `${kind}${detail ? ' ' + detail : ''}`, h('span', { class: 'muted' }, ` · line ${line}`)),
        arrow(),
        seg('Bytecode', 'panel-bytecode', instrText),
        arrow(),
        seg('VM', 'panel-vm', stepText),
        steps.length > 0
          ? (nextBtn = h('button', { type: 'button', class: 'btn btn-small', 'data-testid': 'lineage-next', onclick: () => store.set({ step: nextStep(), playing: false }) }))
          : null,
        h('button', { type: 'button', class: 'btn btn-small btn-ghost', onclick: () => store.select(null, 'lineage') }, 'Clear'),
      ),
      h('p', { class: 'lineage-help' }, nodeHelp(node)),
    );
    updateNext();
  };

  store.subscribe((s, prev) => {
    if (s.build !== prev.build || s.selected !== prev.selected) render();
    else if (s.step !== prev.step) updateNext();
  });
  render();
}
