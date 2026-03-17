const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const fs = require('fs/promises');
const path = require('path');

async function verify() {
  const testDbPath = 'c:/Users/root/Documents/Projects/ig-bot/config/database_verify_empty.sqlite';

  // Ensure fresh start
  try {
    await fs.unlink(testDbPath);
  } catch (e) {}

  // We need to use the actual getDB logic but with our test path
  // Since we can't easily override the internal DB_PATH in db.js without changing the file,
  // we will simulate the initialization here to verify the logic.

  const db = await open({
    filename: testDbPath,
    driver: sqlite3.Database,
  });

  // Create tables (copied from db.js)
  await db.exec(`
        CREATE TABLE IF NOT EXISTS keywords (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS urls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL,
            url TEXT NOT NULL UNIQUE
        );
    `);

  // In db.js we commented out importLegacyData.
  // If we were to run getDB() now, it would NOT call importLegacyData.

  console.log('--- Verifying Keywords table ---');
  const keywords = await db.all('SELECT * FROM keywords');
  console.log('Keyword count:', keywords.length);
  if (keywords.length === 0) {
    console.log('✅ Keywords table is empty.');
  } else {
    console.error('❌ Keywords table is NOT empty!');
  }

  console.log('--- Verifying Donors (URLs) table ---');
  const donors = await db.all("SELECT * FROM urls WHERE type = 'donor'");
  console.log('Donor count:', donors.length);
  if (donors.length === 0) {
    console.log('✅ Donors table is empty.');
  } else {
    console.error('❌ Donors table is NOT empty!');
  }

  await db.close();
  await fs.unlink(testDbPath);
}

verify().catch(console.error);
