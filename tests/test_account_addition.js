const { getDB } = require('../backend/lib/db');
const { generateFingerprint } = require('../backend/lib/fingerprint');

/**
 * mims the logic found in server.js app.post('/api/settings') 
 * specifically the account update/replace section.
 */
async function testAccountAddition() {
    console.log('🚀 Starting Account Addition Logic Test...');

    const db = await getDB();
    const testId = 'test_add_acc_' + Date.now();

    // Mock incoming account from "API"
    const incomingAccount = {
        id: testId,
        name: 'New Test Account',
        proxy: '5.6.7.8:8080:user:pass',
        cookies: 'a=1; b=2',
        // fingerprint: undefined // Should be generated
    };

    const activeParserAccountIds = [testId]; // Set as active for parser

    try {
        console.log('--- Phase 1: Adding Account via Server Logic ---');

        // Logic from server.js L382-L404
        const getPriority = (arr, id) => {
            const idx = (arr || []).indexOf(id);
            return idx === -1 ? 0 : idx + 1;
        };

        let fingerprint = incomingAccount.fingerprint;
        if (!fingerprint) {
            console.log('Generating new fingerprint for account...');
            fingerprint = JSON.stringify(generateFingerprint());
        }

        await db.run(`INSERT OR REPLACE INTO accounts (id, name, proxy, cookies, active_parser, active_server, active_index, active_profiles, fingerprint, local_storage, warmup_score, last_warmup)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
            incomingAccount.id,
            incomingAccount.name,
            incomingAccount.proxy || '',
            incomingAccount.cookies || '',
            getPriority(activeParserAccountIds, incomingAccount.id),
            0, 0, 0, // Other priorities
            fingerprint,
            null, 0, null // Other fields
        ]);

        console.log('\n--- Phase 2: Verifying Account Data ---');
        const acc = await db.get('SELECT * FROM accounts WHERE id = ?', [testId]);

        if (!acc) throw new Error('❌ Account not found in DB');

        console.log('Verifying fields:');
        console.log(`- name: ${acc.name === incomingAccount.name ? '✅' : '❌'}`);
        console.log(`- active_parser: ${acc.active_parser === 1 ? '✅' : '❌'}`);
        console.log(`- fingerprint: ${acc.fingerprint ? '✅ (Generated)' : '❌'}`);

        if (acc.name === incomingAccount.name && acc.active_parser === 1 && acc.fingerprint) {
            console.log('\n🎉 ACCOUNT ADDITION LOGIC TEST PASSED!');
        } else {
            throw new Error('❌ Account data mismatch');
        }

    } catch (e) {
        console.error('\n❌ TEST FAILED:', e.message);
        process.exit(1);
    } finally {
        console.log('\n--- Cleaning up test data ---');
        await db.run('DELETE FROM accounts WHERE id = ?', [testId]);
    }
}

testAccountAddition().catch(console.error);
