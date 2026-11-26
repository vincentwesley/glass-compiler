import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith('http://localhost:')) problems.push(`off-origin request: ${r.url()}`);
  });
  return problems;
}

async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

const PAGES = [
  { path: './', heading: 'Glass' },
  { path: 'compiler/', heading: 'Glass Compiler' },
  { path: 'wasm/', heading: 'Glass Wasm' },
];

for (const p of PAGES) {
  for (const theme of ['dark', 'light'] as const) {
    test(`${p.path} in ${theme}: no errors, no other origins, no overflow, axe clean`, async ({ page }) => {
      const problems = watch(page);
      if (theme === 'light') await page.addInitScript(() => localStorage.setItem('glass-theme', 'light'));
      await page.goto(p.path);
      await expect(page.getByRole('heading', { level: 1, name: p.heading, exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(theme === 'light' ? 'light' : null);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await axe(page);
      expect(problems).toEqual([]);
    });
  }
}

test('dark is the default even when the OS asks for light', async ({ browser }) => {
  const ctx = await browser.newContext({ colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.goto('http://localhost:4174/glass-compiler/series/');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(17, 21, 14)');
  await ctx.close();
});

test('the theme toggle switches to light and remembers it', async ({ page }) => {
  await page.goto('./');
  const toggle = page.getByRole('button', { name: 'Light theme' });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');
});

test('every member is listed; only live ones link anywhere', async ({ page }) => {
  await page.goto('./');
  const members = page.locator('.members > li');
  await expect(members).toHaveCount(6);
  await expect(page.locator('.member-planned a')).toHaveCount(0);
  await expect(page.locator('.member-live')).toHaveCount(2);
});

test('the hub opens Glass Compiler, and Glass Compiler links back to the series', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('link', { name: 'Open Glass Compiler' }).click();
  await expect(page).toHaveURL(/\/glass-compiler\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Glass Compiler' })).toBeVisible();
  await page.getByRole('link', { name: 'the Glass series' }).click();
  await expect(page).toHaveURL(/\/glass-compiler\/series\/$/);
});

test('the member page shows the recorded grade and links back', async ({ page }) => {
  await page.goto('compiler/');
  await expect(page.locator('.grade-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.grade-table td').first()).toHaveText(/^\d+$/);
  await page.getByRole('link', { name: 'The Glass series' }).click();
  await expect(page).toHaveURL(/\/series\/$/);
});

test('without JavaScript the hub still shows every member and the credits', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('http://localhost:4174/glass-compiler/series/');
  await expect(page.locator('.members > li')).toHaveCount(6);
  await expect(page.getByText("Copyright 2026 Vin's Atelier.")).toBeVisible();
  await expect(page.getByRole('link', { name: '@portus_workstation' })).toBeVisible();
  await ctx.close();
});
