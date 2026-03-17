const { getDB } = require('../backend/lib/db');

async function dump() {
  const db = await getDB();
  const accounts = await db.all('SELECT id, name, fingerprint FROM accounts');
  console.log('Account Fingerprints:');
  accounts.forEach((a) => {
    try {
      const fp = JSON.parse(a.fingerprint);
      console.log(`- ID: ${a.id}, Name: ${a.name}, Locale: ${fp.locale}`);
    } catch (e) {
      console.log(`- ID: ${a.id}, Name: ${a.name}, Fingerprint: ERROR PARSING`);
    }
  });
}

dump().catch(console.error);
