# Decisions: the Glass series

Series-wide decisions, numbered S1, S2 and so on. Glass Compiler's own decisions
(D1–D21) now live in
[`packages/compiler/docs/DECISIONS.md`](../packages/compiler/docs/DECISIONS.md).
Each entry says what we chose, why, and what would change our mind.

## S1. npm workspaces plus a Cargo workspace, no task runner

The root `package.json` declares `"workspaces": ["packages/*"]`. Rust crates join one
root `Cargo.toml` workspace. We use no Turborepo, Nx or pnpm.

- npm is already the house tool. It keeps one committed lockfile and
  `npm ci --ignore-scripts` keeps working unchanged.
- With about eight packages and a shallow graph, a task runner's cache saves
  seconds, but it would add a binary dependency with its own install and update
  story.
- Per-package isolation comes from CI path filters (S7) and from each package
  owning its scripts (`typecheck`, `lint`, `test`, `build`). The root runs them all
  with `npm run <script> --workspaces --if-present`.
- **Revisit if** a full local `npm run verify` takes over about two minutes, or the
  graph gets deep.

## S2. Keep the repo name and the Pages URL; the series lives under it

| Path | What |
| --- | --- |
| `/glass-compiler/` | Glass Compiler, exactly where it has always been |
| `/glass-compiler/series/` | The hub: the series, the pipeline, and a page per member |
| `/glass-compiler/wasm/` | Glass Wasm (from milestone 2) |
| `/glass-compiler/small-c/`, `/kernel/`, `/console/`, `/tools/` | Later members, each once it exists |

- Pages project-site URLs do not redirect after a repo rename (RESEARCH §2).
  Renaming to `glass` would break every existing link, including the portfolio,
  DevPulse, the GitHub profile and shared `#code=` links. A meta-refresh workaround
  loses the fragment.
- Keeping the compiler at the root path means nothing that works today can break.
- **What would change it:** a custom domain (for example `glass.vwesley.dev`). Then
  the hub could move to `/` and the compiler to `/compiler/`. This is optional and
  written up in `NEEDS-VIN.md`. Nothing in the code hard-codes the
  `/glass-compiler/` prefix outside `site.config.mjs` (see S5).

## S3. Layout: one folder per member under `packages/`

```
packages/
  glass-ui/     shared debugger kit (TypeScript + CSS, no framework)
  compiler/     Glass Compiler (Pane → tokens → tree → bytecode → VM)
  hub/          the series site
  wasm/         Glass Wasm: crate/ (Rust VM, CLI) + web/ (debugger page)
  ...           small-c, kernel, console, tools as they arrive
site.config.mjs every page's base path and status, read by the builds and the hub
scripts/        site assembly and checks shared by all packages
```

Each member keeps its own `package.json`, README, LICENSE, tests, docs and page.
Rust lives inside its member (`packages/wasm/crate`) rather than in a separate
`crates/` tree, so a member is one folder you can read top to bottom.

## S4. glass-ui is framework-free source, consumed directly

`@glass/ui` ships TypeScript and CSS. Each app's Vite build bundles it, so there is
no separate build step and no published artefact. It holds only what at least two
pages use, extracted from Glass Compiler and kept behaviour-identical:

- **dom:** `h()`, roving tabindex, `revealInPanel`.
- **Store:** a typed state container.
- **Highlighter:** the mint, lavender and peach selection classes.
- **Stepper:** step back/forward, play, speed, the timeline scrubber with tick marks.
- **Panels:** stack slots and labelled value lists.
- **Theme toggle and tour engine.**
- **Styles:** tokens, base, components, the debugger panel CSS.
- **Brand:** the draggable logo and the credits card.

A new panel type joins glass-ui when its second user arrives: the memory hex view
and register file come with Glass Wasm. No React, so the kit carries no runtime
dependency and works under the strict CSP.

## S5. Shared page chrome is static HTML, injected at build time

`glass-ui/vite` exports a small Vite plugin. It replaces marker comments such as
`<!-- glass:credits -->` in each page's `index.html` with the shared credits card,
sign-off and series nav. Every page then has the same footer and credits with no
JavaScript (they work in `<noscript>`), and there is no inline script or style.
Base paths and member status come from `site.config.mjs`, so the hub's cards and
each page's "part of the Glass series" link can't drift apart.

## S6. Every page ends with the house credits card

The credits card (`vendor/house/credits/`) goes at the bottom of every page,
Glass Compiler included. Glass Compiler already has the draggable sign-off, so per
UPGRADING step 6 the card's static logo and "Logo by" block are left out and the
sign-off sits in the card's brand slot. The card's kit token names (`--fg`,
`--bg-elev`, `--firefly`, …) are mapped onto the project's tokens in
`glass-ui/styles/tokens.css`. Nothing is copied twice and nothing is recoloured.

## S7. CI: one workflow per package, one deploy

- `ci-<package>.yml` runs on PRs and pushes to `main`, filtered by `paths:` to
  the package, `glass-ui` (for its dependents), the root lockfile and its own
  workflow file. A change to Glass Wasm doesn't run Glass Compiler's checks.
- `ci-glass-ui.yml` runs glass-ui's own tests.
- `deploy.yml` builds the whole site, because a Pages artefact is the whole site.
  It runs only on `main` and when site sources change.
- Actions stay SHA-pinned with `permissions: contents: read`. No
  `pull_request_target`. Minutes are limited, so CI confirms rather than tests:
  everything is verified locally before a push (house rule).

## S8. Rust to Wasm with cargo alone, and a narrow CSP change

- Crates build with `cargo build --target wasm32-unknown-unknown --release`. They
  export a small C-style API over linear memory, and a hand-written TypeScript
  loader (about 100 lines, unit-tested) wraps it. No wasm-pack or wasm-bindgen
  (RESEARCH §1).
- Pages that run Wasm add `'wasm-unsafe-eval'` to `script-src`. It allows
  compiling WebAssembly and nothing else; JavaScript `eval` stays blocked.
- Since M3 that includes Glass Compiler, which runs its WebAssembly back end
  on the browser's own engine to check it matches the VM, and (since M4) Small
  C, which runs the programs it compiles. The hub keeps the exact original
  policy, and `check-site` enforces which pages may add it.
- Small C is also the only page allowed `worker-src 'self'`: its Run panel runs
  the program in a Web Worker so a program that never ends can be stopped
  (S19). `check-site` enforces that too.

## S9. Glass Wasm reads the official testsuite itself

- `packages/wasm/spec` is a shallow git submodule of
  [WebAssembly/spec](https://github.com/WebAssembly/spec) pinned at tag `wg-1.0`
  (977f970), and the tests are its `test/core`. (The WebAssembly/testsuite mirror
  has no tags, and its `main` mixes in 2.0 and 3.0 features; the spec repo's
  `wg-1.0` tag is the exact 1.0 snapshot the mirror copies.)
- The VM includes its own `.wast` parser (RESEARCH §5). The same Rust code runs
  the suite in `cargo test`, in the CLI and in the browser.
- The page shows passes per `.wast` file, computed live. A committed
  `results.json` from the CLI is the fallback and lets the hub show the count
  without loading the VM.
- Results are never edited by hand. A test that is skipped is listed with its
  reason.

## S10. Build order

The order follows the brief, with one refinement: **the Pane-to-Wasm backend comes
right after the Wasm interpreter reaches its first milestone**, before the
interpreter is complete. Two reasons:

1. The backend only needs the integer, control-flow, locals, globals and call
   subset that milestone 2 grades.
2. The backend, the interpreter and Node's own WebAssembly give three independent
   implementations that cross-check each other early.

## S11. Names, licences and credit

- npm packages are `@glass/<member>`, all `private: true` (nothing is published
  to npm).
- Every package and the root carry the MIT LICENSE: `Copyright (c) 2026 Vin's
  Atelier (Vincent Wesley)`.
  - The brief asks for the studio name.
  - The house rules keep the legal name where it's legally needed, which a
    copyright line is.
  - Writing both satisfies both.
- Every `author` field is `Vin, Vin's Atelier (https://vwesley.dev)`, and Cargo
  `authors` uses the same string.
- Every third-party item (npm dependency families, fonts, testsuites, ROMs) is
  listed in the root `THIRD_PARTY_NOTICES.md`.

## S12. Docs: series docs at the root, member docs in the member

- `docs/`: series research, plan, decisions, acceptance, handover, the next-session
  note and the owner's to-do list.
- `packages/<member>/docs/`: that member's own design notes.
- `docs/screenshots/` stays where it is, because the README and possibly
  external pages link to it.

## S13. The debugger replays instead of recording

Stepping backwards and scrubbing ask the VM for "the machine after step n". The
session re-runs the call from a fresh instance and stops at n. A run is
deterministic, so this is exact, and it costs nothing in memory. Glass Compiler
stores a snapshot per step, which is fine for its small VM; WebAssembly programs
touch up to 64 KiB pages of memory, so snapshots would cost too much. Measured on 2026-11-26 with the VM itself
running as WebAssembly in Node, it does about 34 million steps a second. A
replay to step 199,000 of a loop took 11.6 ms (a full run for the total plus the
partial run), so scrubbing anywhere under the step limit is instant. The limit
was 200,000 steps; M4 raised it to 1,000,000 because a C program's printf runs
thousands of instructions (the trace costs 8 bytes a step, so 8 MB at most).
A compact per-step
trace (function, pc) of the full run drives the timeline ticks and "follow
selection".

## S14. How the testsuite is graded

- `assert_return*` results are compared bit for bit, with NaN patterns as the
  spec defines them.
- `assert_trap` and `assert_exhaustion` need the trap message to start with the
  expected text, as the reference interpreter checks.
- `assert_malformed`, `assert_invalid` and `assert_unlinkable` pass when the
  module is rejected at the right stage: text or binary decoding, validation, or
  linking and instantiation. Wording isn't compared. Independent implementations
  word their errors differently, and the reference runner doesn't require it
  either.
- Nothing is skipped. If a test is ever skipped, it is listed on the page with
  its reason.

## S15. Pane to WebAssembly: values in the module, five host services

Glass Compiler compiles Pane to a WebAssembly 1.0 module
(`packages/compiler/src/lang/wasm/`).

- **Values are NaN-boxed `i64`s.**
  - A number is its own `f64` bits. NaN results are made canonical, so they
    never collide with a box.
  - nil, false, true, strings (a pointer to `[len][UTF-8]`), functions (arity
    and table index) and "not declared yet" are tags in the unused NaN space.
  - One value type means every Pane function is `(i64…) → i64`, so dynamic
    calls are a `call_indirect`.
- **The runtime library lives inside the module.** About 40 small functions
  (`$rt.add`, `$rt.lt`, `$rt.quote`, …) implement Pane's rules in WebAssembly:
  types, `+` on text, equality, comparisons, and the VM's exact error messages,
  JSON-style quoting included. They are visible and steppable in Glass Wasm.
- **The host provides only:**
  - the shared memory;
  - printing a line;
  - stopping with an error;
  - formatting a number;
  - the exact float remainder (WebAssembly 1.0 has no `f64.rem`).

  Number formatting must match JavaScript's `String(n)` and `toPrecision(12)`
  digit for digit. That is a bignum-sized algorithm, so it belongs in a host
  library, like libc's printf. Two implementations exist: JavaScript
  (`host.ts`) and Rust (`pane_host.rs`, `jsnum.rs`). The Rust one is tested
  against JavaScript on 100,000 random values, ties included.
- **Debug info** goes in custom sections that any engine ignores:
  - the standard `name` section;
  - `glass.source` (the Pane text);
  - `glass.map` (a UTF-8 source offset for every instruction);
  - `glass.globals` (Pane's variable names).
- **Graded three ways.** Every example and every runtime-error case gives
  identical output and error text on the bytecode VM, on the browser's or
  Node's own WebAssembly, and on Glass Wasm.

## S16. Where the WebAssembly build may differ from the VM (on purpose)

- **Step limits.** The VM stops at 10,000 steps and Glass Wasm at 1,000,000, but a
  browser's own engine has no limit. So Glass Compiler only runs the module on
  the browser's engine when the VM finished, and a runaway loop can never freeze
  the tab.
- **String ordering.** The VM compares strings by UTF-16 code units (JavaScript);
  the module compares UTF-8 bytes, which is code-point order. They differ only
  when comparing a character above U+FFFF with one between U+E000 and U+FFFF.
  Matching JavaScript exactly would need UTF-16 conversion in every comparison,
  so the difference is documented here instead.


## S17. Small C: what it is, and the target it compiles for

- **Scope.** Most of C11 as real programs use it, in the shape of chibicc
  (RESEARCH §4): a lexer, a preprocessor with Prosser's hide-set algorithm, a
  recursive-descent parser that types every node as it builds it, and a code
  generator straight to WebAssembly. Written in TypeScript so it runs in the
  page. GNU extensions that c-testsuite uses are supported (statement
  expressions, `, ## __VA_ARGS__`, range designators, `__attribute__` is
  skipped). Left out: threads and atomics, `_Complex`, `setjmp`, wide-character
  library functions, computed goto, `sizeof` of a variable-length array.
- **Target: wasm32, ILP32**, as clang's wasm32: `char` 1 (signed), `short` 2,
  `int` and `long` 4, `long long` 8, pointers 4. `long double` is a plain
  `double` (clang uses 128 bits; nothing here needs it, and a software 128-bit
  float would dwarf the rest of the library).
- **The C library is C**, compiled by Small C with each program, and only the
  functions a program reaches are kept (a hello world is about 9 KB). This keeps
  the "see through" promise: printf is there to read in Glass Wasm. Its `%f`,
  `%e` and `%g` print a double's exact value, expanded with big-number
  arithmetic, rounded half to even as glibc does; the maths functions use
  fdlibm's polynomial kernels.
- **Shared encoder.** The WebAssembly encoder moved from Glass Compiler to
  `packages/wasm-encode` now that two compilers use it.

## S18. Small C's code shape

- **Locals.** A scalar whose address is never taken lives in a WebAssembly local
  with its C name. Arrays, structs, unions and address-taken variables live in a
  stack frame in linear memory, addressed from `$__fp`; the global `$sp` is the
  stack pointer (1 MiB of stack, checked on entry: overflowing prints "stack
  overflow" and exits with 139). Constant offsets fold into loads and stores.
- **Control flow.** Structured wherever C is: `if`, loops and `switch` become
  `block`/`loop`/`if`, and a dense `switch` one `br_table`. A function with
  `goto`, or with case labels below the top of its `switch` (Duff's device),
  becomes numbered blocks under one loop: `$__pc` names the block to run next
  and `br_table` jumps to it. A statement expression with labels gets its own
  such loop. Readable where possible, correct everywhere.
- **Calls.** Arguments after `...` go into an area in the caller's frame, passed
  as a last parameter; `va_list` is a pointer into it. Structs are passed as the
  address of a copy, and returned through a hidden first parameter. A function
  pointer is an index into the table, which starts at 1 so a null function
  pointer traps.
- **Memory.** Static data from 1024 (so small null-pointer offsets read zeros
  rather than live data), then the stack, then the heap, which malloc grows with
  `memory.grow` up to 128 MiB.

## S19. The `c` host: two imports, files in memory

- A compiled program imports exactly two functions from module `c`:
  `write(fd, ptr, len)` for stdout and stderr, and `exit(code)`. Its memory is
  its own export. The page's JavaScript host and Glass Wasm's `c_host.rs`
  implement the same two, and the tests run every example on both.
- `exit` ends the run with a status. Glass Wasm shows it as **Exited** with the
  status, not as a trap.
- There is no input, and `fopen` opens files in memory that last until the
  program ends. Glass Kernel (M6) will give C programs a real file system.
- The page runs programs in a Web Worker and stops one still running after four
  seconds, so an endless loop never freezes the tab.

## S20. How Small C is graded

- c-testsuite's `single-exec` suite (220 programs from tcc and scc), pinned as a
  submodule. A test passes when its combined stdout and stderr equal the
  `.expected` file byte for byte and it exits with status 0, the suite's own
  rule.
- Every test runs twice: on Node's WebAssembly engine and on Glass Wasm (with a
  5-billion-step cap; the 8-queens test takes 1.1 billion). The two must agree,
  and `results.json` records any test where they don't.
- Skips are only for tests that can never pass on this target, each with its
  reason. None were needed: all 220 pass. Anything not passing is listed on the
  page with the compiler's message.
- The test programs are never shipped in the site (some are LGPL, from tcc);
  only their names, counts and results are.
