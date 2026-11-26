import { defineConfig, devices } from '@playwright/test';

const PORT = 4176;
const executablePath = process.env.PW_CHROMIUM_PATH;

// Runs against the assembled site (_site/), like the hub's suite.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}/glass-compiler/small-c/`,
    trace: 'off',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, hasTouch: true } },
  ],
  webServer: {
    command: `npm run build --prefix ../.. && node ../../scripts/serve-site.mjs ${PORT}`,
    url: `http://localhost:${PORT}/glass-compiler/small-c/`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
