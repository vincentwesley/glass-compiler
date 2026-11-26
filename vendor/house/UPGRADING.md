# Upgrading an existing project to the current kit

Copy the kit in (do not link it), then work through this list.

## 1. What changed
- Light mode: `--border`, `--border-strong`, `--fx-1..3`, `--firefly` and `--firefly-core` are darker so they pass `node scripts/contrast.mjs`. Do not keep local overrides of the old values.
- New tokens: `--bg-elev`, `--border-soft`, `--border-strong`, `--accent-fg`, `--focus`, `--fx-1..3`, `--firefly`, `--firefly-core`, `--ok/--warn/--danger` and their `-fg`, `--series-1..6`, `--pix`, `--fx-card-shadow`, `--fx-btn-shadow`, `--fx-ease`, `--ease-spring`, `--content-w`, `--header-h`, `--z-nav/--z-dialog/--z-toast`, `--s1..6`, `--step--1..4`, `--dur-fast`, `--dur-open`.
- New files: `components.css`, `js/` (`theme-init.js`, `theme.js`, `toast.js`, `tabs.js`, `fireflies.js`), `pixel/`, `icons/`, `favicon.svg`, `404.html`/`404.css`, `scripts/contrast.mjs`.

## 2. Steps per project
1. Copy `tokens.css`, `components.css`, `fonts/` (with `OFL.txt`), `credits/`, `js/`, `pixel/`, `icons/` as needed. Keep folder names so relative URLs work.
2. Load order: `tokens.css`, `components.css`, `pixel/pixel.css`, `credits/credits.css`, then your own CSS.
3. Replace any local theme scripts with `<script src="js/theme-init.js"></script>` in `<head>` (before the stylesheets). Storage key is `theme`; rename old keys or users reset to dark once.
4. Wire the toggle with `initThemeToggle(button)` from `js/theme.js`. Remove any `prefers-color-scheme: light` handling.
5. Logo: copy `brand/svg/` (plus `brand/README.md`, `brand/PROVENANCE.md`) beside the other kit folders, never `brand/source/`. Replace `favicon.svg` with the kit one. Put the theme-swapped name logo in the header brand slot (`.hs-brand-dark` / `.hs-brand-light` from `components.css`; snippet in `brand/README.md`).
6. Credits: replace the old markup with the current `credits/credits.html`. The fireflies are now styled in `credits.css`, so delete inline `style="--x:..."` attributes on `.creator__fx i` and `.spark`. `credits.css` needs `tokens.css` for `.sr-only`. The card now also holds the logo and the "Logo by @portus_workstation / @wason25_pz" credit: `../brand/svg/` must resolve from the page and `components.css` must be loaded for the logo swap. Exception: if the project already has the draggable studio sign-off (`brand/logo/signoff.html`), leave the static logo and "Logo by" block out of the card; the sign-off carries both (`logo-rollout-spec.md`).
7. Replace hard-coded hex values with tokens; count them before and after (`grep -c "#[0-9a-fA-F]\{6\}"`).
8. Square corners and pixel-frame shadows: remove `border-radius` and soft `box-shadow` on cards, buttons and chips.
9. Run `node scripts/contrast.mjs` (kit) and the project's own checks.

## 2b. Optional additions (2026-11-18)
Nothing to do unless you want them; re-copying `tokens.css` and `js/theme-init.js` changes nothing visible.
1. Tokens: `--glow`, `--glass`/`--glass-blur`, `--ease-bounce`, `--fx-2-ink`/`--fx-3-ink`, `--*-soft`, `--syntax-*`; utilities `.hs-tabular`, `.hs-no-liga`, `.hs-trim` (see README). If the project grew its own copies (portfolio `--glow`, social-hub `--glass`/`--ease-bounce`/tabular-nums/ligature reset, glass-compiler `--c-*`/`--peach-ink`/`--lav-ink`/`--*-soft`), switch to the kit names and delete the local ones.
2. Palettes: copy `palettes.css` + `js/palette.js`, link `palettes.css` after `tokens.css`, call `setPalette()` from your picker. Storage key `palette` (same as social-hub).

## 3. Known drift checklist
- [ ] Portfolio: accent `#8fd15a` should be `#4fe0a0`; replace `999px` pills with `.hs-chip`.
- [ ] VGC (MetaLens): runtime Google Fonts, Press Start and VT323 replaced by the self-hosted kit fonts; CSP then drops the font hosts.
- [x] tldr-panel: rounded corners removed; light theme must be toggle-only, not OS-following. (done 2026-11-18, 6a86c5e)
- [ ] access-ease: same as tldr-panel (rounded, OS-following light).
- [ ] Every project: record the hard-coded hex count, bring it to near zero, and note it in `docs/next-session.md`.

## 4. Keep kit copies in sync
From a project root, one command per file; no stdout and exit 0 means identical (a diff prints the stat and exits 1; ignore the CRLF warnings on stderr):
`git diff --no-index --stat "C:/Coding Projects/_house/tokens.css" public/_house/tokens.css` (repeat for `components.css`; for folders use the directory paths, e.g. `pixel/`, `js/`). Any diff: re-copy from `_house`, never patch the copy.

## 5. Astro consumption rule
Import the kit CSS from the layout and use a `Credits.astro` component instead of copying into `public/_house`. Set `vite.build.assetsInlineLimit: 0` so no script is inlined (CSP `script-src 'self'`). `js/theme-init.js` stays an external classic script in `<head>` on every project; skipping it causes a dark flash for light-theme users.