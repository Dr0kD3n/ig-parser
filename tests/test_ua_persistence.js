const { createBrowserContext } = require('../backend/lib/browser');
const { getDB } = require('../backend/lib/db');
const path = require('path');

async function testUAPersistence() {
    console.log('🚀 Starting UserAgent persistence test...');

    const db = await getDB();
    const testId = 'test_acc_ua_' + Date.now();
    const testUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
    const testFingerprint = {
        userAgent: testUA,
        viewport: { width: 1280, height: 720 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
        deviceScaleFactor: 1
    };

    console.log(`Creating test account ${testId} with UA: ${testUA}`);

    // 1. Insert test account with fingerprint
    await db.run(
        'INSERT INTO accounts (id, name, fingerprint) VALUES (?, ?, ?)',
        [testId, 'UA Test Account', JSON.stringify(testFingerprint)]
    );

    try {
        // 2. Launch browser context via createBrowserContext
        console.log('Launching browser context...');
        const config = {
            id: testId,
            fingerprint: testFingerprint
        };

        const { browser, context } = await createBrowserContext(config, true);
        const page = await context.newPage();

        console.log('Verifying UserAgent in-browser...');
        const browserUA = await page.evaluate(() => navigator.userAgent);

        console.log(`Expected UA: ${testUA}`);
        console.log(`Actual UA:   ${browserUA}`);

        if (browserUA === testUA) {
            console.log('✅ SUCCESS: UserAgent matches!');
        } else {
            console.log('❌ FAILURE: UserAgent does NOT match!');
        }

        await context.close();
        await browser.close();

    } catch (e) {
        console.error('❌ Error during test:', e);
    } finally {
        // Cleanup
        console.log('Cleaning up test data...');
        await db.run('DELETE FROM accounts WHERE id = ?', [testId]);
    }
}

testUAPersistence().catch(console.error);
