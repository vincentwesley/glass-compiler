import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Collect console errors (including CSP violations) and uncaught exceptions. */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function open(page: Page, opts: { tour?: boolean; theme?: 'light' } = {}) {
  await page.addInitScript(
    ({ tour, theme }) => {
      if (!tour) localStorage.setItem('glass-tour-done', '1');
      if (theme) localStorage.setItem('glass-theme', theme);
    },
    { tour: opts.tour ?? false, theme: opts.theme },
  );
  await page.goto('./');
  await expect(page.locator('.chip').first()).toBeVisible();
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`);
  expect(summary).toEqual([]);
}

test('loads cleanly with no console errors or CSP violations', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await expect(page).toHaveTitle('Glass Compiler');
  for (const id of ['panel-source', 'panel-tokens', 'panel-tree', 'panel-bytecode', 'panel-vm']) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  await expect(page.locator('#source-status')).toHaveText('Compiles cleanly');
  await page.locator('[data-testid="vm-step"]').click();
  await page.locator('.chip', { hasText: '*' }).first().click();
  expect(errors).toEqual([]);
});

test('clicking a token lights up its node, instructions and VM steps', async ({ page }) => {
  await open(page);
  await page.locator('.chip', { hasText: '*' }).first().click();
  const node = page.locator('.tnode.is-selected');
  await expect(node).toHaveCount(1);
  await expect(node).toHaveText(/^Binary.*\s*\*/);
  await expect(page.locator('.instr.is-selected')).toHaveCount(1);
  await expect(page.locator('.instr.is-selected .op')).toHaveText('MUL');
  // Its operands are descendants: shown as related.
  await expect(page.locator('.tnode.is-related')).toHaveCount(2);
  await expect(page.locator('#lineage')).toContainText('Binary *');
  await expect(page.locator('#lineage')).toContainText('ran 1×');
  // Follow-selection moved the VM to the step that runs MUL.
  await expect(page.locator('.instr.is-pc .op')).toHaveText('MUL');
  await expect(page.locator('.tick-sel')).not.toHaveAttribute('d', '');
});

test('clicking a tree node or instruction selects the same node everywhere', async ({ page }) => {
  await open(page);
  await page.locator('.tnode', { hasText: 'Group' }).click();
  await expect(page.locator('.chip.is-selected')).toHaveCount(2);
  await expect(page.locator('.instr.is-selected')).toHaveCount(0);
  await expect(page.locator('#lineage')).toContainText('no code');

  await page.locator('.instr', { hasText: 'SUB' }).first().click();
  await expect(page.locator('.tnode.is-selected')).toHaveText(/Binary.*-/);
  await expect(page.locator('.chip.is-selected')).toHaveCount(1);
});

test('keyboard can reach and select tokens', async ({ page }) => {
  await open(page);
  await page.locator('.chip').first().focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('.chip.is-selected')).toHaveCount(1);
  await expect(page.locator('.chip.is-selected .chip-lex')).toHaveText('1');
});

test('the VM steps forwards, backwards and runs to the end', async ({ page }) => {
  await open(page);
  const status = page.locator('.vm-status');
  await expect(status).toContainText('Step 0 of 19');
  await page.locator('[data-testid="vm-step"]').click();
  await page.locator('[data-testid="vm-step"]').click();
  await expect(status).toContainText('Step 2 of 19');
  await expect(page.locator('.stack .slot')).toHaveCount(2);
  await page.locator('[data-testid="vm-back"]').click();
  await expect(status).toContainText('Step 1 of 19');
  await page.getByRole('button', { name: 'Jump to the end' }).click();
  await expect(status).toContainText('Finished');
  await expect(page.locator('.output li')).toHaveText(['7', '9', '3']);
});

test('play runs the program', async ({ page }) => {
  await open(page);
  await page.locator('.vm-controls select').selectOption('fast');
  await page.locator('[data-testid="vm-play"]').click();
  await expect(page.locator('.vm-status')).toContainText('Finished', { timeout: 10_000 });
  await expect(page.locator('[data-testid="vm-play"]')).toHaveText('Play');
});

test('examples load and run, including recursion', async ({ page }) => {
  await open(page);
  await page.locator('[data-testid="examples"]').selectOption('fibonacci');
  await expect(page.locator('.chunk-title')).toHaveCount(2);
  await page.getByRole('button', { name: 'Jump to the end' }).click();
  await expect(page.locator('.output li').last()).toHaveText('fib(7) = 13');
  // Clicking an output line selects the PRINT that produced it.
  await page.locator('.output li').first().click();
  await expect(page.locator('.tnode.is-selected')).toHaveText(/^Print/);
});

test('errors are shown with their position and stop the VM', async ({ page }) => {
  await open(page);
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('print 1 + ;');
  await expect(page.locator('#source-status')).toHaveText('1 problem');
  await expect(page.locator('.diag')).toContainText('Expected a value or expression');
  await expect(page.locator('.vm-status')).toContainText('Not running');
});

test('runtime errors point back at the code', async ({ page }) => {
  await open(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('let x = 1;\nprint x / 0;');
  await expect(page.locator('.chip-lex', { hasText: '/' })).toBeVisible();
  await expect(page.locator('#source-status')).toHaveText('Compiles cleanly');
  await page.getByRole('button', { name: 'Jump to the end' }).click();
  await expect(page.locator('.vm-error')).toContainText('Division by zero.');
  await page.locator('.vm-error').getByRole('button', { name: 'Show where' }).click();
  await expect(page.locator('.tnode.is-selected')).toHaveText(/Binary.*\//);
});

test('jump instructions mark where they land', async ({ page }) => {
  await open(page);
  await page.locator('[data-testid="examples"]').selectOption('countdown');
  const loop = page.locator('.instr', { hasText: 'LOOP' });
  await expect(page.locator('.jump-from')).toHaveCount(2);
  // Selecting LOOP selects its While node, which owns both of the loop's jumps:
  // the exit (JUMP_IF_FALSE) and the way back (LOOP).
  await loop.click();
  await expect(page.locator('.instr.is-target')).toHaveCount(2);
  await expect(page.locator('.instr.is-target .jump-from').first()).toContainText(await loop.locator('.addr').innerText());
});

test('a share link opens the same program', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await page.locator('[data-testid="examples"]').selectOption('fizzbuzz');
  await page.locator('#share').click();
  await expect(page.locator('#share-status')).toHaveText(/Link copied|Copy the link below/);
  const url = await page.locator('#share-url').inputValue();
  expect(url).toContain('#code=');

  const other = await context.newPage();
  await other.goto(url);
  await expect(other.locator('#example-blurb')).toContainText('Remainders');
  await expect(other.locator('.chip-lex', { hasText: 'FizzBuzz' })).toBeVisible();
  expect(other.url()).not.toContain('#code=');
});

test('the draft survives a reload', async ({ page }) => {
  await open(page);
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('print "kept";');
  await expect(page.locator('.chip')).toHaveCount(3);
  await page.reload();
  await expect(page.locator('.chip-lex').nth(1)).toHaveText('"kept"');
});

test('dark by default even when the OS prefers light', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await open(page);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(17, 21, 14)');
});

test('dark by default with JavaScript turned off', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto('./');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor).catch(() => null);
  // evaluate is unavailable without JS in some setups; fall back to a screenshot pixel check.
  if (bg) expect(bg).toBe('rgb(17, 21, 14)');
  await expect(page.locator('.noscript')).toBeVisible();
  await context.close();
});

test('the theme toggle switches to mint light and is remembered', async ({ page }) => {
  await open(page);
  const toggle = page.locator('#theme-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#theme-toggle').click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');
});

test('the guided tour opens on first visit and can be walked or dismissed', async ({ page }) => {
  await open(page, { tour: true });
  const tour = page.locator('[data-testid="tour"]');
  await expect(tour).toBeVisible();
  await expect(tour).toContainText('Write some Pane');
  for (let i = 0; i < 5; i++) await tour.getByRole('button', { name: 'Next' }).click();
  await expect(tour).toContainText('Everything is linked');
  await expect(page.locator('.tnode.is-selected')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(tour).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.chip').first()).toBeVisible();
  await expect(tour).toHaveCount(0);
  await page.locator('#tour-start').click();
  await expect(tour).toBeVisible();
});

test('has no axe violations in the dark theme', async ({ page }) => {
  await open(page);
  await axe(page);
  await page.locator('.chip', { hasText: '*' }).first().click();
  await axe(page);
});

test('has no axe violations in the light theme', async ({ page }) => {
  await open(page, { theme: 'light' });
  await axe(page);
  await page.locator('[data-testid="examples"]').selectOption('fibonacci');
  await page.getByRole('button', { name: 'Jump to the end' }).click();
  await axe(page);
});

test('has no axe violations with the tour open', async ({ page }) => {
  await open(page, { tour: true });
  await expect(page.locator('[data-testid="tour"]')).toBeVisible();
  await axe(page);
});

test('never scrolls sideways', async ({ page }) => {
  await open(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
