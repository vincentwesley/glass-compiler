# Vin's Atelier logo kit

Commissioned logo (see `PROVENANCE.md`: all rights reserved, not MIT). The glyph is `</>` (two brackets and a slash); the name logos set "Vin" or "Atelier" between the brackets.

## Files
`svg/{design}-{style}.svg` (cropped to the artwork, scales from `viewBox`; use these), `png/` (same names, original 1920x1080 artboards), `presentation.png`, `color-guide.png`. `source/` (.ai, .pdf) is gitignored and local only; never copy it into a project.

| # | file | design | style | use on |
|---|---|---|---|---|
| 1 | `mark-a` | mark (glyph only) | A gradient + #333 | light bg |
| 2 | `name-a` | name ("Vin") | A | light bg (light-theme default) |
| 3 | `atelier-a` | atelier ("Atelier") | A | light bg |
| 4 | `mark-b` | mark | B gradient + white | dark bg |
| 5 | `name-b` | name | B | dark bg (dark-theme default) |
| 6 | `atelier-b` | atelier | B | dark bg |
| 7 | `mark-c` | mark | C solid #333 | light bg, one colour |
| 8 | `name-c` | name | C | light bg, one colour |
| 9 | `atelier-c` | atelier | C | light bg, one colour |
| 10 | `mark-d` | mark | D solid #fff | dark bg, one colour |
| 11 | `name-d` | name | D | dark bg, one colour |
| 12 | `atelier-d` | atelier | D | dark bg, one colour |

Defaults: dark theme `name-b`, light theme (`data-theme="light"`) `name-a`. C/D only when a single colour is required (print, stamps, one-ink).

## Which design
- **mark**: favicon, avatars, app icons, anything small or square. `favicon.svg` in the kit is `mark-b` on a square viewBox.
- **name**: the default brand slot in site headers and navs.
- **atelier**: footers, about pages, hero blocks.

## Theme swap (CSS in `components.css`, no JS, CSP safe)
```html
<img class="hs-brand-dark" src="brand/svg/name-b.svg" alt="Vin's Atelier" width="988" height="470">
<img class="hs-brand-light" src="brand/svg/name-a.svg" alt="Vin's Atelier" width="988" height="470">
```
Dark is shown by default; light only under `:root[data-theme="light"]`. It never follows `prefers-color-scheme`. Default height is 2rem; override the height in your own CSS.

## Rules
- Never recolour, never redraw as pixel art, never stretch or skew (keep aspect ratio; set height, width auto).
- Minimum height: 24px for name/atelier logos, 16px for the mark.
- Clear space: 0.5x the logo height on all sides (artist gave no figure).
- A/B only on the matching background; use C/D for single-colour needs.
- Credit the artist in every credits card (`credits/credits.html` already does).

## Palette
`#4de3a6` mint, `#556a6f` slate (gradient ends), `#ffffff`, `#333333`.

## Draggable logo
The morphing logo (`</>` short, `</in>` middle, `</Atelier>` long; drag sideways to resize) lives in `brand/logo/`:
- `signoff.html`: the sign-off markup (logo link, copyright line, "Logo by" credit, Logo radios). Gradient ids `bl-g1..g3`; keep the SVG byte for byte.
- `logo.css`: all styles, scoped to `.studio-signoff`. Uses the app's `--accent`.
- `logo-resize.js` (plain-HTML projects, no build step) / `logo-resize.ts` (bundled TS projects): drag, notches, snap, radios, first-visit hint. Same behaviour; keep both in sync. Selects `[data-logo-link]` and `.brand-logo`.
- `logo-init.js`: pre-paint `data-logo` restore from `localStorage["logo-form"]` (already in `js/theme-init.js`; load this only if the page has no theme-init).
- `templates/e2e/logo.spec.ts`: behaviour tests.

Placement: bottom credits section by default (`credits/credits.html` includes it). Top bar only in portfolio and social-hub. It never replaces a project's own logo, wordmark or top bar. Full rules: `logo-rollout-spec.md` in the projects root. No `style=` attributes, no inline scripts.
