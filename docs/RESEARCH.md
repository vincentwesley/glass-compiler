# Research: the Glass series

Research for turning this repo into the home of the Glass series ("computers you
can see through"). Glass Compiler's own research notes are in
[`packages/compiler/docs/RESEARCH.md`](../packages/compiler/docs/RESEARCH.md).
Collected 2026-11-26. Each link was checked from this session unless it says otherwise.

## 1. Monorepo tooling for mixed TypeScript and Rust

- **Two workspaces side by side** is the established pattern. Tauri keeps a Cargo
  workspace for its crates next to a JS workspace for its packages
  ([DeepWiki: Tauri monorepo](https://deepwiki.com/tauri-apps/tauri/9.1-monorepo-structure)).
  Kito does the same
  ([DeepWiki: Kito](https://deepwiki.com/kitojs/kito/6.1-monorepo-structure)). A
  template exists at [spa5k/monorepo-typescript-rust](https://github.com/spa5k/monorepo-typescript-rust).
- **Task runners.** Nx has a Rust plugin that maps build and test onto Cargo
  ([Nx: polyglot monorepo with Rust](https://nx.dev/blog/polyglot-nx-monorepo-rust-tanstack),
  [Nx: add Rust](https://nx.dev/docs/kb/add-rust-to-nx-workspace)). Turborepo
  caches per-package npm scripts ([monorepo.tools](https://monorepo.tools/typescript)).
  2026 write-ups compare them
  ([dev.to: Turborepo vs Nx vs Bazel](https://dev.to/zny10289/monorepos-in-2026-turborepo-vs-nx-vs-bazel-what-actually-works-1gco)).
  Both are worth having at dozens of packages. Here we will have about eight, and the
  graph is shallow (everything depends on `glass-ui`; three packages depend on the
  Wasm VM).
- **Rust to Wasm without wasm-pack.** `cargo build --target wasm32-unknown-unknown`
  plus a small hand-written loader is enough for a crate that exports plain
  functions over linear memory. wasm-pack and wasm-bindgen add a second toolchain,
  and CLI versions must match the crate. They also generate JS glue we would have to
  audit for CSP. The `wasm32-unknown-unknown` target installs with `rustup target add`
  (tested in this session).
- **CSP and WebAssembly.** A page whose CSP has `script-src 'self'` cannot compile
  Wasm unless the policy adds `'wasm-unsafe-eval'`. That keyword allows
  WebAssembly only, not JavaScript `eval`
  ([MDN: script-src](https://developer.mozilla.org/docs/Web/HTTP/Headers/Content-Security-Policy/script-src),
  [WebAssembly CSP proposal](https://github.com/WebAssembly/content-security-policy/blob/main/proposals/CSP.md),
  [Chromium intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/5U_SgZ3r8QI/m/pnOzK2S3BAAJ)).
- **Per-package CI.** GitHub's workflow-level `on.paths` filter skips a whole
  workflow. [dorny/paths-filter](https://github.com/dorny/paths-filter) gates
  individual jobs, but it is another third-party action to pin and trust. One
  workflow per package with native `paths:` does the same job with no extra action.

## 2. Hosting: what a rename would do

- Renaming a repo redirects git and web URLs, **except GitHub Pages project
  sites** ([GitHub Docs: renaming a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)).
  This has been true since redirects launched
  ([GitHub blog, 2013](https://github.blog/news-insights/product-news/repository-redirects-are-here/)).
  After a rename to `glass`, `vincentwesley.github.io/glass-compiler/` would return 404.
- Creating a new repo under the old name breaks the repo redirect (same docs page).
  The community workaround is meta-refresh pages in the user site
  (`vincentwesley.github.io` repo)
  ([gist](https://gist.github.com/domenic/1f286d415559b56d725bee51a62c24a7)). A
  meta refresh drops the `#code=` fragment that Glass Compiler share links carry.
- **Conclusion:** keep the repo name and the Pages URL. The series lives under
  `/glass-compiler/` (see DECISIONS S2).

## 3. How strong multi-project series present themselves

What I took from projects I know well. These are from memory, not re-fetched today:

- **Bartosz Ciechanowski's articles** (ciechanow.ski): every concept is a live
  figure you can poke, and the prose sits right next to it. The lesson: show, then
  explain in one sentence.
- **Nand2Tetris** (nand2tetris.org): one ladder from gates up to an OS, where each
  rung uses the one below. The lesson for us: make the pipeline visible on the hub
  as a ladder (Pane → Wasm → Kernel) rather than a grid of unrelated cards.
- **Crafting Interpreters** (craftinginterpreters.com): one language built twice,
  with each chapter ending in something runnable. The lesson: every member page opens
  on a working demo, never a feature list.
- **The Rust and Bevy organisations' sites**: a calm hub with one card per crate,
  each showing a status and a version, and consistent chrome everywhere.
- **Compiler Explorer** (godbolt.org): colour-linked source and output lines. Glass
  already does this; the series extends it across members ("follow this program").

Hub design that follows from this: a short pitch, the pipeline ladder, one card per
member with its live pass count (spec tests, c-testsuite, test ROMs), and honest
status. Members that aren't built yet show as dashed "pending" tiles with no link
(house rule).

## 4. Best references per member

| Member | Scope model and references | Grading |
| --- | --- | --- |
| Glass Compiler | Crafting Interpreters (clox), matklad's Pratt parsing (see the package's research) | Unit and known-answer tests |
| Glass Wasm | [WebAssembly spec](https://webassembly.github.io/spec/core/), [wasmi](https://github.com/wasmi-labs/wasmi) (a Rust interpreter whose definitions closely follow the spec), wasm3 (fast interpreter, but not fully validating) | [WebAssembly/testsuite](https://github.com/WebAssembly/testsuite) (Apache-2.0), pinned at tag `wg-1.0` for the 1.0 feature set |
| Small C | [chibicc](https://github.com/rui314/chibicc) (scope model), its book draft, the C11 draft N1570 | [c-testsuite](https://github.com/c-testsuite/c-testsuite): runner MIT; test cases carry per-file licences in `.otag` files (checked in `tests/LICENSE`) |
| Glass Kernel | [xv6-riscv](https://github.com/mit-pdos/xv6-riscv) (scope model) and its book, RISC-V privileged spec (Sv32/Sv39) | Known-answer kernel tests and riscv-tests (licence to check at that milestone) |
| Glass Console | [Pan Docs](https://gbdev.io/pandocs/), [gbdev test ROM list](https://gbdev.gg8.se/wiki/articles/Test_ROMs), Cowgod's CHIP-8 reference | [Timendus chip8-test-suite](https://github.com/Timendus/chip8-test-suite) (GPL-3.0 per third-party listings; Corax+ is MIT); [Mooneye test suite](https://github.com/Gekkio/mooneye-test-suite); Blargg's tests (licence listed as "mixed" ([GameBrew](https://gamebrew.org/wiki/Blarggs_Gameboy_hardware_test_ROMs_GB)): check before bundling); [mealybug-tearoom-tests](https://github.com/mattcurrie/mealybug-tearoom-tests) |
| Language Tools | LSP 3.17 spec, rust-analyzer and matklad's resilient-parsing write-up, VS Code extension guide | LSP request/response known-answer tests |
| Wasm JIT | Cranelift and copy-and-patch papers, `dynasm-rs`, the x86-64 SDM | The same spec testsuite, plus benchmarks against the interpreter |

ROM licences decide what we may bundle. For GPL test ROMs we will **fetch them at
test time** (a pinned submodule) rather than ship them in the site, unless their
licence allows it. Commercial ROMs are never hosted.

## 5. Running the spec testsuite

- Most interpreters run the `.wast` scripts after converting them with WABT's
  `wast2json` ([docs](https://github.com/WebAssembly/wabt/blob/main/docs/wast2json.md),
  [spectest-interp man page](https://manpages.ubuntu.com/manpages/noble/man1/wast2json.1.html)).
  WABT release binaries download from this session.
- **Decision:** Glass Wasm parses `.wast` itself (S-expressions, the text format,
  and the `assert_*` commands) in Rust. Three reasons:
  1. The browser page can run the real testsuite files live, with no
     preprocessing step.
  2. Text-format `assert_malformed` cases become gradeable too.
  3. The text parser doubles as the debugger's "show me this module as WAT" view.

  WABT stays an optional cross-check, not a build dependency.
- Testsuite tags: `wg-1.0` (977f970…) is the 1.0 snapshot; `main` now mixes in
  2.0 and 3.0 features. Pin `wg-1.0` first, then move forward one proposal at a
  time (multi-value, sign-extension, bulk memory, and so on).

## 6. Claude Code skills, plugins and MCP servers

Used in this session:

- Vendored skills: `visual-check` (Playwright screenshots, axe, reduced-motion
  check), `design-review` (critique loop) and `ship-batch` (public-readiness gate).
- Built-in: `code-review` and `security-review` before each milestone PR, plus the
  GitHub MCP server for PRs, CI status and merging.
- Pre-installed Chromium plus Playwright for e2e and screenshots.

Would help, not available here (owner can add them later):

- **chrome-devtools MCP**: Lighthouse audits and performance traces from inside a
  session (the `visual-check` skill prefers it).
- **rust-analyzer LSP plugin**: go-to-definition and diagnostics across the Rust
  crates (cargo check covers us meanwhile).
- **A context7-style docs MCP**: up-to-date Rust and Vite API docs.
- **WABT** (`wast2json`, `wat2wasm`, `wasm-objdump`): optional differential checks
  of the Glass Wasm text parser and encoder.
