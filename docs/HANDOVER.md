# Handover

## Status

- **M0 research and scaffolding: done.** Research, decisions, plan, configs,
  licence, security policy, CI and deploy workflows.
- **M1 language core: done.** Lexer, Pratt parser, compiler, tracing VM in
  `src/lang/` with unit tests in `tests/unit/`.
- **M2 UI shell and stages: done.** Editor (CodeMirror 6 in a shadow root for
  CSP), Tokens, Tree (SVG), Bytecode and VM panels, both themes, 375px to desktop.
- **M3 linking, examples, tour: done.** Selection store, lineage strip,
  follow-selection, five examples, guided tour, credits footer.
- **M4 verify and ship: done.** Playwright + axe e2e suite passes at 1440px and
  375px in both themes with no CSP violations; README screenshots in
  `docs/screenshots/` (regenerate with `SCREENSHOTS=1 npm run test:e2e -- screenshots`).
  Pull request opened from `claude/friendly-thompson-jh0adm` to `main`.

- **Follow-up (after the MVP PR): done.** Jump-target markers in the bytecode
  panel and share links that carry the program in the URL fragment
  (`src/ui/share.ts`), with unit and e2e tests.

- **Robustness pass: done.** A code review of the whole branch found a parser
  stack overflow on absurdly nested input (which a share link could make
  permanent through the saved draft), a depth-counter leak, a dead stray-`}`
  handler, stale cursor lookups mid-edit, and quadratic bytecode rendering.
  All fixed with tests. Also: share links back up your own code ("Restore my
  previous code") and work when pasted into an open tab; the examples menu
  switches to "Your code" after edits; repeated errors are grouped (×N).

## GitHub Actions minutes

The account was reported to have no Actions minutes left this month
(2026-10-18), yet CI still ran on this public repo's PR pushes. Either way,
verify locally before every push: `npm run verify` and `npm run test:e2e`. If
the Pages deploy doesn't start after merging, run **Deploy to GitHub Pages**
from the Actions tab (`workflow_dispatch`).

## One-time step for the repo owner

In GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
After that, merging to `main` deploys to
https://vincentwesley.github.io/glass-compiler/ (the deploy workflow can also
be run by hand from the Actions tab).

## What could come next

- Run the Playwright/axe suite in CI too (needs `npx playwright install
  chromium` in the workflow; deliberately left out of the requested CI).
- `for` loops and arrays in Pane, if they can be shown without clutter.

## Known issues
- 2026-11-16: milestone visual check clean (e2e 70 pass / 4 skip; 2 load timeouts pass alone; axe 0). `qa-output/` now gitignored. The Pages deploy workflow fails because Pages is not enabled for the repo.

- `playwright-core` is overridden to follow `@playwright/test`
  (`"$@playwright/test"`), so Dependabot bumps keep the two in step. (The
  2026-11-17 bump to 1.65.1 had left the override at 1.56.1, which stopped the
  e2e suite from starting.) When the sandbox's Chromium build doesn't match,
  set `PW_CHROMIUM_PATH` (see CLAUDE.md); 2026-11-20: 72 pass / 4 skip against
  build 1243.
- The site is live at https://vincentwesley.github.io/glass-compiler/ (checked
  2026-11-20 at 1440px and 375px: no console errors, fonts load).
- Very wide trees (long programs) still need horizontal scrolling at 60% zoom.
- CSP `frame-ancestors` can't be set from a meta tag, so the page could be
  framed by another site; GitHub Pages doesn't allow custom headers.

- Brand: draggable Vin's Atelier logo + sign-off in the footer (`src/brand/`, `tests/e2e/logo.spec.ts`); pre-paint form in `public/theme-init.js`.
- 2026-11-17 hygiene sweep: dependabot added.
- 2026-11-18: kit sync: project owns its token system (--surface/--ink, glass-theme key); only canonical scales/z/dur tokens added additively; components.css and theme-init intentionally not re-copied; zero pixel diff.
