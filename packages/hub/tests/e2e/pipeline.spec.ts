import { expect, test } from '@playwright/test';

// The pipeline across the whole site: Pane in Glass Compiler → WebAssembly → Glass Wasm.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('glass-tour-done', '1');
    localStorage.setItem('glass-wasm-tour-done', '1');
  });
  await page.goto('http://localhost:4174/glass-compiler/');
  await expect(page.locator('.chip').first()).toBeVisible();
});

test('"Open in Glass Wasm" carries the module to the debugger, and back again', async ({ page }) => {
  await page.locator('[data-testid="examples"]').selectOption('fibonacci');
  await page.getByTestId('open-in-glass-wasm').click();
  await expect(page).toHaveURL(/\/wasm\/#wasm=/);
  await expect(page.locator('#source-status')).toHaveText('Valid · instantiated');
  await expect(page.locator('#pane-source')).toContainText('fn fib(n)');
  await page.getByRole('button', { name: 'Jump to the end' }).click();
  await expect(page.locator('.output li')).toHaveCount(8);
  await expect(page.locator('.output li').last()).toHaveText('fib(7) = 13');
  // Pane values are shown as Pane prints them.
  await expect(page.locator('.vm-globals')).toContainText('<fn fib>');
  await page.getByRole('link', { name: 'Edit it in Glass Compiler' }).click();
  await expect(page).toHaveURL(/\/glass-compiler\/(#.*)?$/);
  await expect(page.locator('.cm-content')).toContainText('fn fib(n)');
});

test('a compiled program that fails stops in Glass Wasm with the same message', async ({ page }) => {
  const editor = page.locator('.cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('fn half(n) { return n / 0; } print half(4);');
  await expect(page.locator('.wasm-check')).toHaveText(/same output and error/);
  await page.getByTestId('open-in-glass-wasm').click();
  await page.getByRole('button', { name: 'Jump to the end' }).click();
  await expect(page.locator('.vm-error')).toContainText('Division by zero.');
  // The trap happened inside the runtime library, called from $half.
  await expect(page.locator('.frames .frame-name').first()).toContainText('$main');
  await expect(page.locator('.frames')).toContainText('$half');
});
