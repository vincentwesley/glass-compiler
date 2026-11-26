import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** The shared static files every Glass page serves (theme pre-paint script, favicon, font licence, humans.txt, credits art). */
export const SHARED_PUBLIC_DIR = here('../public');

/** Marker comments a page's index.html can use, and the partial each one becomes. */
export const PARTIALS: Readonly<Record<string, string>> = {
  signoff: here('../brand/signoff.html'),
  credits: here('../brand/credits.html'),
  mark: here('../brand/mark.html'),
};

const MARKER = /<!--\s*glass:([a-z-]+)((?:\s+[a-z-]+="[^"]*")*)\s*-->/g;
const ATTR = /([a-z-]+)="([^"]*)"/g;
const LEADING_NOTE = /^\s*<!--(?!\s*glass:)[\s\S]*?-->\s*/;
const VAR = /\{\{([A-Z_]+)\}\}/g;

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Replace every `<!-- glass:name key="value" -->` marker with its partial.
 * Attributes fill `{{KEY}}` placeholders (HTML-escaped); partials may contain
 * further markers. Unknown markers and unfilled placeholders are errors, not
 * silent gaps.
 */
export function injectPartials(html: string, read: (name: string) => string, depth = 0): string {
  if (depth > 4) throw new Error('Glass partials nest too deeply');
  return html.replace(MARKER, (_, name: string, attrs: string) => {
    if (!(name in PARTIALS)) throw new Error(`Unknown Glass partial <!-- glass:${name} -->`);
    const vars = new Map<string, string>();
    for (const [, key, value] of attrs.matchAll(ATTR)) vars.set(key!.toUpperCase().replace(/-/g, '_'), value!);
    const body = read(name)
      .replace(LEADING_NOTE, '')
      .replace(VAR, (_m, key: string) => {
        const value = vars.get(key);
        if (value === undefined) throw new Error(`<!-- glass:${name} --> needs ${key.toLowerCase()}="..."`);
        return escapeHtml(value);
      });
    return injectPartials(body, read, depth + 1).trim();
  });
}

/**
 * The Glass pages plugin: every Glass page serves the shared public files and
 * gets its shared chrome (sign-off, credits) as static HTML at build time, so it
 * works without JavaScript and needs no inline script or style.
 */
export function glassPages(): Plugin {
  return {
    name: 'glass-pages',
    config(config) {
      return config.publicDir === undefined ? { publicDir: SHARED_PUBLIC_DIR } : {};
    },
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => injectPartials(html, (name) => readFileSync(PARTIALS[name]!, 'utf8')),
    },
  };
}
