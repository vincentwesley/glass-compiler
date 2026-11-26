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
  compiling WebAssembly and nothing else; JavaScript `eval` stays blocked. Pages
  that don't run Wasm (compiler, hub) keep the exact current policy.

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
partial run), so scrubbing anywhere under the 200,000-step limit is instant.
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

