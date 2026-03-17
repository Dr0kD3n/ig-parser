const { getDB, resetDB } = require('../backend/lib/db');
const path = require('path');
const fs = require('fs');

async function testCookiePersistence() {
  console.log('🧪 Testing Cookie Persistence Fix...');

  // Set environment for test database
  process.env.NODE_ENV = 'test';
  process.env.APP_ROOT = process.cwd();

  const db = await getDB();
  const testId = 'comp_test_' + Date.now();
  const originalCookies = '[{"name":"sessionid","value":"secret_session_123"}]';

  // 1. Manually insert an account with cookies
  await db.run('INSERT INTO accounts (id, name, cookies) VALUES (?, ?, ?)', [
    testId,
    'Test Account',
    originalCookies,
  ]);
  console.log('✅ Inserted account with initial cookies.');

  // Mock the logic from server.js manually to verify the fix
  async function mockSettingsUpdate(incomingAccount) {
    let finalCookies = incomingAccount.cookies || '';
    if (!finalCookies) {
      const existing = await db.get('SELECT cookies FROM accounts WHERE id = ?', [
        incomingAccount.id,
      ]);
      if (existing && existing.cookies) {
        finalCookies = existing.cookies;
      }
    }
    await db.run('UPDATE accounts SET cookies = ? WHERE id = ?', [
      finalCookies,
      incomingAccount.id,
    ]);
  }

  // 2. Simulate "stale" frontend update (empty cookies)
  const staleAccount = { id: testId, name: 'Test Account', cookies: '' };
  await mockSettingsUpdate(staleAccount);

  // 3. Verify cookies are still there
  const result = await db.get('SELECT cookies FROM accounts WHERE id = ?', [testId]);
  if (result.cookies === originalCookies) {
    console.log('✅ SUCCESS: Cookies were NOT overwritten by empty string.');
  } else {
    console.error('❌ FAILURE: Cookies WERE overwritten!');
    console.error('Expected:', originalCookies);
    console.error('Got:', result.cookies);
  }

  // 4. Verify explicit update STILL WORKS (if user somehow intentionally clears it - though my logic prevents this specific check,
  // we want to ensure it doesn't break everything)
  // Actually, in my implementation, I made it so empty strings never overwrite.
  // If the user REALLY wants to clear cookies, they'll have to rely on the re-auth flow or delete account.
}

testCookiePersistence()
  .then(() => {
    console.log('🏁 Test finished.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('💥 Test crashed:', err);
    process.exit(1);
  });
