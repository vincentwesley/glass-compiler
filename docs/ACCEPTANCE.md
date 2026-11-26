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
| Unit tests (lexer, parser, compiler, VM, UI logic, README sample, every example's known output) | `npm test -w @glass/compiler` | 251 of 251 pass (167 for the language and UI, 84 for the WebAssembly back end) |
| Recorded results are current | `npm run check:results` | `packages/compiler/results.json` matches a fresh run |
| Browser flows, both themes, 1440px and 375px, axe, CSP | `npm run test:e2e -w @glass/compiler` | 80 pass, 4 skipped on purpose (the README screenshot generator) |
| Pixel identity through the M1 restructure | a one-off screenshot diff, recorded in HANDOVER | identical at 1440 and 375, dark and light, before the credits card was added |

## Hub (`packages/hub`)

| Check | Command | Pass means |
| --- | --- | --- |
| Renderer unit tests | `npm test -w @glass/hub` | site config invariants (compiler at the root, unique slugs and paths), live cards link, planned tiles never link, grades and escaping |
| Browser flows on the assembled site | `npm run test:e2e -w @glass/hub` | both pages in both themes at both widths: no console errors, no other origins, no overflow, axe clean. Dark by default under an OS light preference. The toggle persists. Hub ↔ compiler navigation works. The page works with JavaScript off. |

## Glass Wasm (`packages/wasm`)

Needs the testsuite submodule: `git submodule update --init --depth 1`.

| Check | Command | Pass means |
| --- | --- | --- |
| Rust format and lints | `cargo fmt --check -p glass-wasm && cargo clippy -p glass-wasm --all-targets -- -D warnings` | clean |
| Rust unit tests | `cargo test -p glass-wasm` | 22 pass: float literals and rounding, LEB128 and binary errors, lexer, text parser (names, folding, abbreviations, malformed cases), validator, debugger sessions, a small spec script |
| **The WebAssembly 1.0 spec testsuite** (WebAssembly/spec `wg-1.0`, `test/core`, 73 files) | `npm run spec -w @glass/wasm` | **19,270 of 19,270 commands pass, 73 of 73 files** (grading rules: DECISIONS S14) |
| Recorded results are current | `npm run check:results` | `packages/wasm/results.json` matches a fresh CLI run |
| The VM built for the browser | `npm test -w @glass/wasm` | 11 pass: spec scripts run, errors are explained, every example gives its known answer (120, 55, "ssalg" in memory, five printed squares, a jump-table result, a divide-by-zero trap), and replaying to any step agrees with the trace |
| Debugger flows, both themes, 1440px and 375px | `npm run test:e2e -w @glass/wasm` | 25 pass: axe clean, no console errors, no other origins, no overflow, step forwards and back, recursion frames, instruction ↔ source ↔ timeline linking, keyboard navigation, memory reads and writes, host output, traps, invalid modules, arguments, share links, the page without JavaScript, and **the whole testsuite run in the browser matching the recorded counts** |

## The pipeline: Pane → WebAssembly (M3)

| Check | Command | Pass means |
| --- | --- | --- |
| Back end vs bytecode VM on this engine's WebAssembly | `npm test -w @glass/compiler` (`wasm-backend.test.ts`) | 84 pass: every operator and formatting case, all runtime errors with identical text, scope, recursion, call-depth limit, every example and the README sample, UTF-8 source offsets, the 255-parameter limit |
| The same modules in Glass Wasm | `npm test -w @glass/wasm` (`pane.test.ts`) | every example and error case identical; source map and names decoded; number formatting identical to JavaScript on 100,000 random values |
| The WebAssembly stage in the browser | `npm run test:e2e -w @glass/compiler` (`wasm-stage.spec.ts`) | live check "same output as the VM", node ↔ instruction linking, errors, no module for broken programs, no native run for runaway programs |
| Compiler → Glass Wasm → back | `npm run test:e2e -w @glass/hub` (`pipeline.spec.ts`) | the link carries the module; output, traps and Pane-decoded values appear in Glass Wasm; "Edit it in Glass Compiler" returns |

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
