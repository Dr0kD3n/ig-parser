const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'config', 'database.sqlite');
const db = new Database(dbPath);

// Count anonymous photos
const anonCount = db
  .prepare("SELECT COUNT(*) as cnt FROM profiles WHERE photo LIKE '%YW5vbnltb3VzX3Byb2ZpbGVfcGlj%'")
  .get();
console.log('Anonymous photos found:', anonCount.cnt);

const totalCount = db.prepare('SELECT COUNT(*) as cnt FROM profiles').get();
console.log('Total profiles:', totalCount.cnt);

// Show some examples
const examples = db
  .prepare(
    "SELECT url, substr(photo, 1, 80) as photo_start FROM profiles WHERE photo LIKE '%YW5vbnltb3VzX3Byb2ZpbGVfcGlj%' LIMIT 5"
  )
  .all();
console.log('\nExamples:');
examples.forEach((e) => console.log(' ', e.url, '->', e.photo_start + '...'));

// Clear anonymous photos (set to empty string)
const result = db
  .prepare("UPDATE profiles SET photo = '' WHERE photo LIKE '%YW5vbnltb3VzX3Byb2ZpbGVfcGlj%'")
  .run();
console.log('\nCleared', result.changes, 'anonymous photos from profiles table.');

// Also check donors table
const donorAnonCount = db
  .prepare("SELECT COUNT(*) as cnt FROM donors WHERE photo LIKE '%YW5vbnltb3VzX3Byb2ZpbGVfcGlj%'")
  .get();
if (donorAnonCount.cnt > 0) {
  const donorResult = db
    .prepare("UPDATE donors SET photo = '' WHERE photo LIKE '%YW5vbnltb3VzX3Byb2ZpbGVfcGlj%'")
    .run();
  console.log('Cleared', donorResult.changes, 'anonymous photos from donors table.');
} else {
  console.log('No anonymous photos in donors table.');
}

db.close();
console.log('\nDone!');
