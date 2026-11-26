# glass-ui

The shared debugger kit for the Glass series. Framework-free TypeScript and CSS,
bundled directly by each page's Vite build (no separate build step). Everything
here was extracted from Glass Compiler and behaves exactly as it did there.

| Import | What it gives you |
| --- | --- |
| `@glass/ui/dom` | `h()` element builder (HTML and SVG), roving tabindex, `revealInPanel` |
| `@glass/ui/store` | `Store<S>`: typed state with `set` and `subscribe` |
| `@glass/ui/highlight` | `Highlighter<K>`: mint *selected*, lavender *related*, peach *runs next* |
| `@glass/ui/stepper` | `createStepper()`: ⏮ ◀ ▶ Play ⏭, speed, a timeline scrubber with tick marks |
| `@glass/ui/tour` | `mountTour()`: a non-modal guided tour |
| `@glass/ui/theme` | `mountThemeToggle()`: dark by default, light only when chosen |
| `@glass/ui/fonts` | the four house fonts, self-hosted |
| `@glass/ui/credits` | runs the credits-card animation only while it is on screen |
| `@glass/ui/brand/logo-resize` + `brand/logo.css` | the draggable Vin's Atelier sign-off |
| `@glass/ui/styles/*.css` | `tokens`, `base`, `components`, `panel`, `debugger`, `credits` |
| `../glass-ui/vite/glass-pages.ts` | Vite plugin: shared public files, and `<!-- glass:credits project="…" -->`, `<!-- glass:signoff -->`, `<!-- glass:mark -->` partials as static HTML |

A panel type joins the kit when its second user arrives (docs/DECISIONS.md S4).

```sh
npm test -w @glass/ui
npm run typecheck -w @glass/ui
```

## Licence and credits

MIT, copyright (c) 2026 Vin's Atelier (Vincent Wesley). The Vin's Atelier logo
(designed by @portus_workstation / @wason25_pz) and the credits-card art are all
rights reserved; see the repository's `NOTICE.md`. Designed and built by Vin,
Vin's Atelier. Provided as is, no warranty.
