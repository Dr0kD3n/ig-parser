const { test, expect } = require('@playwright/test');

test.describe('IG-Bot Isolated E2E Flow', () => {
    test.setTimeout(120000);

    test('should login, add account and open browser without errors', async ({ page }) => {
        console.log('Step 1: Navigating to App');
        await page.goto('http://localhost:5005', { waitUntil: 'load' });

        // Step 1: Login
        const emailInput = page.locator('input[type="email"]');
        if (await emailInput.isVisible({ timeout: 5000 })) {
            console.log('Logging in...');
            await page.fill('input[type="email"]', 'admin@igbot.com');
            await page.fill('input[type="password"]', 'admin123');
            await page.click('button:has-text("INITIALIZE SESSION")');
        }

        await expect(page.locator('.logo')).toBeVisible({ timeout: 20000 });
        console.log('Login successful');

        // Wait for login toast to clear
        await page.waitForTimeout(1000);

        // Step 2: Add Account (Name only)
        console.log('Step 2: Adding account...');
        await page.click('button:has-text("Настройки"), button:has-text("Settings"), button:has-text("Configuration")');

        const randomName = Math.random().toString(36).substring(2, 10);
        console.log(`Using random account name: ${randomName}`);

        await page.fill('#new-acc-name', randomName);
        await page.fill('#new-acc-proxy', '');
        await page.fill('#new-acc-cookies', '');

        await page.click('button:has-text("Добавить"), button:has-text("Add")');

        const card = page.locator('.account-card').filter({ hasText: randomName });
        await expect(card).toBeVisible({ timeout: 10000 });
        console.log(`Account "${randomName}" added successfully`);

        // Step 3: Open Browser
        console.log('Step 3: Opening browser...');
        // Find the browser button within the correct card
        const browserBtn = card.locator('button:has-text("Браузер"), button:has-text("Browser")');
        await expect(browserBtn).toBeVisible({ timeout: 5000 });
        await browserBtn.click();

        console.log('Waiting for "Browser started" toast response...');

        // Wait for toast that contains 'Browser' or 'Браузер' but is NOT the login toast
        const browserToast = page.locator('div[role="status"]:has-text("Browser"), div[role="status"]:has-text("Браузер")');
        await expect(browserToast).toBeVisible({ timeout: 25000 });

        const toastText = await browserToast.innerText();
        console.log('Toast detected:', toastText);

        expect(toastText.toLowerCase()).not.toContain('error');
        expect(toastText.toLowerCase()).not.toContain('ошибка');

        console.log('Isolated E2E Test Passed: Login, Add, and Browser Open functional.');
    });
});
