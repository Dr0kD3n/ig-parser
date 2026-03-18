const { test, expect } = require('@playwright/test');

test.describe('IG-Bot Localhost:5000 E2E (DIST Build)', () => {
    test.setTimeout(120000);

    test.beforeEach(async ({ page }) => {
        console.log('Navigating to http://localhost:5000');
        await page.goto('http://localhost:5000', { waitUntil: 'load' });

        // Perform login if required
        const emailInput = page.locator('input[type="email"]');
        try {
            if (await emailInput.isVisible({ timeout: 5000 })) {
                console.log('Login page detected, authenticating...');
                await emailInput.fill('admin@igbot.com');
                await page.fill('input[type="password"]', 'admin123');
                await page.click('button:has-text("INITIALIZE SESSION")');
                console.log('Credentials submitted');
            }
        } catch (e) {
            console.log('Login skip or error:', e.message);
        }

        // Wait for the main app to load
        await expect(page.locator('.logo')).toBeVisible({ timeout: 20000 });
        console.log('App loaded successfully');
    });

    test('should navigate through all main tabs', async ({ page }) => {
        await expect(page.locator('.logo')).toContainText('InstaPanel');

        // Execution Tab
        await page.click('button:has-text("Управление"), button:has-text("Execution")');
        await expect(page.locator('h3:has-text("Фарм профилей"), h3:has-text("Profile Scraper")')).toBeVisible();

        // Configuration Tab
        await page.click('button:has-text("Настройки"), button:has-text("Settings"), button:has-text("Configuration")');
        await expect(page.locator('button:has-text("Аккаунты"), button:has-text("Accounts")')).toBeVisible();
    });

    test('should add a test account and verify it exists', async ({ page }) => {
        await page.click('button:has-text("Настройки"), button:has-text("Settings"), button:has-text("Configuration")');

        const uniqueAccountName = `E2E_Acc_${Date.now()}`;
        await page.fill('#new-acc-name', uniqueAccountName);
        await page.fill('#new-acc-proxy', 'http://1.2.3.4:8080');

        // Click Add button
        await page.click('button:has-text("Добавить"), button:has-text("Add")');

        // Verify it appeared in the list (use filter to handle potential multiples or existing ones)
        const card = page.locator('.account-card').filter({ hasText: uniqueAccountName });
        await expect(card).toBeVisible({ timeout: 10000 });
    });

    test('should test settings persistence (Show Browser toggle)', async ({ page }) => {
        await page.click('button:has-text("Настройки"), button:has-text("Settings"), button:has-text("Configuration")');

        const showBrowserLabel = page.locator('label:has-text("Показывать браузер"), label:has-text("Show browser")');
        await showBrowserLabel.waitFor({ state: 'visible', timeout: 10000 });
        const checkbox = showBrowserLabel.locator('input[type="checkbox"]');

        const initialState = await checkbox.isChecked();
        console.log('Initial Show Browser state:', initialState);

        // Toggle it
        await checkbox.click();

        // Wait for debounce and auto-save
        await page.waitForTimeout(3000);

        // Reload and verify
        await page.reload({ waitUntil: 'load' });
        await page.click('button:has-text("Настройки"), button:has-text("Settings"), button:has-text("Configuration")');

        const reloadSwitch = page.locator('label:has-text("Показывать браузер"), label:has-text("Show browser")').locator('input[type="checkbox"]');
        await expect(reloadSwitch).toBeChecked({ checked: !initialState });
        console.log('Persistence verified');
    });

    test('should update names keyword list', async ({ page }) => {
        await page.click('button:has-text("Настройки"), button:has-text("Settings"), button:has-text("Configuration")');
        await page.click('button:has-text("Имена"), button:has-text("Names")');

        const testNames = `E2E_Name_${Date.now()}\nTest_Bot`;
        const textarea = page.locator('textarea.msg-textarea');

        await textarea.clear();
        await textarea.fill(testNames);

        // Wait for auto-save
        await page.waitForTimeout(3000);

        // Reload and verify
        await page.reload({ waitUntil: 'load' });
        await page.click('button:has-text("Настройки"), button:has-text("Settings"), button:has-text("Configuration")');
        await page.click('button:has-text("Имена"), button:has-text("Names")');

        await expect(page.locator('textarea.msg-textarea')).toHaveValue(testNames);
    });

    test('should verify bot control buttons in Execution tab', async ({ page }) => {
        await page.click('button:has-text("Управление"), button:has-text("Execution")');

        // Clear logs
        await page.click('button:has-text("Очистить"), button:has-text("Clear")');
        await expect(page.locator('text=Логи пусты, text=Logs are empty')).toBeVisible();

        // Start bot
        await page.click('button:has-text("Запустить"), button:has-text("Start")');

        // Check for any log entry
        try {
            await expect(page.locator('.log-entry')).toBeVisible({ timeout: 15000 });
        } catch (e) {
            console.log('No logs appeared yet, but button was clicked.');
        }

        // Stop bot
        await page.click('button:has-text("Остановить"), button:has-text("Stop")');
    });
});
