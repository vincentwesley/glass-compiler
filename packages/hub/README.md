# The Glass series hub

The series site at https://vincentwesley.github.io/glass-compiler/series/: the
pipeline, one card per member, and a page per live member. Member data comes from
`site.config.mjs` and each member's recorded `results.json`. It is rendered to
static HTML at build time (`build/render.ts`), so the hub works with JavaScript
off.

```sh
npm test -w @glass/hub        # renderer unit tests
npm run test:e2e -w @glass/hub  # builds the whole site, then Playwright + axe on it
```

## Licence and credits

MIT, copyright (c) 2026 Vin's Atelier (Vincent Wesley). Designed and built by
Vin, Vin's Atelier. The logo (by @portus_workstation / @wason25_pz) and the
credits-card art are all rights reserved; see `NOTICE.md`. Provided as is, no
warranty.
