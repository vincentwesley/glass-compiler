# Acceptance checks

Every check a script can run, per package. A package counts as done only when all
of its checks pass. Then come the `visual-check` and `design-review` skills and a
stranger's review at 375px and desktop, in dark and light. Results that a page
shows come from scripts and are never typed in by hand.

Run everything (about two minutes):

```sh
npm ci --ignore-scripts
npm run acceptance   # verify + site check + recorded-results check + every e2e suite
```

If the sandbox's Chromium build doesn't match Playwright, prefix the e2e runs with
`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-<build>/chrome-linux64/chrome`.

## Whole site

| Check | Command | Pass means |
| --- | --- | --- |
| Typecheck, lint, unit tests, build for every package | `npm run verify` | exit 0 |
| Assembled site | `npm run check:site` | every page has the strict CSP (no inline code, no other hosts), the credits card, the sign-off and the logo credit; every same-site link and asset resolves; no CSS or JS references another origin |
| Old URLs still served | `npm run check:site` (the link check) plus `packages/hub/tests/e2e` | `/glass-compiler/` is Glass Compiler; `/glass-compiler/series/` is the hub |

## glass-ui (`packages/glass-ui`)

| Check | Command | Pass means |
| --- | --- | --- |
| Kit unit tests | `npm test -w @glass/ui` | Store, Highlighter, Stepper actions and ticks, page partials (credits, sign-off, logo credit, escaping, no inline style or script) |
| Regression through its users | the Glass Compiler e2e suite | the compiler behaves exactly as before the extraction |

## Glass Compiler (`packages/compiler`)

| Check | Command | Pass means |
| --- | --- | --- |
| Unit tests (lexer, parser, compiler, VM, UI logic, README sample, every example's known output) | `npm test -w @glass/compiler` | 167 of 167 pass |
| Recorded results are current | `npm run check:results` | `packages/compiler/results.json` matches a fresh run |
| Browser flows, both themes, 1440px and 375px, axe, CSP | `npm run test:e2e -w @glass/compiler` | 72 pass, 4 skipped on purpose (the README screenshot generator) |
| Pixel identity through the M1 restructure | a one-off screenshot diff, recorded in HANDOVER | identical at 1440 and 375, dark and light, before the credits card was added |

## Hub (`packages/hub`)

| Check | Command | Pass means |
| --- | --- | --- |
| Renderer unit tests | `npm test -w @glass/hub` | site config invariants (compiler at the root, unique slugs and paths), live cards link, planned tiles never link, grades and escaping |
| Browser flows on the assembled site | `npm run test:e2e -w @glass/hub` | both pages in both themes at both widths: no console errors, no other origins, no overflow, axe clean. Dark by default under an OS light preference. The toggle persists. Hub ↔ compiler navigation works. The page works with JavaScript off. |

## Glass Wasm (`packages/wasm`), milestone 2

| Check | Command | Pass means |
| --- | --- | --- |
| Rust unit tests | `cargo test -p glass-wasm` | decoder, validator, interpreter and text-parser unit tests |
| Spec testsuite (`wg-1.0`), integer and control-flow files | `cargo run -p glass-wasm --bin glass-wasm -- spec packages/wasm/testsuite` | every command in `i32`, `i64`, `block`, `loop`, `if`, `br`, `br_if`, `br_table`, `call`, `return`, `local_get/set/tee`, `nop`, `unreachable` passes. Per-file counts recorded in `packages/wasm/results.json` |
| The page's live count equals the recorded count | `npm run test:e2e -w @glass/wasm` | the browser runs the same files and shows the same numbers |
| Debugger flows | same e2e suite | step through a module; value stack, locals, frames and memory update; axe clean |

## Later members

Each gets its section here when its milestone starts, in the same shape: the
grading suite, the exact command, and what "pass" means.

| Member | Grading suite |
| --- | --- |
| Small C | c-testsuite pass count, with every skip listed with a reason |
| Glass Console | CHIP-8 test ROM results, then the Blargg and Mooneye pass list |
| Glass Kernel | known-answer system-call tests |
| Language Tools | LSP request/response tests |
| Wasm JIT | the spec testsuite plus benchmarks against the interpreter |
