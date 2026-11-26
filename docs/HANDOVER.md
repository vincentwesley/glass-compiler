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
| M3 | Pane → Wasm backend, "Open in Glass Wasm" | Next |
| M4–M8 | Small C, Glass Console, Glass Kernel, Language Tools, JIT | Planned |

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
- Glass Wasm: the full WebAssembly 1.0 testsuite passes (19,270 / 19,270), and its
  debugger page (`/glass-compiler/wasm/`) is built and tested. It goes live when
  the M2 PR merges.
- Series monorepo with glass-ui, the hub, per-package CI and the deploy of the
  assembled site.
- Research, plan, decisions, acceptance checks, notices and owner steps written.

## Not done, and why

- The Pane → Wasm backend (M3) is next. Small C, Glass Console, Glass Kernel,
  Language Tools and the JIT are not started; they follow in order (PLAN.md).
- Wasm proposals beyond 1.0 (multi-value, sign extension, bulk memory, SIMD and
  so on): not attempted yet, by design (1.0 first).
- The "follow this program" view across members needs the Pane → Wasm backend
  (M3) first.
- e2e tests run locally, not in CI. That's a deliberate saving of Actions
  minutes (house rule); CI runs typecheck, lint, unit tests, builds and the site
  check.

## What needs Vin

- Nothing is required. If `main` has branch protection, update the required
  check names (NEEDS-VIN.md, Recommended 1).
