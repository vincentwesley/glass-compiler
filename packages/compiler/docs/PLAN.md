# Plan

## Architecture

```
source text
   │  src/lang/lexer.ts      hand-written scanner → Token[] (kind, lexeme, span)
   ▼
tokens
   │  src/lang/parser.ts     recursive descent statements + Pratt expressions → Program (AST)
   ▼                         also fills token → owning-node map
syntax tree
   │  src/lang/compiler.ts   AST → Program { chunks: main + one per fn }, each Instr has nodeId
   ▼
bytecode
   │  src/lang/vm.ts         stack VM, records Trace (snapshot before every instruction)
   ▼
trace → UI scrubs through it
```

`src/lang/index.ts` runs the whole pipeline and returns one `Build` object with
every stage plus diagnostics. It has no DOM dependencies and is fully unit-tested.

UI (`src/ui/`):

- `selection.ts` — a tiny store holding the selected **node id** (plus which
  stage the click came from) and the current VM step. Every panel subscribes.
- `link.ts` — builds indexes from a `Build`: node → tokens, node → instructions,
  instruction → steps, node → parent, offset → token.
- `editor.ts` — CodeMirror 6 with lexer-driven highlighting, error underlines and
  selection highlights.
- `tokens-panel.ts`, `tree-panel.ts` (+ `tree-layout.ts`), `bytecode-panel.ts`,
  `vm-panel.ts` — one per stage.
- `lineage.ts` — the "lineage" strip that explains the current selection in words
  (token → node → instructions → steps).
- `tour.ts`, `theme.ts`, `examples.ts`, `main.ts`.

## MVP scope

- Pane language as specified in `docs/DECISIONS.md` (D2, D3).
- Live compile as you type; errors underlined in the editor and listed.
- Four linked stage panels; click / keyboard-select anything to light up its
  counterparts everywhere.
- VM controls: step, back, play/pause, reset, run to end, scrubber; stack,
  frames with locals, globals and output.
- Five built-in examples and a guided tour.
- Dark default, mint light theme toggle, reduced-motion support, 375px to desktop.
- Strict CSP, no network use, MIT licence, README with screenshots.

## Milestones

| # | Milestone | Done when |
| --- | --- | --- |
| M0 | Research and scaffolding | docs written, configs in place, CI and deploy workflows, `npm ci --ignore-scripts` works |
| M1 | Language core | lexer, parser, compiler, VM with thorough unit tests; examples run correctly |
| M2 | UI shell and stages | all panels render, live recompile, VM controls, house style, both themes |
| M3 | Linking, examples, tour | cross-stage selection everywhere, lineage strip, tour, footer |
| M4 | Verify and ship | Playwright + axe pass at 375px and desktop in both themes, screenshots in README, PR opened |
