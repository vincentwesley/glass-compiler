# Research notes

Research done on 2026-10-18 before any code was written. The question was:
what already exists for "seeing inside" a compiler, which teaching languages
and parser write-ups are worth borrowing from, and what would make Glass
Compiler worth using instead.

## Existing compiler and execution visualisers

| Project | What it shows | Take | Avoid |
| --- | --- | --- | --- |
| [Compiler Explorer (godbolt.org)](https://godbolt.org/) | Source on the left, assembly on the right, colour bands linking each source line to the instructions it produced. | The *colour link* between source and output is the single most loved feature. We do the same but per **token / tree node**, not per line, and extend it to the running VM. | Line granularity: one line of source can hide many expressions. |
| [AST Explorer (astexplorer.net)](https://astexplorer.net/) | Parse a file with a real parser, click a node in the tree to highlight its source range and the other way round. | Two-way click linking between source and tree; collapsing big trees. | Shows JSON-ish trees for production grammars: far too much detail for a learner. |
| [Python Tutor](https://pythontutor.com/) ([SIGCSE 2013 paper](https://pg.ucsd.edu/publications/Online-Python-Tutor-web-based-program-visualization_SIGCSE-2013.pdf)) | Steps through execution one line at a time, forwards *and backwards*, with frames and variables drawn as boxes. | Record a full trace first, then let the user scrub through it ("time travel"). Frames drawn with their locals. | Hides the compiler entirely; you only see source lines, not what the machine actually executes. |
| [Web-based bytecode interpreter visualisation (JKU Linz, Herber & Weninger)](https://research.jku.at/en/publications/web-based-bytecode-interpreter-visualization/) ([VISSOFT '25 preprint](https://ssw.jku.at/General/Staff/Weninger/Papers/Weninger_VISSOFT_25_Preprint.pdf)) | Source and bytecode side by side, jump/call arrows, forward/backward stepping, animated stack and registers. | Confirms that stepping *bytecode* (not source lines) with stack animation helps students. Jump targets shown explicitly. | Research tool built around existing bytecode formats; no lexer/parser stages. |
| [danielace1/compiler-visualizer](https://github.com/danielace1/compiler-visualizer) | React app: token table, zoomable AST, three-address code, optimisation, assembly. | Showing every phase on one page. | Phases are separate tabs, not linked to each other; no execution. |
| [CallumTodd7/compiler-visualization](https://github.com/CallumTodd7/compiler-visualization) | Desktop app animating lexer, parser and x86 code generation. | Animating the lexer's progress through the source. | Desktop only; no execution. |
| ["Making compiler magic visible" (dev.to)](https://dev.to/sudharsan01/making-compiler-magic-visible-my-interactive-compiler-visualization-tool-5dj0) | Student project with phase-by-phase views. | — | Same "tabs per phase" pattern. |

A project called GLASSBOX turned up in search results with a similar
architecture (lexer → parser → bytecode → stack VM with a trace). It could not
be verified and none of its code was looked at or used.

### What nobody does (our opportunity)

Every tool above shows **one or two** stages, or shows all stages but **not
linked**. Nothing lets you click a single `+` in your source and see, at the
same time, the token it was lexed as, the tree node it became, the `ADD`
instruction it compiled to, and every VM step that executed that instruction.
That end-to-end lineage is Glass Compiler's reason to exist.

## Teaching languages

| Language | Notes | Take | Avoid |
| --- | --- | --- | --- |
| Lox — [*Crafting Interpreters*](https://craftinginterpreters.com/) by Robert Nystrom | Tree-walker (jlox) then single-pass bytecode compiler + stack VM (clox). The best free resource on the subject. | Opcode set (`CONSTANT`, `GET_LOCAL`, `JUMP_IF_FALSE`, `LOOP`, `CALL`, `RETURN`), locals as stack slots, call frames whose base points into the value stack. | clox's single-pass compiler **skips the AST** — great for speed, bad for visibility. We keep an explicit tree so it can be drawn. Classes/closures are too much for a first look. |
| Monkey — [*Writing an Interpreter in Go*](https://interpreterbook.com/) / [*Writing a Compiler in Go*](https://compilerbook.com/) by Thorsten Ball | Pratt parser → AST → bytecode → stack VM. | The pipeline shape (separate lexer, Pratt parser, AST, compiler, VM) is exactly what we want to visualise. | Closures and hash literals: out of scope for the MVP. |
| [Wren](https://wren.io/) | Small production language with a very readable VM. | Clear naming in opcode listings. | Classes-first design. |
| Lua | Statement syntax without much punctuation. | `fn`/`while`/`if` with braces feels familiar to JS/Rust/Go learners. | Lua's optional semicolons create parse ambiguities that would be confusing to explain. |

## Pratt parser write-ups

- Vaughan Pratt, ["Top Down Operator Precedence" (1973)](https://dl.acm.org/doi/10.1145/512927.512931) — the original paper: attach parsing behaviour to tokens, not grammar rules.
- Douglas Crockford, ["Top Down Operator Precedence"](https://crockford.com/javascript/tdop/tdop.html) — popularised it in JavaScript.
- Bob Nystrom, ["Pratt Parsers: Expression Parsing Made Easy"](https://journal.stuffwithstuff.com/2011/03/19/pratt-parsers-expression-parsing-made-easy/) — prefix ("nud") and infix ("led") parselets.
- Alex Kladov (matklad), ["Simple but Powerful Pratt Parsing"](https://matklad.github.io/2020/04/13/simple-but-powerful-pratt-parsing.html) — the clearest modern version: each operator has a **pair of binding powers** (left, right); left-associativity is `right = left + 1`, right-associativity is `right = left - 1`. One loop, no precedence-climbing tables.
- Eli Bendersky, ["Top-Down operator precedence parsing"](https://eli.thegreenplace.net/2010/01/02/top-down-operator-precedence-parsing) — worked Python example.
- [MoonBit: Pratt parser](https://www.moonbitlang.com/blog/pratt-parser) — another binding-power explanation with diagrams.
- [Cheng & Parreaux, ECOOP 2026](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ECOOP.2026.30) — uses Pratt parsing as a pedagogical introduction.

**Decision:** follow matklad's binding-power-pair formulation and *show the
binding-power table in the UI*, so learners can see why `1 + 2 * 3` nests the
way it does.

## Technology notes

- **CodeMirror 6** injects its base theme through `style-mod`. In a normal
  document that is a `<style>` element, which a `style-src 'self'` CSP blocks
  (confirmed in Chromium with Playwright). Inside a shadow root it uses
  constructable stylesheets instead, which the CSP allows, so the editor is
  mounted in a shadow root (see `docs/DECISIONS.md`, D11).
- **GitHub Pages ignores `_headers` files**, so CSP must be a
  `<meta http-equiv="Content-Security-Policy">` tag. `frame-ancestors` cannot be
  set from a meta tag; that limitation is accepted.
- **Fontsource** packages ship `.woff2` files plus the OFL licence; Vite copies
  them into `dist/assets`, so no Google Fonts request is ever made.
- **Playwright** in this cloud session has Chromium build 1194 pre-installed,
  which matches `@playwright/test@1.56.1`; that version is pinned so no browser
  download is ever needed locally.

## Worth installing later (not needed for the MVP)

- `@vitest/coverage-v8` — coverage reports for the language core.
- `fast-check` — property-based tests (e.g. "pretty-print → parse round-trips").
- `@lhci/cli` (Lighthouse CI) — performance/a11y budgets in CI.
- Running Playwright + axe in CI (would need `npx playwright install chromium`
  in the workflow, which is fine on GitHub's runners but adds ~1 min).
- A GitHub Pages custom domain, if one is ever wanted (repo setting, not code).
