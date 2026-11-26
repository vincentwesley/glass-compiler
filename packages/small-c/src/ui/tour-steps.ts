import type { TourStep } from '@glass/ui/tour';

export const TOUR_DONE_KEY = 'glass-small-c-tour-done';

export const TOUR_STEPS: TourStep[] = [
  { target: 'panel-source', title: 'C, compiled as you type', text: 'Small C is a compiler for most of C, in the spirit of chibicc. Pick an example or write your own; every keystroke runs the whole compiler again.' },
  { target: 'panel-tokens', title: '1 · Tokens', text: 'The lexer cuts the source into tokens. Click one to find the part of the tree it belongs to.' },
  { target: 'panel-tree', title: '2 · The typed tree', text: 'The parser builds a tree and works out every type. Conversions C makes on its own (int to double, arrays to pointers) are shown and marked implicit.' },
  { target: 'panel-wasm', title: '3 · WebAssembly', text: 'Your functions as WebAssembly. Select an instruction to see the C it came from. printf and malloc are C as well, linked in below.' },
  { target: 'panel-run', title: '4 · Run', text: "The module runs on this browser's own engine. Open in Glass Wasm to step through it one instruction at a time." },
  { target: 'panel-grade', title: 'Graded for real', text: 'c-testsuite, 220 C programs from the tcc and scc compilers, compiled and run on two engines. Anything that does not pass is listed with the reason.' },
];
