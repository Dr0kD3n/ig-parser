const { test, expect } = require('@playwright/test');

test.describe('Settings Persistence E2E', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    // Log browser console messages
    page.on('console', (msg) => console.log(`BROWSER [${msg.type()}]: ${msg.text()}`));

    const responsePromise = page
      .waitForResponse((r) => r.url().includes('/api/settings') && r.method() === 'GET', {
        timeout: 30000,
      })
      .catch(() => null);
    await page.goto('/');
    await responsePromise;
    await page.waitForTimeout(1000); // Wait for hydration
  });

  test('should persist all settings after reload', async ({ page }) => {
    console.log('--- Phase 1: Modifying Settings Lists ---');

    // Navigate to Settings
    await page.click(
      'button:has-text("Настройки"), button:has-text("Settings"), button:has-text("Configuration")'
    );

    const testData = {
      Names: `Name1_${Date.now()}\nName2_${Date.now()}`,
      Cities: `City1_${Date.now()}\nCity2_${Date.now()}`,
      Niches: `Niche1_${Date.now()}`,
      Donors: `Donor1_${Date.now()}`,
    };

    const tabs = {
      Names: ['Имена', 'Names'],
      Cities: ['Города', 'Cities'],
      Niches: ['Ниши', 'Niches'],
      Donors: ['Доноры', 'Donors'],
    };

    for (const [key, values] of Object.entries(testData)) {
      console.log(`Setting ${key}...`);
      const tabSelectors = tabs[key].map((t) => `button:has-text("${t}")`).join(', ');
      await page.click(tabSelectors);

      const textarea = page.locator('textarea.settings-list-textarea');
      await textarea.clear();

      // Wait for auto-save POST after filling
      console.log(`Waiting for POST /api/settings...`);
      const savePromise = page.waitForResponse(
        (r) => r.url().includes('/api/settings') && r.method() === 'POST',
        { timeout: 30000 }
      );
      await textarea.fill(values);
      await savePromise;
      console.log(`${key} saved.`);
    }

    console.log('--- Phase 2: Modifying Execution Controls ---');

    // Navigate to Execution
    await page.click('button:has-text("Управление"), button:has-text("Execution")');

    const showBrowserLabel = page.locator(
      'label:has-text("Показывать браузер"), label:has-text("Show browser")'
    );
    const humanEmulationLabel = page.locator(
      'label:has-text("Эмуляция человека"), label:has-text("Human Emulation")'
    );
    const concurrentProfilesInput = page
      .locator(
        'label:has-text("Профилей:"), label:has-text("Profiles:"), label:has-text("Concurrent Profiles")'
      )
      .locator('input[type="number"]');

    const initialShowBrowser = await showBrowserLabel.locator('input').isChecked();
    const initialHumanEmulation = await humanEmulationLabel.locator('input').isChecked();

    console.log(`Toggling Show Browser (initial: ${initialShowBrowser})...`);
    const saveShowBrowser = page.waitForResponse(
      (r) => r.url().includes('/api/settings') && r.method() === 'POST',
      { timeout: 30000 }
    );
    await showBrowserLabel.click();
    await saveShowBrowser;

    console.log(`Toggling Human Emulation (initial: ${initialHumanEmulation})...`);
    const saveHumanEmulation = page.waitForResponse(
      (r) => r.url().includes('/api/settings') && r.method() === 'POST',
      { timeout: 30000 }
    );
    await humanEmulationLabel.click();
    await saveHumanEmulation;

    const testConcurrent = (Math.floor(Math.random() * 10) + 2).toString();
    console.log(`Setting Concurrent Profiles to ${testConcurrent}...`);
    const saveConcurrent = page.waitForResponse(
      (r) => r.url().includes('/api/settings') && r.method() === 'POST',
      { timeout: 30000 }
    );
    await concurrentProfilesInput.fill(testConcurrent);
    await saveConcurrent;

    console.log('--- Phase 3: Reload and Verification ---');

    await page.reload();
    await page.waitForResponse((r) => r.url().includes('/api/settings') && r.method() === 'GET');
    await page.waitForTimeout(1000);

    // Verify Controls (staying on last tab usually, or it might reset to main)
    const activeTab = await page.locator('.tab-btn.active').innerText();
    console.log(`Current active tab: ${activeTab}`);

    // Need to navigate back if it reset
    await page.click('button:has-text("Управление"), button:has-text("Execution")');

    console.log('Verifying controls...');
    await expect(showBrowserLabel.locator('input')).toBeChecked({ checked: !initialShowBrowser });
    await expect(humanEmulationLabel.locator('input')).toBeChecked({
      checked: !initialHumanEmulation,
    });
    await expect(concurrentProfilesInput).toHaveValue(testConcurrent);
    console.log('Controls verified.');

    // Verify Lists
    await page.click(
      'button:has-text("Настройки"), button:has-text("Settings"), button:has-text("Configuration")'
    );

    for (const [key, values] of Object.entries(testData)) {
      console.log(`Verifying ${key}...`);
      const tabSelectors = tabs[key].map((t) => `button:has-text("${t}")`).join(', ');
      await page.click(tabSelectors);
      await expect(page.locator('textarea.settings-list-textarea')).toHaveValue(values);
      console.log(`${key} verified.`);
    }

    console.log('✅ All settings persisted correctly!');
  });
});
