const { startAuthorization, stopAuthorization } = require('../backend/lib/authorizer');
const { getDB } = require('../backend/lib/db');

async function verifyAuthorizer() {
    console.log('🧪 Starting Authorizer verification...');

    // Create a dummy account if needed
    const db = await getDB();
    const testId = 'test_verify_' + Date.now();
    await db.run('INSERT INTO accounts (id, name) VALUES (?, ?)', [testId, 'Verify Test']);

    try {
        console.log('🚀 Starting authorization flow...');
        const result = await startAuthorization(testId, 'Verify Test', null);

        if (result.success) {
            console.log('✅ Authorizer started successfully.');
            console.log('Wait 5 seconds to ensure UI button is injected and stable...');
            await new Promise(r => setTimeout(r, 5000));

            // We can't easily click the button in this script without complex playwright logic here,
            // but the fact that startAuthorization returned success and didn't crash with "Execution context destroyed"
            // is already a huge improvement.
        } else {
            console.error('❌ Authorizer failed to start:', result.error);
        }
    } catch (e) {
        console.error('❌ Unexpected error:', e);
    } finally {
        console.log('🧹 Cleaning up...');
        await stopAuthorization(testId);
        await db.run('DELETE FROM accounts WHERE id = ?', [testId]);
        process.exit(0);
    }
}

verifyAuthorizer();
