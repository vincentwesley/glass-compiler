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

async function open(page: Page, opts: { theme?: 'light'; hash?: string } = {}) {
  await page.addInitScript((theme) => {
    localStorage.setItem('glass-wasm-tour-done', '1');
    if (theme) localStorage.setItem('glass-theme', theme);
  }, opts.theme);
  await page.goto(`./${opts.hash ?? ''}`);
  await expect(page.locator('#source-status')).toHaveText('Valid · instantiated');
}

const status = (page: Page) => page.locator('.vm-status');

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}: loads with no errors, no other origins, no overflow, axe clean`, async ({ page }) => {
    const problems = watch(page);
    await open(page, { theme: theme === 'light' ? 'light' : undefined });
    await expect(status(page)).toContainText('Step 0 of');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    expect(problems).toEqual([]);
  });
}

test('steps the factorial to its answer, forwards and back', async ({ page }) => {
  await open(page);
  await page.getByTestId('wasm-step').click();
  await expect(status(page)).toContainText('Step 1 of');
  await expect(page.locator('.stack .slot-top')).toContainText('5');
  await page.getByTestId('wasm-back').click();
  await expect(status(page)).toContainText('Step 0 of');
  await page.getByRole('button', { name: 'Jump to the end' }).click();
  await expect(status(page)).toContainText('Finished');
  await expect(status(page)).toContainText('120');
});

test('recursion shows one frame per call', async ({ page }) => {
  await open(page);
  // Scrub to the middle of the run: several $fac frames are live.
  const scrub = page.getByTestId('wasm-scrub');
  const max = Number(await scrub.getAttribute('max'));
  await scrub.fill(String(Math.floor(max / 2)));
  expect(await page.locator('.frames .frame').count()).toBeGreaterThan(2);
});

test('selecting an instruction links it to the source and the timeline', async ({ page }) => {
  await open(page);
  await page.locator('.code-line', { hasText: 'i64.mul' }).click();
  await expect(page.locator('.code-line.is-selected')).toHaveCount(1);
  await expect(page.locator('#lineage')).toContainText('line 7, col 10');
  await expect(page.locator('#lineage')).toContainText('5×');
  // Follow selection jumped to the first step that runs it.
  await expect(page.locator('.code-line.is-selected.is-exec')).toHaveCount(1);
  expect(await page.locator('.tick-sel').getAttribute('d')).toMatch(/^M/);
  await page.getByTestId('lineage-next').click();
  await expect(page.locator('.code-line.is-selected.is-exec')).toHaveCount(1);
});

test('the code panel is keyboard navigable', async ({ page }) => {
  await open(page);
  await page.locator('.code-line').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.code-line').nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.code-line').nth(1)).toHaveClass(/is-selected/);
});

test('memory shows the reversed word and highlights each store', async ({ page }) => {
  await open(page);
  await page.getByTestId('examples').selectOption('memory');
  await expect(page.locator('#memory-meta')).toContainText('1 page');
  await expect(page.locator('.mem-ascii').filter({ hasText: 'glass' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Jump to the end' }).click();
  await expect(page.locator('.mem-ascii').filter({ hasText: 'ssalg' })).toHaveCount(1);
  // Find a step that stores: step back until the note says "wrote".
  const scrub = page.getByTestId('wasm-scrub');
  const max = Number(await scrub.getAttribute('max'));
  let found = false;
  for (let s = 1; s <= max && !found; s++) {
    await scrub.fill(String(s));
    found = ((await page.locator('.mem-note').textContent()) ?? '').includes('wrote');
  }
  expect(found).toBe(true);
  await expect(page.locator('.mem-write')).toHaveCount(1);
});

test('host output and traps are shown', async ({ page }) => {
  await open(page);
  await page.getByTestId('examples').selectOption('print');
  await page.getByRole('button', { name: 'Jump to the end' }).click();
  await expect(page.locator('.output li')).toHaveCount(5);
  await page.getByTestId('examples').selectOption('trap');
  await page.getByRole('button', { name: 'Jump to the end' }).click();
  await expect(page.locator('.vm-error')).toContainText('integer divide by zero');
  await expect(page.locator('.frames .frame')).toHaveCount(2);
});

test('a broken module is explained and nothing runs', async ({ page }) => {
  await open(page);
  await page.locator('#source').fill('(module (func (result i32) (i64.const 1)))');
  await expect(page.locator('#source-error')).toContainText('type mismatch');
  await expect(status(page)).toContainText('Not running');
  await expect(page.getByTestId('examples')).toHaveValue('own');
});

test('arguments can be changed and bad ones are refused', async ({ page }) => {
  await open(page);
  await page.locator('.arg').fill('10');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.getByRole('button', { name: 'Jump to the end' }).click();
  await expect(status(page)).toContainText('3628800');
  await page.locator('.arg').fill('ten');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(status(page)).toContainText('not a valid i64');
});

test('a share link opens the module it carries', async ({ page }) => {
  const wat = '(module (func (export "seven") (result i32) (i32.const 7)))';
  const b64 = Buffer.from(wat).toString('base64url');
  await open(page, { hash: `#wat=${b64}` });
  await expect(page.locator('#source')).toHaveValue(wat);
  await page.getByRole('button', { name: 'Jump to the end' }).click();
  await expect(status(page)).toContainText('7');
});

test('the whole testsuite runs in the browser and matches the recorded results', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'once is enough');
  test.setTimeout(120_000);
  await open(page);
  await page.locator('#spec-run').click();
  await expect(page.locator('#spec-status')).toContainText('Same as recorded', { timeout: 100_000 });
  await expect(page.locator('#spec-status')).toContainText('19,270 of 19,270');
  await expect(page.locator('.spec-table .live.is-fail')).toHaveCount(0);
});

test('without JavaScript the recorded results and credits are still there', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('http://localhost:4175/glass-compiler/wasm/');
  await expect(page.locator('.spec-table tbody tr')).toHaveCount(73);
  await expect(page.getByText("Copyright 2026 Vin's Atelier.")).toBeVisible();
  await ctx.close();
});
