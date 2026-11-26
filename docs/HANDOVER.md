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
| M2 | Glass Wasm interpreter, first spec-test grade | Next |
| M3–M8 | Pane → Wasm, Small C, Glass Console, Glass Kernel, Language Tools, JIT | Planned |

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

## Verification for M1 (local, 2026-11-26)

- `npm run verify` passes: typecheck, lint, 11 + 167 + 8 unit tests, build.
- `npm run check:site` passes (3 pages), and `npm run check:results` passes.
- Glass Compiler e2e: 72 pass, 4 skipped (the screenshot generator).
- Hub e2e: 20 pass, covering axe, both themes, both widths, no-JS and navigation.
- `visual-check` skill on all three pages at 375, 768 and 1280, dark and light:
  see the qa report in the PR description.

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
- Series monorepo with glass-ui, the hub, per-package CI and the deploy of the
  assembled site.
- Research, plan, decisions, acceptance checks, notices and owner steps written.

## Not done, and why

- Glass Wasm and every later member: not started yet. M2 is next, in order.
- The "follow this program" view across members needs the Pane → Wasm backend
  (M3) first.
- e2e tests run locally, not in CI. That's a deliberate saving of Actions
  minutes (house rule); CI runs typecheck, lint, unit tests, builds and the site
  check.

## What needs Vin

- Nothing is required. If `main` has branch protection, update the required
  check names (NEEDS-VIN.md, Recommended 1).
