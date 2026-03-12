const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: 1,
    reporter: 'html',
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'on-first-retry',
        viewport: { width: 1280, height: 720 },
        headless: false,
    },
    projects: [
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                channel: 'chrome-beta'
            },
        },
    ],
    webServer: [
        {
            command: 'node backend/server.js',
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
                VITE_PROXY_BACKEND: 'true'
            }
        }
    ],
});
