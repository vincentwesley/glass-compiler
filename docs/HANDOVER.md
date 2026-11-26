# Handover

Current state of the Glass series. The plan is in [PLAN.md](PLAN.md), the reasons
in [DECISIONS.md](DECISIONS.md), the scripted checks in
[ACCEPTANCE.md](ACCEPTANCE.md), and the owner's to-do list in
[NEEDS-VIN.md](NEEDS-VIN.md). Glass Compiler's own history (its M0–M4 and the
robustness pass) is in `packages/compiler/docs/`.

## Milestones

| # | Milestone | State |
| --- | --- | --- |
| M1 | Restructure into a series monorepo, glass-ui, hub | **Done** (2026-11-26) |
| M2 + M2b | Glass Wasm: the whole WebAssembly 1.0 testsuite, debugger page | **Done** (2026-11-26) |
| M3 | Pane → Wasm backend, "Open in Glass Wasm" | **Done** (2026-11-26) |
| M4 | Small C | **Done** (2026-11-26) |
| M5 | Glass Console | Next |
| M6–M8 | Glass Kernel, Language Tools, JIT | Planned |

## M1: what changed

- **Workspaces.** npm workspaces: `packages/glass-ui`, `packages/compiler` and
  `packages/hub`. Glass Compiler moved with its git history.
- **glass-ui extracted from Glass Compiler.** It holds:
  - dom helpers, the theme toggle, a typed `Store` and the selection `Highlighter`;
  - the `Stepper` (step controls, timeline, play timer) and the tour engine;
  - the house styles and the draggable sign-off;
  - the credits card and the `glass-pages` Vite plugin for shared static chrome.
- **The restructure is pixel-identical.** Compiler screenshots before and after
  matched pixel for pixel at 1440px and 375px in dark and light, and its e2e +
  axe suite passed unchanged.
- **Deliberate changes to Glass Compiler after that:**
  - The house **credits card** at the bottom of the page.
  - A "part of the Glass series" link in the footer.
- **Hub** at `/glass-compiler/series/`:
  - The pipeline.
  - Six member cards. Planned members are dashed tiles with no link.
  - A Glass Compiler page showing its recorded grade.
  - It is static HTML rendered from `site.config.mjs` at build time.
- **Site assembly** (`scripts/assemble-site.mjs`) puts each package's `dist/`
  where it is served. `scripts/check-site.mjs` checks CSP, credits, links and
  same-origin on every page.
- **CI:** one workflow per package with path filters (`ci-compiler.yml`,
  `ci-glass-ui.yml`, `ci-hub.yml`). `deploy.yml` now uploads `_site/glass-compiler`.
- **Docs:**
  - Series research, plan, decisions, acceptance and owner to-do list.
  - `THIRD_PARTY_NOTICES.md`.
  - A new series README at the root; the compiler's README moved to
    `packages/compiler/`.
  - LICENSE now reads "Copyright (c) 2026 Vin's Atelier (Vincent Wesley)".

## M2: Glass Wasm

- **The VM.** `packages/wasm/crate` is a WebAssembly 1.0 virtual machine in Rust
  with no dependencies. It has:
  - a text-format parser and a binary decoder;
  - a validator;
  - a steppable interpreter with explicit stack, frames and labels;
  - a `.wast` runner and a debug-session API;
  - C-ABI exports for the browser.
- **The testsuite.** `packages/wasm/spec` is a shallow submodule of
  WebAssembly/spec at tag `wg-1.0`. The 73 core files pass completely:
  **19,270 / 19,270 commands**. That holds natively and when the VM itself runs
  as WebAssembly in Node or the browser (about 0.5 s for the whole suite).
- **The debugger page** at `/glass-compiler/wasm/` has:
  - a module editor and run bar;
  - the code panel (mint selection, peach for what runs next);
  - the machine (stack, frames and locals, open blocks with `br` depths,
    globals, host output);
  - a memory hex view (reads lavender, writes peach);
  - a lineage bar (instruction ← source line → times run);
  - six examples with known answers, `#wat=` share links and a tour;
  - the recorded testsuite table, plus a button that runs the whole suite live.

  Its CSP adds only `'wasm-unsafe-eval'`, and the site check enforces that only
  Wasm pages may.
- **Hub.** Glass Wasm is live: its card, a pipeline link and a member page with
  its grade.
- **glass-ui.** Share-link encoding and share-row styles moved in now that two
  pages use them. The `glass-pages` plugin gained `extraPublic` for a member's
  own public files.
- **CI.** `ci-wasm.yml` runs fmt, clippy, cargo tests, the spec-results check,
  lint, typecheck, unit tests and the build. The hub CI and the deploy check out
  submodules and use the pinned Rust toolchain.

## M3: the pipeline, Pane → WebAssembly → Glass Wasm

- **Back end.** `packages/compiler/src/lang/wasm/` holds:
  - an encoder and a small assembler;
  - the runtime library (NaN-boxed values, Pane's rules and error messages, in
    WebAssembly);
  - the code generator (mirrors the bytecode compiler);
  - the JavaScript `pane` host.

  Design: DECISIONS S15, with the deliberate differences in S16.
- **Glass Compiler.**
  - A fifth stage, WebAssembly, shows the module's Pane functions with decoded
    constants, linked both ways to tree nodes. The runtime library sits behind a
    disclosure.
  - A live check runs the module on the browser's own engine and confirms the
    same output as the VM. It is skipped for programs that hit the step limit.
  - An **Open in Glass Wasm** link carries the module in `#wasm=`.
  - The CSP gains `'wasm-unsafe-eval'` (S8).
- **Glass Wasm.**
  - It reads the `name`, `glass.source`, `glass.map` and `glass.globals`
    sections, and provides the `pane` host (`pane_host.rs`, with JavaScript
    number formatting ported in `jsnum.rs`).
  - In compiled-module mode it shows the Pane source, decodes values as Pane
    values, names globals, links instructions to Pane lines, and links back to
    "Edit it in Glass Compiler".
- **Three-way grade.** Every example and error case is identical on the
  bytecode VM, Node's WebAssembly and Glass Wasm. Number formatting matches
  JavaScript on 100,000 random values.

## M4: Small C

- **The compiler** (`packages/small-c/src/lang/`), in TypeScript, in the shape of
  chibicc:
  - a lexer and a preprocessor with hide sets (`#include` of built-in headers,
    `#`, `##`, `__VA_ARGS__`, `#if`, `#line`, `#pragma push_macro`);
  - a parser that types every node and makes C's implicit conversions explicit;
  - a code generator to WebAssembly: named locals for scalars, a stack frame for
    the rest, structured control flow, and a `br_table` dispatch loop for `goto`
    and Duff's device (DECISIONS S17, S18).
- **The C library is C** (`libc.ts`), compiled with each program: printf with
  exact floating point, malloc, strings, ctype, stdlib, maths (fdlibm kernels),
  and files in memory. Two host imports: `c.write` and `c.exit` (S19).
- **Grade:** c-testsuite (pinned submodule): **220 / 220 on Node's WebAssembly and
  220 / 220 on Glass Wasm**, no skips (S20). `node scripts/record-results.mjs
  small-c` records both, plus the unit tests.
- **Page** at `/glass-compiler/small-c/`: editor, tokens, typed tree (implicit
  conversions marked), WebAssembly (linked both ways), Run (in a worker, stopped
  after 4 s), grade, share links, tour, Open in Glass Wasm.
- **Glass Wasm** gained the `c` host (`c_host.rs`), an **Exited** status with the
  exit code, output that shows lines as they are printed, `gw_run_program` for
  grading, and C-source mode with "Edit it in Small C". Its step limit went from
  200,000 to 1,000,000.
- **Shared:** the Wasm encoder moved to `packages/wasm-encode` (f32 constants,
  `br_table`, owned exported memory and a table base added, with its own tests).
- **Hub:** Small C is live, with a member page, its grade and the C row of the
  pipeline linked. CI: `ci-small-c.yml`.

## Verification for M4 (local, 2026-11-26)

- `npm run verify` passes. Unit tests: glass-ui 11, wasm-encode 6, Glass
  Compiler 251, Glass Wasm 30 (crate 26), Small C 29, hub 8.
- c-testsuite 220 / 220 on both engines; `results.json` recorded.
- `npm run check:site` passes on 7 pages.
- e2e: Small C 18 pass (2 skipped: the screenshot generator), hub and pipeline
  32, Glass Wasm 25, Glass Compiler 80 (4 skipped).
- `visual-check` on the Small C page and its hub page: 0 axe violations, 0
  off-origin requests, 0 reduced-motion failures in both themes.
- `design-review`, 2 rounds: fixed touch targets for tree and instruction rows
  (48px on touch screens) and moved the new spacing onto the kit tokens. Left:
  the Run panel's output box is mostly empty for short programs (nit).

## Verification for M1 (local, 2026-11-26)

- `npm run verify` passes: typecheck, lint, 11 + 167 + 8 unit tests, build.
- `npm run check:site` passes (3 pages), and `npm run check:results` passes.
- Glass Compiler e2e: 72 pass, 4 skipped (the screenshot generator).
- Hub e2e: 20 pass, covering axe, both themes, both widths, no-JS and navigation.
- `visual-check` skill on all three pages at 375, 768 and 1280, dark and light:
  see the qa report in the PR description.

## Verification for M2 (local, 2026-11-26)

- `cargo fmt --check`, `cargo clippy -D warnings` (native and wasm32) and 22
  Rust unit tests pass.
- Spec testsuite: 19,270 / 19,270, and `results.json` is current.
- `npm run verify` passes: lint, typecheck, unit tests (glass-ui 11,
  compiler 167, wasm 11, hub 8), and the build of every package.
- `npm run check:site` passes on 5 pages.
- e2e:
  - Glass Wasm 25 pass, including the full testsuite run in the browser.
  - Hub 24 pass.
  - Glass Compiler 72 pass, 4 skipped (the screenshot generator).
- `visual-check` on the Glass Wasm page and the hub pages: 0 axe violations, 0
  off-origin requests, 0 reduced-motion failures. `design-review` found no
  blockers or highs after fixing the edge-to-edge spec card and the open-blocks
  box.

## Verification for M3 (local, 2026-11-26)

- Unit tests:
  - Glass Compiler: 251 (84 new for the back end).
  - Glass Wasm: 27 (crate: 25).
  - Hub: 8.
  - glass-ui: 11.
- e2e:
  - Glass Compiler: 80 pass (new `wasm-stage.spec.ts`), 4 skipped.
  - Hub and pipeline: 28 pass.
  - Glass Wasm: 25 pass.
- `check:site` passes on 5 pages.
- `visual-check` on Glass Compiler and Glass Wasm: 0 axe violations, 0
  off-origin requests, 0 reduced-motion failures.
- `design-review`: fixed constant comments being cut off on phones and
  unreadable raw `i64` values in Glass Wasm (now decoded as Pane values).

## Known issues

- `npm audit` reports moderate advisories in the typescript-eslint dev chain
  (dev only, not shipped); Dependabot tracks it.
- Very wide syntax trees (long programs) still need horizontal scrolling.
- CSP `frame-ancestors` can't be set from a meta tag, and GitHub Pages can't send
  headers, so pages could be framed by another site.
- The vendored `visual-check` script launches Playwright's expected Chromium
  build. In this sandbox, run it with `PLAYWRIGHT_BROWSERS_PATH` pointing at a
  folder that symlinks `chromium_headless_shell-<expected>` to the installed
  build (see next-session.md).

## Done and verified

- Glass Compiler live at https://vincentwesley.github.io/glass-compiler/, with all
  old links and `#code=` share links unchanged.
- Glass Wasm live at `/glass-compiler/wasm/`: the full WebAssembly 1.0 testsuite
  passes (19,270 / 19,270), and it debugs compiled Pane and C programs.
- Pane → WebAssembly in Glass Compiler (M3).
- Small C at `/glass-compiler/small-c/`: c-testsuite 220 / 220 on two engines.
- Series monorepo with glass-ui, the hub, per-package CI and the deploy of the
  assembled site.
- Research, plan, decisions, acceptance checks, notices and owner steps written.

## Not done, and why

- Glass Console (M5) is next. Glass Kernel, Language Tools and the JIT are not
  started; they follow in order (PLAN.md).
- Small C leaves out threads and atomics, `_Complex`, `setjmp`, wide-character
  library functions, computed goto and `sizeof` of a variable-length array, and
  `long double` is a `double` (DECISIONS S17). Files exist only in memory until
  Glass Kernel.
- Pane string ordering in WebAssembly is by code point. It differs from the VM's
  UTF-16 order only for characters above U+FFFF against U+E000 to U+FFFF
  (DECISIONS S16).
- Wasm proposals beyond 1.0 (multi-value, sign extension, bulk memory, SIMD and
  so on): not attempted yet, by design (1.0 first).
- The "follow this program" view across members is not built yet: the links
  between pages exist (Open in Glass Wasm, Edit it in…), a single view that
  follows one program through every stage waits for Glass Kernel (M6).
- e2e tests run locally, not in CI. That's a deliberate saving of Actions
  minutes (house rule); CI runs typecheck, lint, unit tests, builds and the site
  check.

## What needs Vin

- Nothing is required. If `main` has branch protection, update the required
  check names, now including **Glass Wasm** and **Small C** (NEEDS-VIN.md,
  Recommended 1).
