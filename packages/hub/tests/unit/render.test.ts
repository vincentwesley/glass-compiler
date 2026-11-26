import { describe, expect, it } from 'vitest';
import { MEMBERS, SITE } from '../../../../site.config.mjs';
import { esc, gradeLine, gradeTable, memberCard, membersList, pipeline, type Results } from '../../build/render';

const compiler = MEMBERS.find((m) => m.slug === 'compiler')!;
const consoleMember = MEMBERS.find((m) => m.slug === 'console')!;
const results: Results = { member: 'compiler', suites: [{ name: 'Unit', passed: 167, failed: 0, skipped: 0, total: 167 }] };

describe('site config', () => {
  it('keeps Glass Compiler at the site root so every old link still works', () => {
    expect(SITE.base).toBe('/glass-compiler/');
    expect(compiler.path).toBe('');
    expect(compiler.status).toBe('live');
  });

  it('gives every member a unique slug and path', () => {
    expect(new Set(MEMBERS.map((m) => m.slug)).size).toBe(MEMBERS.length);
    expect(new Set(MEMBERS.map((m) => m.path)).size).toBe(MEMBERS.length);
  });
});

describe('hub rendering', () => {
  it('renders a live member as a card with links to the app, its page and its source', () => {
    const html = memberCard(compiler, 0, results);
    expect(html).toContain('href="/glass-compiler/"');
    expect(html).toContain('href="/glass-compiler/series/compiler/"');
    expect(html).toContain('/tree/main/packages/compiler');
    expect(html).toContain('167 of 167 pass');
  });

  it('renders a planned member as a dashed tile with no link at all', () => {
    const html = memberCard(consoleMember, 2, null);
    expect(html).toContain('member-tile');
    expect(html).toContain('Planned · M5');
    expect(html).not.toContain('<a ');
  });

  it('lists every member in order', () => {
    const html = membersList(() => null);
    const order = MEMBERS.map((m) => html.indexOf(`id="m-${m.slug}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('links a pipeline stop exactly when its member is live', () => {
    const html = pipeline();
    for (const slug of ['compiler', 'wasm', 'kernel', 'small-c']) {
      const m = MEMBERS.find((x) => x.slug === slug)!;
      expect(html.includes(`href="/glass-compiler/series/${slug}/"`), slug).toBe(m.status === 'live');
    }
    const planned = MEMBERS.map((m) => (m.slug === 'wasm' ? { ...m, status: 'live' as const } : m));
    expect(pipeline(planned).match(/series\/wasm\//g)).toHaveLength(2);
  });

  it('puts failures first in a grade line and mentions skips', () => {
    expect(gradeLine({ name: 'x', passed: 9, failed: 1, skipped: 2, total: 12 })).toBe('1 failing, 9 of 12 pass (2 skipped)');
    expect(gradeTable(null)).toContain('No recorded results yet');
    expect(gradeTable(results)).toContain('<td data-label="Pass">167</td>');
  });

  it('escapes text', () => {
    expect(esc(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
});
