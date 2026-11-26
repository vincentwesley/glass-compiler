# Plan: the Glass series

**Computers you can see through.** Six projects, each its own package with its own
tests, page and identity. They share one debugger UI kit (`glass-ui`), one hub
site, and a real pipeline: a Pane program compiles to WebAssembly, runs in the
Glass Wasm debugger, and later boots on Glass Kernel.

Why each choice was made is in [DECISIONS.md](DECISIONS.md), and the checks a
script runs for each package are in [ACCEPTANCE.md](ACCEPTANCE.md).

## Repo layout

```
package.json            npm workspaces root (scripts fan out to every package)
Cargo.toml              Rust workspace (from milestone 2)
site.config.mjs         every page: slug, base path, title, status, pass counts source
scripts/assemble-site.mjs  merges each package's dist/ into one Pages artefact
packages/
  glass-ui/             @glass/ui: shared debugger kit
    src/  dom.ts store.ts highlight.ts stepper.ts theme.ts tour.ts
    styles/  tokens.css base.css components.css debugger.css credits.css
    brand/   logo-resize.ts logo.css   (the draggable Vin's Atelier sign-off)
    vite/    glass-pages plugin (injects credits, sign-off and series nav)
    assets/  creator.webp (owner's art, all rights reserved)
  compiler/             @glass/compiler: Glass Compiler (unchanged behaviour)
  hub/                  @glass/hub: /glass-compiler/series/
  wasm/                 @glass/wasm: crate/ (Rust VM), spec/ (testsuite submodule), src/ (debugger page)
  small-c/  console/  kernel/  tools/                                       [later]
docs/                   series docs (this file, research, decisions, handover…)
docs/screenshots/       README screenshots (kept in place: linked from outside)
```

## The shared debugger kit (glass-ui)

Everything here is extracted from Glass Compiler and stays behaviour-identical
there. The compiler's e2e suite is the regression test.

| Module | What it gives a member | First users |
| --- | --- | --- |
| `dom` | `h()` element builder (HTML + SVG), roving tabindex, `revealInPanel` | all |
| `Store<S>` | typed state with `set` / `subscribe` | compiler, wasm |
| `Highlighter` | mint `is-selected`, lavender `is-related`, peach `is-exec` across panels | compiler, wasm, small-c |
| `Stepper` | ⏮ ◀ ▶ Play ⏭, speed, timeline scrubber with tick marks for "when did the selection run" | compiler, wasm, console, kernel |
| `stack view` | value-stack slots with index, value and label | compiler, wasm |
| `memory view` | hex + ASCII rows, highlighted reads/writes | wasm (in `packages/wasm/src/ui/memory-panel.ts` until its second user, kernel or console) |
| `register view` | named registers with changed-this-step flags | console, kernel [M5] |
| `tour` | guided tour engine (steps supplied by the member) | all apps |
| `theme` | dark default, light toggle, `glass-theme` key | all |
| styles | tokens (house palette + kit aliases), base, components, debugger panels, credits card | all |
| brand | draggable logo sign-off, credits card markup | all |
| `vite` plugin | injects the static credits card, sign-off and "Glass series" nav into each page | all |

## The hub

`/glass-compiler/series/`, built from `packages/hub`, has two parts.

- **Index:**
  - The pitch.
  - The pipeline ladder: Pane → Glass Compiler → Wasm → Glass Wasm → Glass Kernel,
    with Small C feeding in.
  - One card per member, showing status, live grade (spec tests, c-testsuite, test
    ROMs), "Open" and "Source" links.
  - Unbuilt members are dashed pending tiles with no link (house rule).
- **A page per member** (`/series/<slug>/`), once the member exists:
  - What it is.
  - What you can do on it.
  - Its acceptance numbers, read from the member's committed `results.json`.
  - Links to the app, the source and the README.

## Pipeline ("follow this program")

1. **M3.** Glass Compiler gains a Wasm backend. A fifth stage panel shows the
   generated module. Every Wasm instruction carries the Pane node id, so the
   existing linking spine extends to it.
2. **M3.** "Open in Glass Wasm" passes the module in the URL fragment. The Glass Wasm
   page keeps the node-id map, so selecting a Wasm instruction names the Pane source
   it came from.
3. **M6.** Glass Kernel loads the same `.wasm` (or Small C output) as a user
   program.
4. **Follow view.** A shared glass-ui panel shows one source span's lineage across
   members: Pane node, then bytecode, then Wasm instructions, then VM steps, then
   kernel syscalls.

## Per-package CI

See DECISIONS S7: `ci-<package>.yml` files with `paths:` filters, and one
`deploy.yml`. Locally, `npm run verify` checks everything and
`npm run verify -w @glass/<pkg>` checks one package.

## Build order and milestones

Each milestone gets its own PR, merged when its checks pass.

| # | Milestone | Exit criteria |
| --- | --- | --- |
| M1 ✓ | **Restructure, glass-ui, hub** (done 2026-11-26) | Compiler at `/glass-compiler/` behaves exactly as before: same e2e suite green, same CSP, share links work. glass-ui extracted with unit tests. Hub live at `/series/` with a compiler page. Credits card on every page. Docs, ACCEPTANCE and NEEDS-VIN written. |
| M2 ✓ | **Glass Wasm interpreter, first grade** (done 2026-11-26, together with M2b) | Rust decoder, validator, interpreter and `.wast` runner. Testsuite submodule at `wg-1.0`. `i32`, `i64`, control flow (`block`, `loop`, `if`, `br`, `br_if`, `br_table`, `call`, `return`), locals and globals `.wast` files passing. Pass count per file on the page. Debugger: value stack, locals, frames, memory. |
| M2b ✓ | Glass Wasm 1.0 complete (19,270 / 19,270) | Every `wg-1.0` `.wast` file graded (floats, memory, tables, imports, traps, `assert_invalid`, `assert_malformed`). Skips listed with reasons. |
| M3 ✓ | **Pane → Wasm backend** (done 2026-11-26) | Fifth stage panel. Every example compiles to Wasm and runs identically in Glass Wasm and Node's WebAssembly (known-answer tests). "Open in Glass Wasm" link. |
| M4 | **Small C** | chibicc-scoped C subset → Wasm. c-testsuite submodule pinned. Pass count and skip list with reasons on its page. Runs in Glass Wasm. |
| M5 | **Glass Console** | CHIP-8 mode first (test ROMs graded), then Game Boy (CPU, PPU, timers, APU). Blargg and Mooneye pass list on the page. Debugger: registers, memory, tiles, sprites, click-a-pixel, explain-this-frame, four audio channels (muteable, opt-in sound). Only freely licensed homebrew bundled. |
| M6 | **Glass Kernel** | Simulated RV32 machine in Rust/Wasm, a tiny kernel (scheduler, Sv32 page tables and faults, syscalls, a simple FS). Runs Pane and Small C programs. Known-answer tests. |
| M7 | **Language Tools** | Error-recovering Pane parser, LSP server, VS Code extension (.vsix built in CI) and a web playground. Publishing is an owner step. |
| M8 | **Wasm JIT** | x86-64 JIT for hot functions in the CLI build, graded by the same spec tests and benchmarked against the interpreter. |

Stretch: SIMD, threads, later Wasm proposals, Game Boy Color.

## Definition of done for every member

1. ACCEPTANCE checks pass from a script.
2. The `visual-check` and `design-review` skills run, then a stranger's review at
   375px and desktop, dark and light, with fixes made.
3. Axe finds 0 violations, there are no CSP violations, and no request leaves the
   origin.
4. The README has a Credits section and a "provided as is, no warranty" note. The
   LICENSE, author fields, footer, metadata and credits card are all in place.
5. HANDOVER and next-session are updated.
