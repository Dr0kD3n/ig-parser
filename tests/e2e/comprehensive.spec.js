const { test, expect } = require('@playwright/test');

test.describe('IG-Bot Comprehensive E2E', () => {
    test.setTimeout(60000);

    test.beforeEach(async ({ page }) => {
        page.on('console', msg => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));
        // Wait for initial load
        const settingsPromise = page.waitForResponse(r => r.url().includes('/api/settings') && r.method() === 'GET', { timeout: 15000 }).catch(() => { });
        await page.goto('/');
        await settingsPromise;
        await page.waitForTimeout(500);
    });

    test('should navigate between tabs', async ({ page }) => {
        await expect(page.locator('.logo')).toContainText('InstaPanel');
        await page.click('button:has-text("Управление"), button:has-text("Execution")');
        await expect(page.locator('h3:has-text("Фарм профилей"), h3:has-text("Profile Scraper")')).toBeVisible();
        await page.click('button:has-text("Настройки"), button:has-text("Settings")');
        await expect(page.locator('button:has-text("Аккаунты"), button:has-text("Accounts")')).toBeVisible();
    });

    test('should manage accounts and settings', async ({ page }) => {
        await page.click('button:has-text("Настройки"), button:has-text("Settings")');

        const testAccountName = `E2E_Test_${Date.now()}`;
        await page.fill('#new-acc-name', testAccountName);
        await page.fill('#new-acc-proxy', 'http://proxy.test:8080');
        await page.fill('#new-acc-cookies', 'test_cookie=value');

        // Account addition is separate from settings auto-save
        await page.click('button:has-text("Добавить"), button:has-text("Add")');
        await expect(page.locator('.account-card')).toContainText(testAccountName);

        await page.click('button:has-text("Управление"), button:has-text("Execution")');
        const showBrowserSwitch = page.locator('label:has-text("Показывать браузер"), label:has-text("Show browser")').locator('input[type="checkbox"]');

        const initialShow = await showBrowserSwitch.isChecked();

        // Set up listener for the auto-save POST
        const savePromise = page.waitForResponse(r => r.url().includes('/api/settings') && r.method() === 'POST', { timeout: 10000 });
        await showBrowserSwitch.click();
        await savePromise;

        await page.reload();
        await page.waitForResponse(r => r.url().includes('/api/settings') && r.method() === 'GET').catch(() => { });

        await page.click('button:has-text("Управление"), button:has-text("Execution")');
        const finalSwitch = page.locator('label:has-text("Показывать браузер"), label:has-text("Show browser")').locator('input[type="checkbox"]');
        await expect(finalSwitch).toBeChecked({ checked: !initialShow });
    });

    test('should update keyword lists', async ({ page }) => {
        await page.click('button:has-text("Настройки"), button:has-text("Settings")');
        await page.click('button:has-text("Имена"), button:has-text("Names")');

        const testNames = 'Alice\nBob\nCharlie_' + Date.now();
        const textarea = page.locator('textarea.settings-list-textarea');

        await textarea.clear();

        const savePromise = page.waitForResponse(r => r.url().includes('/api/settings') && r.method() === 'POST', { timeout: 10000 });
        await textarea.fill(testNames);
        await savePromise;

        await page.reload();
        await page.waitForResponse(r => r.url().includes('/api/settings') && r.method() === 'GET').catch(() => { });

        await page.click('button:has-text("Настройки"), button:has-text("Settings")');
        await page.click('button:has-text("Имена"), button:has-text("Names")');

        await expect(page.locator('textarea.settings-list-textarea')).toHaveValue(testNames);
    });

    test('should interact with profiles', async ({ page }) => {
        await page.click('button:has-text("Профили"), button:has-text("Profiles")');

        const cards = page.locator('.card');
        const emptyMessage = page.locator('text=Нет профилей по выбранным фильтрам, text=No profiles found');

        await Promise.race([
            cards.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => { }),
            emptyMessage.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { })
        ]);

        if (await cards.count() > 0) {
            const firstCard = cards.first();
            await firstCard.locator('.likeBtn').click();
            await expect(firstCard).toHaveClass(/status-like/);
        } else {
            console.log('No profiles found, which is normal for a fresh start');
        }
    });

    test('should show logs in controls tab', async ({ page }) => {
        await page.click('button:has-text("Управление"), button:has-text("Execution")');

        await page.click('button:has-text("Очистить"), button:has-text("Clear")');
        await expect(page.locator('text=Логи пусты, text=Logs are empty')).toBeVisible();

        await page.click('button:has-text("Запустить"), button:has-text("Start")');
        await expect(page.locator('.log-entry')).toBeVisible({ timeout: 15000 });
        await page.click('button:has-text("Остановить"), button:has-text("Stop")');
    });
});
