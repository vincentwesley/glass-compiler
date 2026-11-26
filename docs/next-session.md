# Next session

## Before anything

1. Read `CLAUDE.md`, then `docs/HANDOVER.md`, `docs/PLAN.md`,
   `docs/DECISIONS.md` and `docs/ACCEPTANCE.md`.
2. `git fetch origin main` and branch from it. Work on a `claude/` branch, with
   one PR per milestone. Merge it yourself once every check passes.
3. Run `npm ci --ignore-scripts && npm run verify` to confirm a green start.

## How to work here

- **Verify locally before every push.** Run `npm run verify`,
  `npm run check:site` and the e2e suites of the packages you touched. Push once
  per milestone. Docs-only pushes carry `[skip ci]`.
- **Chromium in the cloud sandbox.** Playwright expects a newer build than the
  pre-installed one.
  - For e2e: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-<build>/chrome-linux64/chrome`.
  - For the `visual-check` skill: make a folder with
    `chromium_headless_shell-<expected>` symlinked to
    `/opt/pw-browsers/chromium_headless_shell-<installed>`, then set
    `PLAYWRIGHT_BROWSERS_PATH` to that folder.
  - Never run `playwright install`.
- **Pixel-identity check for refactors.** Build `origin/main` in a git worktree,
  serve both, screenshot at 1440px and 375px in dark and light, and diff. This
  is how M1 proved nothing changed.
- **Rust.** The toolchain is pinned in `rust-toolchain.toml` (rustup installs it,
  with the wasm32 target, on first use). Build with cargo only, without
  wasm-pack (DECISIONS S8). Run `git submodule update --init --depth 1` before
  anything touching Glass Wasm.

## Current state

- **M1 (series monorepo) and M2 (Glass Wasm) are done.**
  - Glass Compiler is at `/glass-compiler/`.
  - The hub is at `/glass-compiler/series/`.
  - Glass Wasm is at `/glass-compiler/wasm/`. It passes 19,270 / 19,270
    commands of the WebAssembly 1.0 testsuite.
- Next is **M3, the Pane → Wasm backend** (PLAN.md):
  1. Add a Wasm code generator in `packages/compiler/src/lang/`: Pane AST →
     `glass-wasm`-compatible binary module. Write the encoder in TypeScript;
     the Rust side already decodes.
     - Globals become Wasm globals.
     - Functions become Wasm functions.
     - Strings and `print` go through host imports.
     - Every instruction carries its Pane node id, in a custom name section or a
       side table.
  2. Add a fifth stage panel, "Wasm", to Glass Compiler, linked like the others.
  3. Add "Open in Glass Wasm", which passes the module in the fragment
     (`#wasm=`). Glass Wasm's `gw_load` already takes binary.
  4. Known-answer tests: every compiler example gives the same output from the
     bytecode VM, from Glass Wasm (its Rust VM in Node) and from Node's own
     WebAssembly.
- Glass Wasm only implements the `spectest` host imports. Pane's `print` of
  strings needs a host import designed in M3 (record it in DECISIONS).

## Known gaps

- e2e runs locally, not in CI (deliberate, to save Actions minutes).
- Wide syntax trees need horizontal scroll.
- `frame-ancestors` can't be set on GitHub Pages.
