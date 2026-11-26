#!/usr/bin/env node
// Headless screenshots (375/768/1280 x dark/light) + axe + reduced-motion + off-origin checks for a running site.
// Usage (from the target project root): node visual-check.mjs <baseUrl> [path ...]
// Resolves @playwright/test and @axe-core/playwright from the target project, not from this plugin.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [base, ...paths] = process.argv.slice(2);
if (!base) { console.error('usage: visual-check.mjs <baseUrl> [path ...]'); process.exit(2); }
const require = createRequire(join(process.cwd(), 'package.json'));
let chromium, AxeBuilder;
try {
  ({ chromium } = require('@playwright/test'));
  AxeBuilder = require('@axe-core/playwright').default ?? require('@axe-core/playwright').AxeBuilder;
} catch (e) {
  console.error('Install in the target project: npm i -D @playwright/test @axe-core/playwright && npx playwright install chromium');
  process.exit(2);
}

const widths = [375, 768, 1280];
const themes = ['dark', 'light'];
const out = 'qa-output';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const axeReport = {};
let violations = 0, offOrigin = 0, motion = 0;

for (const p of paths.length ? paths : ['/']) {
  const slug = p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
  for (const theme of themes) {
    for (const width of widths) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const origin = new URL(base).origin;
      page.on('request', r => { if (/^https?:/.test(r.url()) && new URL(r.url()).origin !== origin) { offOrigin++; console.log(`FAIL ${slug} ${width} ${theme}: off-origin ${r.url()}`); } });
      await page.goto(new URL(p, base).href, { waitUntil: 'networkidle' });
      if (theme === 'light') await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
      await page.screenshot({ path: join(out, `${slug}-${width}-${theme}.png`), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) console.log(`WARN ${slug} ${width} ${theme}: horizontal scroll`);
      if (width === 1280) {
        await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
        await page.locator('a,button').first().hover().catch(() => {});
        const anims = await page.evaluate(() => document.getAnimations().length);
        if (anims) { motion++; console.log(`FAIL ${slug} ${theme}: ${anims} running animations under reduced motion`); }
        const r = await new AxeBuilder({ page }).analyze();
        axeReport[`${slug}-${theme}`] = r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
        violations += r.violations.length;
      }
      await ctx.close();
    }
  }
}
await browser.close();
writeFileSync(join(out, 'axe.json'), JSON.stringify(axeReport, null, 2));
console.log(`done: ${Object.keys(axeReport).length} axe runs, ${violations} violation types, ${offOrigin} off-origin requests, ${motion} reduced-motion failures -> ${out}/`);
process.exit(violations || offOrigin || motion ? 1 : 0);
