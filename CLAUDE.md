# The Glass series: notes for Claude

This repo is the home of the Glass series ("computers you can see through"): one
npm workspace per member plus a shared debugger kit and a hub site, deployed as
one static site to GitHub Pages under `/glass-compiler/`. When resuming, read in
this order:

1. `docs/next-session.md`
2. `docs/HANDOVER.md`
3. `docs/PLAN.md`
4. `docs/DECISIONS.md` (series, S1…)
5. `docs/ACCEPTANCE.md`

Owner-wide rules (house style, brand and credits, verification tiers, autonomy)
are in `docs/HOUSE-RULES.md`. The house kit is vendored in `vendor/house/`, and
the `design-review`, `visual-check` and `ship-batch` skills in `.claude/skills/`.
Anything that needs the owner goes in `docs/NEEDS-VIN.md`.

## Commands (from the repo root)

- `npm ci --ignore-scripts`: install. Never run install scripts.
- `npm run dev`: Glass Compiler dev server at `/glass-compiler/`.
- `npm run verify`: typecheck, lint, unit tests and build for every package,
  then assemble `_site/`. Run before every push.
- `npm run verify -w @glass/<pkg>`: one package.
- `npm run check:site`: CSP, credits, links and same-origin check of `_site/`.
- `npm run test:e2e`: Playwright + axe for every package. **Never** run
  `playwright install` in a cloud session. If the pre-installed Chromium build
  differs from the one this Playwright version expects, point at it with
  `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-<build>/chrome-linux64/chrome`.
- `npm run acceptance`: everything in docs/ACCEPTANCE.md.
- `node scripts/record-results.mjs <member>`: re-record the results the hub
  shows. Never edit `results.json` by hand.
- Rust (Glass Wasm): `git submodule update --init --depth 1` once for the
  testsuites (WebAssembly and c-testsuite), then `cargo test -p glass-wasm`, `npm run spec -w @glass/wasm`,
  `cargo fmt --check -p glass-wasm` and
  `cargo clippy -p glass-wasm --all-targets -- -D warnings`. The toolchain is
  pinned in `rust-toolchain.toml`. The page loads the VM built for
  `wasm32-unknown-unknown` (`npm run build:wasm -w @glass/wasm`).

## Layout

- `site.config.mjs`: every page's path and status. Glass Compiler stays at the
  site root (`path: ''`) so its old links work.
- `packages/glass-ui/`: shared kit (dom, Store, Highlighter, Stepper, tour,
  theme, styles, brand, credits, the `glass-pages` Vite plugin and shared
  `public/`).
- `packages/compiler/`: Glass Compiler. `src/lang/` has no DOM imports.
- `packages/wasm/`: Glass Wasm. `crate/` is the Rust VM (no dependencies),
  `spec/` the testsuite submodule, and `src/` the debugger page.
- `packages/small-c/`: Small C. `src/lang/` is the compiler (no DOM imports),
  `libc.ts` the C library in C, `testsuite/` the c-testsuite submodule.
  `npm run testsuite -w @glass/small-c` grades it.
- `packages/wasm-encode/`: the WebAssembly encoder shared by both compilers.
- `packages/hub/`: the series site, rendered from data at build time.
- `scripts/`: site assembly, site checks, the static server and the results
  recorder.

## Rules

- Keep every page's CSP strict: no inline scripts or styles, no third-party
  hosts, no `eval` or `new Function`. Only pages that run WebAssembly may add
  `'wasm-unsafe-eval'`, and only Small C `worker-src 'self'` (DECISIONS S8).
- Dark theme is the default on `:root`; light only via `data-theme="light"`.
- Colours: bg `#11150e`, accent `#4fe0a0`, peach `#e9a07f`, lavender `#a996e0`
  (as tokens). Fonts: Space Grotesk, Inter, Silkscreen (labels only), JetBrains
  Mono, all from `@fontsource`.
- Square corners, pixel-frame cards, offset-shadow buttons. All motion respects
  `prefers-reduced-motion`.
- Every page ends with the credits card (`<!-- glass:credits project="…" -->`).
- Never break `/glass-compiler/` or its `#code=` share links.
- Commit as `vincentwesley <221810966+vincentwesley@users.noreply.github.com>`.
- GitHub Actions stay pinned to commit SHAs with least-privilege permissions.
  One CI workflow per package, filtered by path.
- Update `docs/HANDOVER.md` and `docs/next-session.md` after each milestone.
