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
- **Rust.** `rustup target add wasm32-unknown-unknown` works here. Build with
  cargo only, without wasm-pack (DECISIONS S8).

## Current state

- **M1 is done.** The series monorepo is live:
  - Glass Compiler at `/glass-compiler/`.
  - The hub at `/glass-compiler/series/`.
  - glass-ui shared by both.
- Next is **M2, the Glass Wasm interpreter**:
  1. Add `packages/wasm/` with `crate/` (Rust: binary decoder, validator,
     interpreter, `.wast` parser and runner, CLI) and `web/` (debugger page at
     `/glass-compiler/wasm/`).
  2. Add the testsuite as a git submodule at `packages/wasm/testsuite`, pinned to
     tag `wg-1.0` (977f970…).
  3. First grade: the integer and control-flow `.wast` files (list in ACCEPTANCE).
  4. Record the counts with `scripts/record-results.mjs wasm`, add the member's
     CI workflow, and flip its `status` to `'live'` in `site.config.mjs`.

## Known gaps

- e2e runs locally, not in CI (deliberate, to save Actions minutes).
- Wide syntax trees need horizontal scroll.
- `frame-ancestors` can't be set on GitHub Pages.
