const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const e2eDatabase = path.join(__dirname, 'config', 'database_e2e.sqlite').replace(/\\/g, '/');

module.exports = defineConfig({
  testDir: './tests/e2e',
  testIgnore: '**/farm-flow.dist.spec.js',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    viewport: { width: 1920, height: 1300 },
    headless: false,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: [
    {
      command: `npx cross-env E2E_TEST=1 AUTH_SKIP_REMOTE_VERIFY=1 PORT=1337 DATABASE_URL=${e2eDatabase} node backend/server.js`,
      port: 1337,
      timeout: 120000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'npm run dev --workspace=frontend',
      port: 5173,
      timeout: 120000,
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_PROXY_BACKEND: 'true',
        VITE_API_URL: 'http://127.0.0.1:1337',
      },
    },
  ],
});
