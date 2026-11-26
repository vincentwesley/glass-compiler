import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;
const executablePath = process.env.PW_CHROMIUM_PATH;

// Runs against the whole assembled site (_site/), so links between the hub and
// the members are tested for real.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/glass-compiler/series/`,
    trace: 'off',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, hasTouch: true } },
  ],
  webServer: {
    command: `npm run build --prefix ../.. && node ../../scripts/serve-site.mjs ${PORT}`,
    url: `http://localhost:${PORT}/glass-compiler/series/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
