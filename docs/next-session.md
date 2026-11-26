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

- **M1 to M4 are done.**
  - Glass Compiler (`/glass-compiler/`) compiles Pane to bytecode and WebAssembly.
  - Glass Wasm (`/glass-compiler/wasm/`) passes the WebAssembly 1.0 testsuite and
    debugs compiled Pane and C.
  - Small C (`/glass-compiler/small-c/`) compiles C to WebAssembly; c-testsuite
    220 / 220 on Node and on Glass Wasm.
  - The hub is at `/glass-compiler/series/`.
- Next is **M5, Glass Console** (PLAN.md):
  1. Research first (RESEARCH.md §4 has the references): CHIP-8 then Game Boy.
     Decide Rust-to-Wasm (like Glass Wasm) vs TypeScript, and record it.
  2. Create `packages/console/` with a CHIP-8 core graded by test ROMs. Check
     each ROM's licence before adding it (Timendus's suite is GPL-3.0: use at test
     time only, as a submodule, never bundled, unless the licence allows).
  3. Then the Game Boy: CPU, PPU, timers, APU, graded by Blargg and Mooneye ROMs
     (licences to verify). Only freely licensed homebrew is bundled; never host
     commercial ROMs.
  4. Debugger page with registers, memory, tiles, sprites, click-a-pixel and the
     four audio channels (muted by default).
- Reusable pieces: `@glass/ui` (stepper, highlighter, tour, panels), the
  `record-results.mjs` pattern, `check-site` rules, and the c-testsuite runner as a
  model for a ROM runner.

## Known gaps

- e2e runs locally, not in CI (deliberate, to save Actions minutes).
- Wide syntax trees need horizontal scroll.
- `frame-ancestors` can't be set on GitHub Pages.
- Small C: grading on Glass Wasm takes about 20 s (8 queens alone is 1.1 billion
  steps); the code generator does no optimisation.
