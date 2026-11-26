#!/usr/bin/env node
// Checks the assembled site in _site/: every page has the strict CSP and the
// house credits, every same-site link and asset resolves to a file, and nothing
// loads from another origin. Run after `npm run build`.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, posix } from 'node:path';
import { SITE } from '../site.config.mjs';

const root = resolve(import.meta.dirname, '..', '_site');
const CSP_REQUIRED = ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'none'"];
const problems = [];

function* files(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) yield* files(p);
    else yield p;
  }
}

const exists = (urlPath) => {
  const clean = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  const p = join(root, clean);
  if (existsSync(p) && statSync(p).isFile()) return true;
  return existsSync(join(p, 'index.html'));
};

let pages = 0;
for (const file of files(root)) {
  if (!file.endsWith('.html')) continue;
  pages++;
  const rel = '/' + file.slice(root.length + 1).replaceAll('\\', '/');
  const html = readFileSync(file, 'utf8');
  const csp = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
  if (!csp) problems.push(`${rel}: no CSP meta tag`);
  else {
    for (const d of CSP_REQUIRED) if (!csp.includes(d)) problems.push(`${rel}: CSP lacks ${d}`);
    // 'wasm-unsafe-eval' (compile WebAssembly, nothing else) is allowed; JavaScript eval is not.
    if (/'unsafe-inline'|'unsafe-eval'|https?:/.test(csp)) problems.push(`${rel}: CSP allows inline code, eval or another host`);
    if (csp.includes("'wasm-unsafe-eval'") && !rel.startsWith(`${SITE.base}wasm/`)) problems.push(`${rel}: only Wasm pages may allow 'wasm-unsafe-eval'`);
  }
  if (/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>/.test(html)) problems.push(`${rel}: inline <script>`);
  if (/\sstyle="/.test(html)) problems.push(`${rel}: inline style attribute`);
  if (!html.includes("Copyright 2026 Vin's Atelier.") || !html.includes('Designed and built by Vin.')) problems.push(`${rel}: missing the house sign-off`);
  if (!html.includes('class="creator"')) problems.push(`${rel}: missing the credits card`);
  if (!html.includes('@portus_workstation')) problems.push(`${rel}: missing the logo artist credit`);
  // <link href> loads things (stylesheets, preloads, icons); only rel=canonical may point elsewhere.
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    const href = /\shref="(https?:\/\/[^"]+)"/.exec(tag)?.[1];
    if (href && !/\srel="canonical"/.test(tag)) problems.push(`${rel}: <link> loads ${href} from another origin`);
  }
  for (const [, attr, url] of html.matchAll(/\s(src|href)="([^"]+)"/g)) {
    if (/^(mailto:|#|data:)/.test(url)) continue;
    if (/^https?:\/\//.test(url)) {
      if (attr === 'src') problems.push(`${rel}: loads ${url} from another origin`);
      continue; // outbound <a> links are fine; <link> loads are checked above
    }
    const target = url.startsWith('/') ? url : posix.join(dirname(rel), url);
    if (!target.startsWith(SITE.base)) problems.push(`${rel}: ${url} points outside ${SITE.base}`);
    else if (!exists(target)) problems.push(`${rel}: broken ${attr} ${url}`);
  }
}
for (const file of files(root)) {
  if (!file.endsWith('.css') && !file.endsWith('.js')) continue;
  const text = readFileSync(file, 'utf8');
  const hit = /(?:url\(|import\(|from\s*['"]|fetch\()\s*['"]?(https?:\/\/[^'")\s]+)/.exec(text);
  if (hit) problems.push(`${file.slice(root.length)}: references ${hit[1]}`);
}
if (pages === 0) problems.push('no pages found: run npm run build first');
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`check-site: ${pages} pages OK (CSP, credits, links, assets, same-origin only)`);
