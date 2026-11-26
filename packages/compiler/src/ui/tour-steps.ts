import { walk } from '../lang';
import type { TourStep } from '@glass/ui/tour';
import type { Store } from './store';

export const TOUR_DONE_KEY = 'glass-tour-done';

/** Pick a good node to demonstrate linking: the first operator, else the first statement. */
function demoNode(store: Store): number | null {
  const { build } = store.state;
  let found: number | null = null;
  walk(build.program, (n) => {
    if (found === null && (n.type === 'Binary' || n.type === 'Logical')) found = n.id;
  });
  return found ?? build.program.body[0]?.id ?? null;
}

export const tourSteps = (store: Store): TourStep[] => [
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
    before: () => store.select(demoNode(store), 'tour'),
  },
  {
    target: 'examples',
    title: 'Try the examples',
    text: 'Pick an example to explore loops, scope and recursion, or write your own. You can restart this tour any time from the header.',
  },
];
