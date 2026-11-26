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

- **M1, M2 and M3 are done.**
  - Glass Compiler (`/glass-compiler/`) compiles Pane to bytecode and to a real
    WebAssembly module.
  - Glass Wasm (`/glass-compiler/wasm/`) passes the WebAssembly 1.0 testsuite
    (19,270 / 19,270) and debugs compiled Pane via "Open in Glass Wasm".
  - The hub is at `/glass-compiler/series/`.
- Next is **M4, Small C** (PLAN.md):
  1. Create `packages/small-c/` with a C-subset compiler in TypeScript, scoped
     like chibicc: lexer, preprocessor subset, parser, types, codegen to
     WebAssembly. Reuse `packages/compiler/src/lang/wasm/encode.ts`; it can
     move to glass-ui or a shared package once a second user exists.
  2. Add c-testsuite as a pinned submodule (licences: THIRD_PARTY_NOTICES).
     Run each test, record passes, and list every skipped test with its
     reason, all via `scripts/record-results.mjs small-c`.
  3. Add a page at `/glass-compiler/small-c/` (tokens, tree, generated Wasm)
     and an "Open in Glass Wasm" link (Glass Wasm reads `glass.source` and
     `glass.map`, so set language "c").
  4. Small C programs need libc-style host imports (putchar/printf). Design a
     `c` host next to `pane_host.rs` and record the decision.

## Known gaps

- e2e runs locally, not in CI (deliberate, to save Actions minutes).
- Wide syntax trees need horizontal scroll.
- `frame-ancestors` can't be set on GitHub Pages.
