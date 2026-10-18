# Glass Compiler — notes for Claude

A see-through compiler for the tiny language **Pane**, deployed as a static site
to GitHub Pages. Read `docs/HANDOVER.md` first when resuming work, then
`docs/PLAN.md` and `docs/DECISIONS.md`.

## Commands

- `npm ci --ignore-scripts` — install (never run install scripts).
- `npm run dev` — Vite dev server at `/glass-compiler/`.
- `npm run verify` — typecheck, lint, unit tests, build. Run before every push.
- `npm run test:e2e` — Playwright + axe against a production build (uses the
  pre-installed Chromium; **never** run `playwright install`).

## Layout

- `src/lang/` — lexer, Pratt parser, compiler, VM. No DOM imports here.
- `src/ui/` — panels, selection store, editor, tour, theme.
- `src/styles/` — design tokens (`tokens.css`) and component styles.
- `tests/unit/` — Vitest; `tests/e2e/` — Playwright.
- `public/theme-init.js` — tiny external script that applies a saved light theme
  before first paint (the CSP forbids inline scripts).

## Rules

- Keep the CSP in `index.html` strict: no inline scripts or styles, no
  third-party hosts, no `eval`/`new Function`.
- Dark theme is the default on `:root`; light only via `data-theme="light"`.
- Colours: bg `#11150e`, accent `#4fe0a0`, peach `#e9a07f`, lavender `#a996e0`.
  Fonts: Space Grotesk (headings), Inter (body), Silkscreen (pixel labels),
  JetBrains Mono (code), all from `@fontsource`.
- Square corners, pixel-frame cards, offset-shadow buttons; all motion must
  respect `prefers-reduced-motion`.
- Commit as `vincentwesley <221810966+vincentwesley@users.noreply.github.com>`.
- GitHub Actions stay pinned to commit SHAs with least-privilege permissions.
- Update `docs/HANDOVER.md` after each milestone.
