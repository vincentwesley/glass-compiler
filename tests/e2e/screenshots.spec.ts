import { test } from '@playwright/test';

// Regenerates the README screenshots. Run with: SCREENSHOTS=1 npm run test:e2e -- screenshots
test.skip(!process.env.SCREENSHOTS, 'Set SCREENSHOTS=1 to regenerate docs/screenshots.');

for (const theme of ['dark', 'light'] as const) {
  test(`screenshot ${theme}`, async ({ page }, info) => {
    await page.addInitScript((t) => {
      localStorage.setItem('glass-tour-done', '1');
      if (t === 'light') localStorage.setItem('glass-theme', 'light');
    }, theme);
    await page.goto('./');
    await page.locator('[data-testid="examples"]').selectOption('fibonacci');
    await page.locator('.tnode', { hasText: /Binary\s*\+/ }).first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `docs/screenshots/${info.project.name}-${theme}.png` });
  });
}
