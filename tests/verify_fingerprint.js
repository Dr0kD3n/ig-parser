const { createBrowserContext } = require('../backend/lib/browser');
const { getAllAccounts } = require('../backend/lib/config');
const path = require('path');

async function verify() {
    console.log('🚀 Starting fingerprint verification...');
    const accounts = await getAllAccounts('checker');

    if (accounts.length === 0) {
        console.log('❌ No accounts found in the database with active_checker > 0.');
        return;
    }

    console.log(`Found ${accounts.length} accounts to check.`);

    for (let i = 0; i < accounts.length; i++) {
        const acc = accounts[i];
        const accountId = acc.id || `account_${i}`;
        console.log(`\n--- Checking Account ${i + 1}/${accounts.length} ---`);
        console.log(`Fingerprint UA: ${acc.fingerprint ? acc.fingerprint.userAgent : 'Default'}`);

        try {
            const { browser, context } = await createBrowserContext(acc, true);
            const page = await context.newPage();

            console.log('Navigating to bot.sannysoft.com...');
            await page.goto('https://bot.sannysoft.com/', { waitUntil: 'networkidle', timeout: 60000 });

            // Wait a bit for all tests to run on the page
            await page.waitForTimeout(5000);

            const screenshotPath = path.join(__dirname, '..', 'data', 'screenshots', `fingerprint_check_${i}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`✅ Screenshot saved: ${screenshotPath}`);

            // Extract some info from the page to verify
            const results = await page.evaluate(() => {
                return {
                    userAgent: navigator.userAgent,
                    webdriver: navigator.webdriver,
                    chrome: !!window.chrome,
                    languages: navigator.languages
                };
            });

            console.log('Detection results:', results);

            await context.close();
        } catch (e) {
            console.error(`❌ Error checking account ${i}:`, e.message);
        }
    }

    console.log('\n🏁 Verification complete.');
}

verify().catch(console.error);
