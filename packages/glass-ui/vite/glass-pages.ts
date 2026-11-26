import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/** The shared static files every Glass page serves (theme pre-paint script, favicon, font licence, humans.txt, credits art). */
export const SHARED_PUBLIC_DIR = here('../public');

/** Marker comments a page's index.html can use, and the partial each one becomes. */
export const PARTIALS: Readonly<Record<string, string>> = {
  signoff: here('../brand/signoff.html'),
};

const MARKER = /<!--\s*glass:([a-z-]+)\s*-->/g;

/** Replace every `<!-- glass:name -->` marker with its partial. Unknown markers are an error, not a silent gap. */
export function injectPartials(html: string, read: (name: string) => string): string {
  return html.replace(MARKER, (_, name: string) => {
    if (!(name in PARTIALS)) throw new Error(`Unknown Glass partial <!-- glass:${name} -->`);
    return read(name).trim();
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
