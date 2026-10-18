import { walk } from '../lang';
import { byId, h, prefersReducedMotion } from './dom';
import type { Store } from './store';

const DONE_KEY = 'glass-tour-done';

interface TourStep {
  target: string;
  title: string;
  text: string;
  before?: (store: Store) => void;
}

/** Pick a good node to demonstrate linking: the first operator, else the first statement. */
function demoNode(store: Store): number | null {
  const { build } = store.state;
  let found: number | null = null;
  walk(build.program, (n) => {
    if (found === null && (n.type === 'Binary' || n.type === 'Logical')) found = n.id;
  });
  return found ?? build.program.body[0]?.id ?? null;
}

const STEPS: TourStep[] = [
  {
    target: 'panel-source',
    title: 'Write some Pane',
    text: 'Pane is a tiny language made to be looked through. Edit the code here and every stage to the right updates as you type.',
  },
  {
    target: 'panel-tokens',
    title: '1 · Tokens',
    text: 'The lexer reads the text one character at a time and groups it into tokens: keywords, names, numbers, operators. Spaces and # comments disappear here.',
  },
  {
    target: 'panel-tree',
    title: '2 · Syntax tree',
    text: 'A Pratt parser turns the tokens into a tree. Operators that bind tighter sit lower down, which is why 1 + 2 * 3 multiplies first. Open "Binding powers" to see the numbers it uses.',
  },
  {
    target: 'panel-bytecode',
    title: '3 · Bytecode',
    text: 'The compiler walks the tree, children first, and writes simple instructions for a stack machine. Each function gets its own chunk.',
  },
  {
    target: 'panel-vm',
    title: '4 · Virtual machine',
    text: 'The VM runs the instructions one by one. Step forwards and backwards, or press Play, and watch values move on and off the stack.',
  },
  {
    target: 'panel-tree',
    title: 'Everything is linked',
    text: 'We just selected an operator for you. Mint shows the selection in every stage: its tokens, its tree node, its instructions and the VM steps that ran them. Peach shows what the VM will run next.',
    before: (store) => store.select(demoNode(store), 'tour'),
  },
  {
    target: 'examples',
    title: 'Try the examples',
    text: 'Pick an example to explore loops, scope and recursion, or write your own. You can restart this tour any time from the header.',
  },
];

export function mountTour(store: Store, startButton: HTMLButtonElement) {
  let index = 0;
  let card: HTMLElement | null = null;
  let lastTarget: HTMLElement | null = null;

  const close = () => {
    lastTarget?.classList.remove('tour-target');
    card?.remove();
    card = null;
    try {
      window.localStorage.setItem(DONE_KEY, '1');
    } catch {
      // Storage blocked: the tour will offer itself again next time.
    }
    startButton.focus();
  };

  const show = () => {
    const step = STEPS[index]!;
    step.before?.(store);
    lastTarget?.classList.remove('tour-target');
    const target = byId(step.target);
    target.classList.add('tour-target');
    lastTarget = target;
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });

    const titleId = 'tour-title';
    const isLast = index === STEPS.length - 1;
    const next = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => (isLast ? close() : go(index + 1)) }, isLast ? 'Done' : 'Next');
    const content = h(
      'div',
      { class: 'tour-inner' },
      h('p', { class: 'pixel-label tour-count' }, `Tour ${index + 1} / ${STEPS.length}`),
      h('h2', { id: titleId, class: 'tour-title' }, step.title),
      h('p', { class: 'tour-text' }, step.text),
      h(
        'div',
        { class: 'tour-actions' },
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: close }, 'Skip tour'),
        index > 0 ? h('button', { type: 'button', class: 'btn', onclick: () => go(index - 1) }, 'Back') : null,
        next,
      ),
    );
    if (!card) {
      card = h('div', { class: 'tour card', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': titleId, tabindex: '-1', 'data-testid': 'tour' });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        }
      });
      document.body.append(card);
    }
    card.replaceChildren(content);
    next.focus({ preventScroll: true });
  };

  const go = (i: number) => {
    index = i;
    show();
  };

  startButton.addEventListener('click', () => go(0));

  let done: boolean;
  try {
    done = window.localStorage.getItem(DONE_KEY) === '1';
  } catch {
    done = true;
  }
  if (!done) go(0);
}
