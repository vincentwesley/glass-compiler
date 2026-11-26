# House rules (vendored for cloud sessions)

Trimmed copy of the owner's root rules so a session without the parent folder
can work here. Project-specific notes in `CLAUDE.md` and `docs/HANDOVER.md` win
where they differ.

Vendored alongside this file:
- `vendor/house/`: reference copies of the house kit (`tokens.css`,
  `components.css`, `palettes.css`, `js/theme-init.js`, `js/theme.js`,
  `README.md`, `UPGRADING.md`). Not loaded by the app; this project owns its
  own copies in `src/styles/` and `public/theme-init.js` (see HANDOVER,
  2026-11-18 kit sync). Re-copy from upstream `_house`, never patch them.
- `vendor/house/credits/`: the house credits card (`credits.html`,
  `credits.css`, `credits.js`, `creator.webp`, `PROVENANCE.md`). Its
  `../brand/logo/logo-resize.js` script is not vendored; this repo's draggable
  sign-off lives in `src/brand/`, so per UPGRADING step 6 leave the card's
  static logo and "Logo by" block out when using it here.
- `vendor/house/brand/`: logo SVGs in `svg/` (`name-a` on light, `name-b` on
  dark = default brand mark; `mark-*` favicon/avatars; `atelier-*`
  footers/about; `*-c`/`*-d` mono #333 / white), plus `README.md` (usage
  snippets) and `PROVENANCE.md`.
- Logo and character art are **all rights reserved**, not MIT; see `NOTICE.md`.
- `.claude/skills/`: `design-review`, `visual-check`, `ship-batch`.

## Autonomy and reporting
- Decide and do. Ask only if a step is irreversible, outward-facing (visibility
  change, publish, prod deploy, sending anything), spends money, or needs the
  owner's accounts or credentials.
- Report only outcome, anything broken or risky, and owner actions needed. No
  narration or option tours.
- Owner-only steps go last, as one short list with exact links or commands.
- Touch only this project.

## House style
- Dark mode by default with no JS and the OS set to light. Light is opt-in via
  the toggle only (`data-theme="light"`), never `prefers-color-scheme`.
- Palette: bg `#11150e`, accent `#4fe0a0`; secondary peach `#e9a07f`, lavender
  `#a996e0`. Use tokens, not hard-coded hex.
- Fonts (self-hosted, no runtime Google Fonts): Space Grotesk headings, Inter
  body, Silkscreen pixel labels only, JetBrains Mono code/stats.
- Look: glowing pixel-frame cards, square corners, offset-shadow buttons,
  firefly accents, springy motion. Frames are box-shadow rings with corner
  studs (never `mask-border`). Pending items = dashed tile, no link.
- Guardrails: no scroll-jacking, no flashing over 3 Hz, no autoplay audio (sound
  opt-in), pixel fonts for labels only, links are real `<a>`, tap targets at
  least 48px, all motion behind `prefers-reduced-motion`. No pixel brand-logo
  packs. Never AI-generated or stock art.
- Review loop after UI changes: build, then `design-review` (max 3 rounds).

## Brand and credits standard
- Studio is **Vin's Atelier** (never "Vin Studios"). Developer is **Vin**.
- Footer: "Copyright {year} Vin's Atelier. Designed and built by Vin."
  `<meta name="author" content="Vin, Vin's Atelier">`; README `## Credits`;
  `humans.txt`; manifests; JSON-LD publisher Organization + Person
  alternateName "Vin".
- Every UI ends with a credits section at the bottom. Outside portfolio and
  social-hub, the draggable morphing logo (`</>` / `</in>` / `</Atelier>`,
  `--logo-x`, `localStorage["logo-form"]`, Logo radios) lives in that bottom
  credits section, larger; here that is `src/brand/`. Logo files:
  `vendor/house/brand/svg/`; credits card: `vendor/house/credits/`.
- The commissioned logo is all rights reserved (designed by Portus
  Workstation, Instagram @portus_workstation and @wason25_pz; credit them
  wherever it appears). Never recolour, redraw or pixel-ify it, never design
  another, and never replace or edit this project's own logo or top bar.
- Legal name "Vincent Wesley" only where legally needed (LICENSE).

## Verification tiers
Scale checks to the change. Headless only; no visible browsers or dev servers
left running.
- **Per change (default):** only checks the change can affect. Docs: none.
  Small code: typecheck + only the tests touching those files + build if the
  bundle could change. Don't re-run what already ran green on the same code.
- **End of batch / before a push:** typecheck + lint + unit + build
  (`npm run verify` here). No full e2e.
- **Milestone (only when the owner calls it):** full e2e, axe, headless
  screenshots at 375px and desktop in dark and light (`visual-check`),
  Lighthouse, credits check, `ship-batch` gate.
- Always run a security review if auth, secrets, tokens, user input, network
  or CSP/headers changed.

## Git, CI and safety
- One identity: `vincentwesley <221810966+vincentwesley@users.noreply.github.com>`.
- GitHub Actions minutes are limited: verify locally, CI is never the test
  runner; batch pushes; docs-only pushes carry `[skip ci]`; don't watch or
  re-run CI; no new workflows or schedules unasked.
- No secrets in the repo, no install/postinstall/prepare scripts, no tracked
  `.claude/settings.json` hooks, no personal data or absolute local paths in
  tracked files. Third-party assets licence-checked and credited.
