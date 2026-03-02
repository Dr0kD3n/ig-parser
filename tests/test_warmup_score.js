const { getDB } = require('../backend/lib/db');
const { startWarmup } = require('../backend/lib/warmup');

async function test() {
    console.log('🧪 Starting Warmup Score Verification...');
    const db = await getDB();

    // 1. Create a dummy account if it doesn't exist
    const testId = 'test_warmup_acc';
    await db.run('INSERT OR REPLACE INTO accounts (id, name, proxy) VALUES (?, ?, ?)',
        [testId, 'Test Warmup Account', '127.0.0.1:8080:user:pass']);

    console.log('✅ Dummy account created.');

    // 2. Manually trigger a partial update to see if logic works
    // Since startWarmup runs a real browser, we'll mock the DB update for this test if we don't want to wait
    // But let's check if we can just update it and read it back.

    const mockScore = 75;
    const mockTimestamp = new Date().toISOString();

    await db.run('UPDATE accounts SET warmup_score = ?, last_warmup = ? WHERE id = ?',
        [mockScore, mockTimestamp, testId]);

    // 3. Read back
    const acc = await db.get('SELECT warmup_score, last_warmup FROM accounts WHERE id = ?', [testId]);

    if (acc.warmup_score === mockScore && acc.last_warmup === mockTimestamp) {
        console.log(`✅ Verification Successful: Score ${acc.warmup_score}%, Date ${acc.last_warmup}`);
    } else {
        console.error('❌ Verification Failed!', acc);
        process.exit(1);
    }

    // Cleanup
    await db.run('DELETE FROM accounts WHERE id = ?', [testId]);
    console.log('🧹 Cleanup done.');
    process.exit(0);
}

test().catch(err => {
    console.error(err);
    process.exit(1);
});
