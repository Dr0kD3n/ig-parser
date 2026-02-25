const { getDB } = require('../backend/lib/db');

async function cleanup() {
    const db = await getDB();
    const accounts = await db.all('SELECT id, fingerprint FROM accounts');

    console.log(`Checking ${accounts.length} accounts...`);

    for (const account of accounts) {
        if (!account.fingerprint) continue;

        try {
            const fp = JSON.parse(account.fingerprint);
            if (fp.locale === 'es-ES') {
                console.log(`Updating account ${account.id}: es-ES -> ru-RU`);
                fp.locale = 'ru-RU';
                // Also update timezone if it was likely matching Spanish locale
                if (fp.timezoneId === 'Europe/Madrid') {
                    fp.timezoneId = 'Europe/Moscow';
                }
                await db.run('UPDATE accounts SET fingerprint = ? WHERE id = ?', [JSON.stringify(fp), account.id]);
            }
        } catch (e) {
            console.error(`Error processing account ${account.id}:`, e.message);
        }
    }
    console.log('Cleanup complete.');
}

cleanup().catch(console.error);
