import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('glass-tour-done', '1'));
  await page.goto('./');
  await expect(page.locator('.chip').first()).toBeVisible();
});

test('compiles the program to WebAssembly and checks it on this browser\'s own engine', async ({ page }) => {
  await page.locator('[data-testid="examples"]').selectOption('fibonacci');
  await expect(page.locator('#wasm-meta')).toContainText('bytes');
  await expect(page.locator('#panel-wasm .chunk-title')).toHaveText([/\$main/, /\$fib/]);
  await expect(page.locator('.wasm-check')).toHaveText(/same output as the VM/);
  await expect(page.locator('.wasm-runtime summary')).toContainText('Runtime library');
});

test('a WebAssembly instruction and its Pane node select each other', async ({ page }) => {
  await page.locator('[data-testid="examples"]').selectOption('fibonacci');
  // Click the first call to $rt.add: the + it came from is selected in the tree.
  await page.locator('.winstr', { hasText: 'call $rt.add' }).first().click();
  await expect(page.locator('.tnode.is-selected')).toHaveText(/\+/);
  // And selecting a tree node lights up its WebAssembly.
  await page.locator('.tnode', { hasText: 'fib()' }).first().click();
  expect(await page.locator('.winstr.is-selected').count()).toBeGreaterThan(0);
});

test('runtime errors match too, and broken programs make no module', async ({ page }) => {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('print "a" * 2;');
  await expect(page.locator('.wasm-check')).toHaveText(/same output and error as the VM/);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('print 1 + ;');
  await expect(page.locator('#wasm-meta')).toHaveText('no module');
  await expect(page.getByTestId('open-in-glass-wasm')).toHaveAttribute('aria-disabled', 'true');
});

test('a program that never finishes is not run on the real engine', async ({ page }) => {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('while true { }');
  await expect(page.locator('.wasm-check')).toHaveText(/Not run here/);
});

// The hand-off to Glass Wasm crosses pages, so it is tested on the assembled site (packages/hub/tests/e2e/pipeline.spec.ts).
