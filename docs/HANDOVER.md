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

## GitHub Actions minutes

The account has **no Actions minutes left this month** (as of 2026-10-18), so
CI and the Pages deploy won't run until they reset. Until then, verify locally
before every push: `npm run verify` and `npm run test:e2e`. The deploy
workflow can be run by hand from the Actions tab (`workflow_dispatch`) once
minutes are available, or a later push to `main` will deploy.

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

- `@playwright/test` is pinned to 1.56.1 (and `playwright-core` overridden to
  match) because that is the Chromium build pre-installed in the cloud session.
  Upgrading needs a matching browser.
- Very wide trees (long programs) still need horizontal scrolling at 60% zoom.
- CSP `frame-ancestors` can't be set from a meta tag, so the page could be
  framed by another site; GitHub Pages doesn't allow custom headers.
