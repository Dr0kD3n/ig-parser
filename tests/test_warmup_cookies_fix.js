const { getCookies, getAllAccounts } = require('../backend/lib/config');
const { getDB } = require('../backend/lib/db');

async function testWarmupCookiePreservation() {
  console.log('🧪 Testing Warmup Cookie Preservation...');

  process.env.NODE_ENV = 'test';
  process.env.APP_ROOT = process.cwd();

  const db = await getDB();
  const testId = 'warmup_test_' + Date.now();

  // Mix of Instagram and non-Instagram cookies
  const mixedCookies = [
    { name: 'sessionid', value: 'ig_secret', domain: '.instagram.com' },
    { name: 'google_pref', value: 'warmup_data', domain: '.google.com' },
    { name: '_ga', value: 'warmup_ga', domain: '.yandex.ru' },
  ];

  // Insert into DB
  await db.run('INSERT INTO accounts (id, name, cookies, active_server) VALUES (?, ?, ?, ?)', [
    testId,
    'Warmup Test',
    JSON.stringify(mixedCookies),
    1,
  ]);

  console.log('✅ Inserted account with mixed cookies.');

  // 1. Test getCookies retrieval (used by bot tasks)
  console.log('🔍 Checking getCookies() output...');
  const retrievedBotCookies = await getCookies('server');

  const hasIG = retrievedBotCookies.some((c) => c.name === 'sessionid');
  const hasGoogle = retrievedBotCookies.some((c) => c.name === 'google_pref');
  const hasYandex = retrievedBotCookies.some((c) => c.name === '_ga');

  if (hasIG && hasGoogle && hasYandex) {
    console.log('✅ SUCCESS: getCookies() preserved all domains.');
  } else {
    console.error('❌ FAILURE: getCookies() filtered out warmup cookies!');
    console.error(
      'Retrieved:',
      retrievedBotCookies.map((c) => c.name)
    );
  }

  // 2. Test getAllAccounts (used by settings UI)
  console.log('🔍 Checking getAllAccounts() output...');
  const accounts = await getAllAccounts('server');
  const acc = accounts.find((a) => a.id === testId);

  if (acc && acc.cookies.length === 3) {
    console.log('✅ SUCCESS: getAllAccounts() preserved all cookies for UI.');
  } else {
    console.error('❌ FAILURE: getAllAccounts() returned filtered cookies!');
    console.error('Count:', acc ? acc.cookies.length : 'N/A');
  }
}

testWarmupCookiePreservation()
  .then(() => {
    console.log('🏁 Verification finished.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('💥 Verification crashed:', err);
    process.exit(1);
  });
