# Third-party notices

The Glass series code is MIT licensed (see `LICENSE`). This file lists everything
else the repository uses or ships, and under what terms. Items marked *planned*
arrive with a later milestone and are listed so their terms are settled before
they are added. Their licences are checked again when they land.

## Shipped in the website

| Item | Version | Licence | Where |
| --- | --- | --- | --- |
| CodeMirror (`@codemirror/state`, `view`, `commands`, `language`, `streamparser`) | 6.x | MIT | Glass Compiler's editor |
| Lezer (`@lezer/common`, `highlight`, `lr`) | 1.x | MIT | CodeMirror dependencies |
| `style-mod`, `w3c-keyname`, `crelt`, `@marijn/find-cluster-break` | see lockfile | MIT | CodeMirror dependencies |
| Space Grotesk, Inter, Silkscreen, JetBrains Mono (via Fontsource `@fontsource/*`) | 5.x | SIL Open Font License 1.1 | Every page; licence text in `packages/glass-ui/public/licenses/FONTS-OFL.txt`, served at `/glass-compiler/licenses/FONTS-OFL.txt` |
| Credits card markup and CSS from the house kit (`vendor/house/credits/`) | 2026-11 | MIT (owner's kit) | Every page |

## Owner's own artwork (not MIT)

| Item | Terms |
| --- | --- |
| Vin's Atelier logo (draggable sign-off, `vendor/house/brand/svg/`) | All rights reserved. Designed by Portus Workstation (@portus_workstation / @wason25_pz), see `NOTICE.md` |
| Credits-card character art (`creator.webp`) | All rights reserved, by the owner, see `NOTICE.md` |

## Rust crates

`glass-wasm` has no dependencies: everything is written from scratch.

## Development only (not shipped)

| Item | Licence |
| --- | --- |
| TypeScript, Vite, Vitest, ESLint, typescript-eslint, `globals`, `@types/node` | Apache-2.0 (TypeScript) and MIT (the rest) |
| Rust toolchain (rustc, cargo, clippy, rustfmt) | MIT or Apache-2.0 |
| Playwright (`@playwright/test`), `@axe-core/playwright`, axe-core | Apache-2.0 (Playwright), MPL-2.0 (axe-core) |
| Vendored skills in `.claude/skills/` (design-review references, ship-batch references) | MIT, licence files alongside each |

## Test suites and test data

| Item | Licence | Status |
| --- | --- | --- |
| [WebAssembly spec testsuite](https://github.com/WebAssembly/spec/tree/wg-1.0/test/core) (`test/core` of WebAssembly/spec, tag `wg-1.0`, shallow submodule at `packages/wasm/spec`) | Apache-2.0 (licence in `packages/wasm/spec/test/LICENSE`, served at `/glass-compiler/wasm/licenses/WEBASSEMBLY-TESTSUITE-LICENSE.txt`) | Glass Wasm: the 73 `.wast` files are bundled into the Glass Wasm page so it can run them in the browser |
| [c-testsuite](https://github.com/c-testsuite/c-testsuite) | Runner MIT (c) 2018 Andrew Chambers; individual test cases carry their own licence in `.otag` files | *planned*, Small C (M4) |
| [Timendus chip8-test-suite](https://github.com/Timendus/chip8-test-suite) | GPL-3.0 (third-party listings; Corax+ test is MIT). Used at test time only, not bundled, unless the licence check at M5 allows it | *planned*, Glass Console (M5) |
| [Mooneye test suite](https://github.com/Gekkio/mooneye-test-suite), Blargg's Game Boy tests | To verify at M5 (Blargg's tests are listed as "mixed") | *planned*, Glass Console (M5) |
| Game Boy and CHIP-8 homebrew ROMs | Only freely licensed ones, each credited here with its licence; commercial ROMs are never hosted | *planned*, Glass Console (M5) |
