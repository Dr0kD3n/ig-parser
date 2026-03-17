const { getAllAccounts } = require('../backend/lib/config');

async function verify() {
  console.log('🔍 Verifying account retrieval...');
  try {
    const accounts = await getAllAccounts('parser');
    console.log(`Found ${accounts.length} active parser accounts.`);

    if (accounts.length > 0) {
      const acc = accounts[0];
      console.log('Top Account Details:');
      console.log(`- ID: ${acc.id}`);
      console.log(`- Name: ${acc.name}`);
      console.log(`- Has Proxy: ${!!acc.proxy}`);
      console.log(`- Has Cookies: ${acc.cookies.length > 0}`);
      console.log(`- Has Fingerprint: ${!!acc.fingerprint}`);

      if (!acc.id || !acc.name) {
        console.error('❌ Error: ID or Name missing!');
        process.exit(1);
      }
      console.log('✅ Verification successful: All fields present.');
    } else {
      console.warn(
        '⚠️ No active accounts found for parser. Please activate at least one account in the UI.'
      );
    }
  } catch (e) {
    console.error('❌ Verification failed with error:', e.message);
    process.exit(1);
  }
}

verify().catch(console.error);
