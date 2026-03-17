const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function check() {
  const db = await open({
    filename: 'c:/Users/root/Documents/Projects/ig-bot/backups/database_20260226_1308.sqlite',
    driver: sqlite3.Database,
  });

  console.log('--- Keywords ---');
  const keywords = await db.all('SELECT * FROM keywords');
  console.log(JSON.stringify(keywords, null, 2));

  console.log('--- Donors (URLs) ---');
  const donors = await db.all("SELECT * FROM urls WHERE type = 'donor'");
  console.log(JSON.stringify(donors, null, 2));

  await db.close();
}

check().catch(console.error);
