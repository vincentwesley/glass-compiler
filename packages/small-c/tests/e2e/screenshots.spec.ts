import { test } from '@playwright/test';

// Regenerates the hub's Small C screenshot. Run with: SCREENSHOTS=1 npm run test:e2e -w @glass/small-c -- screenshots
test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to regenerate docs/screenshots.');

test('screenshot dark', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'desktop only');
  await page.addInitScript(() => localStorage.setItem('glass-small-c-tour-done', '1'));
  await page.goto('./');
  await page.locator('#examples').selectOption('list');
  await page.locator('.run-status', { hasText: 'Exited' }).waitFor();
  await page.locator('.winstr', { hasText: 'i32.load' }).first().click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: '../../docs/screenshots/small-c-desktop-dark.png' });
});
