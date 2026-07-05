const { defineConfig, devices } = require('@playwright/test');
const { DIST_DIR, DIST_EXE } = require('./tests/e2e/helpers/dist-paths');
const port = process.env.E2E_PORT || '5000';

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/farm-flow.dist*.spec.js',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'on-first-retry',
    viewport: { width: 1920, height: 1300 },
    headless: false,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `"${DIST_EXE}"`,
    cwd: DIST_DIR,
    port: Number(port),
    timeout: 120000,
    reuseExistingServer: !process.env.CI,
    env: {
      PORT: port,
      HOST: '127.0.0.1',
      AUTH_SKIP_REMOTE_VERIFY: '1',
    },
  },
});
