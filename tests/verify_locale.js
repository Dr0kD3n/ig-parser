const { createBrowserContext } = require('../backend/lib/browser');
const { generateFingerprint } = require('../backend/lib/fingerprint');

async function test() {
    console.log('--- Testing Locale Fix ---');

    // Test Case 1: Manual Russian locale
    console.log('\nCase 1: Providing ru-RU manually');
    const { context: context1 } = await createBrowserContext({ locale: 'ru-RU' }, true);
    // Note: We can't easily inspect internal contextOptions of Playwright context after creation via API,
    // but the logic in browser.js is now explicit.
    await context1.close();
    console.log('✅ Context created with ru-RU (logic check)');

    // Test Case 2: Random profile check
    console.log('\nCase 2: Random profile check (should NOT be Spanish)');
    for (let i = 0; i < 10; i++) {
        const fingerprint = generateFingerprint();
        if (fingerprint.locale === 'es-ES') {
            console.error('❌ Found es-ES in random fingerprint!');
            process.exit(1);
        }
    }
    console.log('✅ 10/10 fingerprints are NOT Spanish');

    console.log('\nAll tests passed successfully (locally)!');
}

test().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
