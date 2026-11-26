// One source of truth for the Glass series site: where each page lives, what it
// is, and whether it exists yet. Read by every Vite build, the hub, the site
// assembly script and the tests. See docs/DECISIONS.md S2 and S5.

/** The GitHub Pages project site. Change only together with docs/NEEDS-VIN.md (custom domain). */
export const SITE = {
  origin: 'https://vincentwesley.github.io',
  /** Every page lives under this path. */
  base: '/glass-compiler/',
  repo: 'https://github.com/vincentwesley/glass-compiler',
  name: 'Glass',
  tagline: 'Computers you can see through.',
};

/** The hub's own path under SITE.base. */
export const HUB_PATH = 'series/';

/**
 * The members, in pipeline order.
 * - path: where the app lives under SITE.base ('' = the site root, kept for Glass Compiler's old links)
 * - status: 'live' (built, deployed, graded) or 'planned' (a dashed tile on the hub, no link)
 * - pkg: the workspace folder whose dist/ is deployed at `path` (live members only)
 */
export const MEMBERS = [
  {
    slug: 'compiler',
    name: 'Glass Compiler',
    status: 'live',
    path: '',
    pkg: 'packages/compiler',
    milestone: 'M1',
    summary: 'Pane, a tiny language, compiled in front of you: tokens, a syntax tree, bytecode and a stack VM, every stage linked.',
    gradedBy: 'Unit tests on the lexer, parser, compiler and VM, plus browser checks with axe.',
  },
  {
    slug: 'wasm',
    name: 'Glass Wasm',
    status: 'live',
    path: 'wasm/',
    pkg: 'packages/wasm',
    milestone: 'M2',
    summary: 'A WebAssembly VM written from scratch in Rust, with a debugger for its value stack, locals, linear memory and call frames.',
    gradedBy: 'The official WebAssembly spec testsuite, pass count per .wast file.',
  },
  {
    slug: 'small-c',
    name: 'Small C',
    status: 'planned',
    path: 'small-c/',
    pkg: 'packages/small-c',
    milestone: 'M4',
    summary: 'A C-subset compiler to WebAssembly in the spirit of chibicc: tokens, tree and generated Wasm, then run in Glass Wasm.',
    gradedBy: 'c-testsuite, with every skipped test listed and explained.',
  },
  {
    slug: 'console',
    name: 'Glass Console',
    status: 'planned',
    path: 'console/',
    pkg: 'packages/console',
    milestone: 'M5',
    summary: 'A CHIP-8 machine, then a Game Boy, with registers, memory, tiles, sprites and the four sound channels on show.',
    gradedBy: 'CHIP-8 test ROMs, then the Blargg and Mooneye Game Boy test ROMs.',
  },
  {
    slug: 'kernel',
    name: 'Glass Kernel',
    status: 'planned',
    path: 'kernel/',
    pkg: 'packages/kernel',
    milestone: 'M6',
    summary: 'A tiny teaching OS on a simulated RISC-V machine: scheduler, page tables and faults, system calls and a file system.',
    gradedBy: 'Known-answer tests for every system call, running Pane and Small C programs.',
  },
  {
    slug: 'tools',
    name: 'Glass Language Tools',
    status: 'planned',
    path: 'tools/',
    pkg: 'packages/tools',
    milestone: 'M7',
    summary: 'A language server for Pane: live errors, hover, go-to-definition, rename and formatting, in VS Code and a web playground.',
    gradedBy: 'Language-server request and response tests.',
  },
];

/** Absolute URL path of a member's app, e.g. '/glass-compiler/' or '/glass-compiler/wasm/'. */
export const appPath = (member) => `${SITE.base}${member.path}`;
/** Absolute URL path of a member's hub page. */
export const hubPagePath = (member) => `${SITE.base}${HUB_PATH}${member.slug}/`;
