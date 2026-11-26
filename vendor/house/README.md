# house: portable design kit (personal-side palette)
- `tokens.css`: dark (default) + mint-light (`data-theme="light"` on `<html>`) tokens, self-hosted fonts (`fonts/`, OFL), `hs-card/btn/chip/eyebrow` helpers.
- Optional extras in `tokens.css` (2026-11-18, all opt-in: nothing uses them until you do; defaults unchanged):
  - `--glow` (from portfolio): accent halo, e.g. `box-shadow: var(--pix), 0 0 1.5rem var(--glow)` on a featured card. Ornament only.
  - `--glass` + `--glass-blur` (social-hub): near-opaque panel fill (`background: var(--glass); backdrop-filter: var(--glass-blur)`), auto-solid without backdrop-filter or under `prefers-reduced-transparency`. Text contrast equals `--bg-elev`.
  - `--ease-bounce` (social-hub): `linear()` landing bounce for small pops; falls back to `--fx-ease`. Use inside `prefers-reduced-motion: no-preference` only.
  - `--fx-2-ink` / `--fx-3-ink` (glass-compiler): peach/lavender safe for TEXT (>= 4.5:1 on `--bg` and `--bg-elev` in both themes); `--fx-2`/`--fx-3` stay ornament-only.
  - `--accent-soft`, `--fx-2-soft`, `--fx-3-soft`, `--danger-soft` (glass-compiler): tinted backgrounds for selected rows, notes, error lines; put `--fg` text on them.
  - `--syntax-keyword|literal|string|name|operator|punct` (glass-compiler): code highlighting colours, all text-safe on `--bg`/`--bg-elev`.
  - Utilities (social-hub): `.hs-tabular` (aligned digits for stats, timers, tables), `.hs-no-liga` (no `->`/`fi` ligatures in code or labels), `.hs-trim` (`text-box` cap trim for chips/eyebrows, ignored where unsupported). A later `font:` shorthand resets the first two, so put the class on an element without one.
- `palettes.css` + `js/palette.js` (optional, from social-hub): dark-only `data-palette="peach|lavender"` accent swaps. Load after `tokens.css`; `setPalette(name)` stores `localStorage["palette"]` and `js/theme-init.js` reapplies it pre-paint. Default (no attribute) is the standard palette; light theme ignores palettes. `node scripts/contrast.mjs` checks every palette.
- `brand/logo/`: draggable Vin's Atelier logo (see `brand/README.md`).
- `components.css`: buttons, fields, check, nav, toast, banner, skeleton, empty, progress, dialog, tabs, notch, divider.
- `js/`: `theme-init.js` (pre-paint, classic script), `theme.js`, `toast.js`, `tabs.js`, `fireflies.js`, `palette.js` (ES modules).
- `pixel/`: `pixel.css` plus Kenney CC0 sprites and cursors. `icons/`: 31 Pixelarticons SVGs (MIT) used via `.hs-icon`. `favicon.svg` (logo mark). `404.html` + `404.css`.
- `brand/`: commissioned Vin's Atelier logo (`svg/`, `png/`, `README.md` mapping + rules, `PROVENANCE.md`; all rights reserved; `source/` is local only). Theme swap: two `<img>` with `.hs-brand-dark` (name-b) / `.hs-brand-light` (name-a), see `brand/README.md`.
- `credits/`: Credits card (`credits.html` markup, `.css`, `.js`, `creator.webp`).
- `preview.html` (+ `preview.css`, `preview.js`): the full gallery of tokens, components, pixel assets, fireflies and credits. Open over a static server or file://.
- `REFERENCES.md`: prior art and asset sources. `UPGRADING.md`: adopting changes in an existing project.
- `scripts/contrast.mjs`: the kit check. Run `node scripts/contrast.mjs` after any colour change; it must print "all pass".
- How to copy: copy `tokens.css`, `components.css`, `fonts/`, `pixel/`, `icons/`, `js/`, `credits/` into the project (keep folder names so relative URLs work). Put `<script src="js/theme-init.js"></script>` in `<head>` before the stylesheets. Load order: `tokens.css`, `components.css`, `pixel/pixel.css`, `credits/credits.css`, your CSS. Load the other `js/` files as `type="module"`.
- CSP: kit files are same-origin and need no inline style or script (see `_headers`). `credits.css` relies on `tokens.css` for `.sr-only`, so always load both.
- Fonts: Space Grotesk (head), Inter (body), Silkscreen (pixel labels only), JetBrains Mono.
- Plain HTML: link `tokens.css` + `credits/credits.css`, paste `credits.html`, load `credits.js` (img src must reach `creator.webp`).
- Astro: do NOT copy into `public/_house/`. Import the CSS (`tokens.css`, `components.css`, `pixel/pixel.css`, `credits/credits.css`) from the layout and render the markup in a `Credits.astro` component; set `vite.build.assetsInlineLimit: 0` in `astro.config.mjs` so scripts stay files (`script-src 'self'`).
- React: copy the folder, import the CSS, paste the markup in a component, call `credits.js` once on mount; keep `fonts/` beside `tokens.css`.
- MANDATORY on every project: `<script src="js/theme-init.js"></script>` (external classic file, in `<head>` before the stylesheets). Skipping it means a dark flash for users who chose light, because the saved theme is applied after first paint.
- Tailwind: map tokens in the theme, e.g. `colors: { bg: "var(--bg)", fg: "var(--fg)", accent: "var(--accent)" }`, `fontFamily: { head: "var(--font-head)" }`; set `data-theme` on `<html>`.
- RULE: default to dark. Never follow `prefers-color-scheme: light`; light only when the user toggles it (`data-theme="light"`), and persist the choice.
- RULE: the credits card goes at the bottom of every UI project.
- Replace `{{PROJECT}}` in the blurb with the project name.
- `templates/`: `sw.js` (offline, skips /api/*), `scripts/check-budgets.mjs` + `budgets.json`, `tests/redirects.test.ts`, `e2e/house.spec.ts` (axe both themes, off-origin, 375 overflow, reduced motion), `wrangler.jsonc` (Workers static assets), LICENSE (MIT), SECURITY.md, dependabot.yml, `ci-identity-step.yml`, `gitignore-additions.txt`, CLAUDE.md, README.md, NOTICE.md, THIRD_PARTY_NOTICES.md, `.env.example`, `package-fields.json` (fill `{{ }}` placeholders); copy into every repo before it goes public. Workflows needing no template: call `lighthouse.yml` / `public-gate.yml` (see below).
- Verification tiers: see root `C:\Coding Projects\CLAUDE.md` section 4 (authoritative; not repeated here). Script naming: `npm run check` = typecheck + lint + unit; `npm run check:budgets` after build.
- `pre-public/CHECKLIST.md`: gate every repo must pass before becoming public (per-repo blocker lists live beside it).
- `check-identity.sh`: run before the first push / making a repo public.
- `credits/PROVENANCE.md`: who owns `creator.webp` (owner's art, not MIT).
- `fonts/OFL.txt`: SIL OFL 1.1 licence for the bundled fonts.
- RULE: copy `fonts/OFL.txt` along with the fonts.
- RULE: never track `.claude/settings.json` hooks in public repos (use `settings.local.json`).

## Reusable workflows (`.github/workflows/`)
- `ci-node.yml`: identity check, `npm ci --ignore-scripts`, typecheck/test/build/e2e (all `--if-present`). Inputs: `working-directory`, `node-version-file`.
- `pages-deploy.yml`: build and deploy to GitHub Pages. Inputs: `build-dir`, `working-directory`.
- `keepalive.yml`: keeps scheduled workflows alive (liskin/gh-workflow-keepalive).
- `lighthouse.yml`: @lhci/cli headless on a built static dir, fails on budget breach, uploads report. Inputs: `budgets-file` (required), `build-command`, `static-dir`, `working-directory`, `node-version-file`.
- `public-gate.yml`: gitleaks (pinned binary, SHA256-verified, full history), zizmor on workflows, licence report artifact. `check-identity.sh --public` stays a local step (needs local hooks/config). Input: `working-directory`.
- Call from a project, pinned to a commit SHA: `uses: vincentwesley/house/.github/workflows/ci-node.yml@<sha>`.
- `ci.yml` (repo root) is the standalone copy-me template for projects that do not call the reusable one. House's own CI runs `ci-node.yml`, `lighthouse.yml` and `public-gate.yml` against `fixture/`.

Provided as is, no warranty. No secrets and no network calls beyond GitHub Actions itself. `credits/creator.webp` is all rights reserved (see `NOTICE.md`).

## Brand and motion cheat-sheet
- Brand logos: use the official glyph unchanged, in an allowed colour, inside a pixel frame. Pixel art is for frames, backgrounds and generic icons only; never pixel-redraw brand logos or use pixel brand-logo packs. Ko-fi's brand use is permissive. Links are real `<a href>` elements.
- Motion: no scroll-jacking, nothing flashing above 3 Hz, no autoplay audio, everything honours `prefers-reduced-motion`.
- Type: Silkscreen/pixel fonts for short labels only. Mobile tap targets at least 48px.
- Headers: `_headers` only covers static assets; Worker responses set their own. Preview servers ignore `_headers`/`_redirects`, so unit-test them (`templates/tests/redirects.test.ts`).