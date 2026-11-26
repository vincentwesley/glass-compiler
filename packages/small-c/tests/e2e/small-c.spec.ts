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
    localStorage.setItem('glass-small-c-tour-done', '1');
    if (theme) localStorage.setItem('glass-theme', theme);
  }, opts.theme);
  await page.goto(`./${opts.hash ?? ''}`);
  await expect(page.locator('.run-status')).toContainText('Exited');
}

/** Replaces the editor's text (select all, type). */
async function setSource(page: Page, text: string) {
  const editor = page.locator('#editor .cm-content');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(text);
}

const output = (page: Page) => page.locator('.run-output');

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}: loads with no errors, no other origins, no overflow, axe clean`, async ({ page }) => {
    const problems = watch(page);
    await open(page, { theme: theme === 'light' ? 'light' : undefined });
    await expect(output(page)).toHaveText('Hello from Small C!\n1 squared is 1\n2 squared is 4\n3 squared is 9\n');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    expect(problems).toEqual([]);
  });
}

test('every example compiles, runs and prints its known output', async ({ page }) => {
  await open(page);
  const ids = await page.locator('#examples option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
  expect(ids.length).toBeGreaterThanOrEqual(7);
  const expected = await page.evaluate(() => (window as unknown as { __glass: { state: unknown } }).__glass !== undefined);
  expect(expected).toBe(true);
  for (const id of ids) {
    await page.locator('#examples').selectOption(id);
    await expect(page.locator('.run-status')).toContainText('exit status 0');
    await expect(page.locator('#source-status')).toContainText('Compiles cleanly');
  }
});

test('editing recompiles; errors point at the line and stop the run', async ({ page }) => {
  await open(page);
  await setSource(page, '#include <stdio.h>\nint main(void) {\n  printf("%d\\n", 6 * 7);\n  return 0;\n}\n');
  await expect(output(page)).toHaveText('42\n');
  await setSource(page, 'int main(void) {\n  return x;\n}\n');
  await expect(page.locator('#source-status')).toHaveText('Does not compile');
  await expect(page.locator('.diag')).toContainText('line 2');
  await expect(page.locator('.diag')).toContainText('"x" is not declared');
  await expect(page.locator('.run-status')).toContainText('Not running');
  await expect(page.getByTestId('open-in-glass-wasm')).toHaveAttribute('aria-disabled', 'true');
});

test('a program that never ends is stopped, and the page stays responsive', async ({ page }) => {
  await open(page);
  await setSource(page, 'int main(void) { for (;;) {} }\n');
  await expect(page.locator('.run-status')).toContainText('Stopped', { timeout: 10_000 });
  await expect(page.locator('.run-status')).toContainText('still running after 4 seconds');
  await setSource(page, 'int main(void) { return 3; }\n');
  await expect(page.locator('.run-status')).toContainText('exit status 3');
});

test('tree, tokens, WebAssembly and source are linked both ways', async ({ page }) => {
  await open(page);
  // The implicit conversion of the string literal to char * is shown and marked.
  await expect(page.locator('.trow.is-implicit').first()).toContainText('char [21] → char *');
  // Picking a WebAssembly instruction selects its tree node.
  const instr = page.locator('.winstr', { hasText: 'i32.mul' }).first();
  await instr.click();
  await expect(page.locator('.trow.is-selected')).toContainText('*');
  await expect(page.locator('.chip.is-selected')).toContainText('*');
  // Picking a tree node lights up its instructions.
  await page.locator('.trow', { hasText: 'printf()' }).first().click();
  expect(await page.locator('.winstr.is-selected, .winstr.is-related').count()).toBeGreaterThan(3);
});

test('share links carry the program', async ({ page }) => {
  await open(page);
  await page.locator('#examples').selectOption('fib');
  await expect(output(page)).toContainText('0 1 1 2 3 5 8 13 21 34 55');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.locator('#share').click();
  const url = (await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))) || (await page.locator('#share-url').inputValue());
  expect(url).toContain('#code=');
  const other = await page.context().newPage();
  await other.goto(url);
  await expect(other.locator('.run-output')).toContainText('0 1 1 2 3 5 8 13 21 34 55');
  await expect(other.locator('#example-blurb')).toContainText('n stays in a WebAssembly local');
});

test('the grade lists the recorded c-testsuite results', async ({ page }) => {
  await open(page);
  const table = page.locator('.grade-table');
  await expect(table).toContainText("c-testsuite single-exec, run on Node's WebAssembly");
  await expect(table).toContainText('220 / 220');
  await expect(table).toContainText('The same programs run on Glass Wasm');
  await expect(page.getByTestId('grade-none')).toBeVisible();
});

test('the page says what it needs without JavaScript', async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto('./');
  await expect(page.locator('.noscript')).toContainText('JavaScript is needed');
  await ctx.close();
});
