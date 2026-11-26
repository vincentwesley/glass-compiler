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

// C in Small C → WebAssembly → Glass Wasm.
test('Small C\'s "Open in Glass Wasm" debugs the C program, and links back', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('glass-small-c-tour-done', '1'));
  await page.goto('http://localhost:4174/glass-compiler/small-c/');
  await page.locator('[data-testid="examples"]').selectOption('strings');
  await expect(page.locator('.run-output')).toHaveText('ssalg has 5 letters\n');
  await page.getByTestId('open-in-glass-wasm').click();
  await expect(page).toHaveURL(/\/wasm\/#wasm=/);
  await expect(page.locator('#source-status')).toHaveText('Valid · instantiated');
  await expect(page.locator('#pane-label')).toHaveText('C source');
  await expect(page.locator('#pane-source')).toContainText('void reverse(char *s)');
  await page.getByRole('button', { name: 'Jump to the end' }).click();
  await expect(page.locator('.vm-status')).toContainText('Exited');
  await expect(page.locator('.vm-status')).toContainText('exit status 0');
  await expect(page.locator('.output li')).toHaveText(['ssalg has 5 letters']);
  await page.getByRole('link', { name: 'Edit it in Small C' }).click();
  await expect(page).toHaveURL(/\/small-c\/(#.*)?$/);
  await expect(page.locator('.cm-content')).toContainText('void reverse(char *s)');
});

test('the Small C member page shows its grade', async ({ page }) => {
  await page.goto('http://localhost:4174/glass-compiler/series/small-c/');
  await expect(page.getByRole('heading', { level: 1, name: 'Small C' })).toBeVisible();
  await expect(page.locator('.grade-table')).toContainText('c-testsuite single-exec');
  await expect(page.locator('.grade-table tbody tr')).toHaveCount(3);
  await page.getByRole('link', { name: 'Open Small C' }).click();
  await expect(page).toHaveURL(/\/glass-compiler\/small-c\/$/);
});
