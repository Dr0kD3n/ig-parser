const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve('config/database.sqlite');
const db = new Database(dbPath, { verbose: console.log });

const tables = ['profiles', 'accounts', 'donors', 'keywords', 'settings'];

console.log('--- Database Stats ---');
for (const table of tables) {
    try {
        const row = db.prepare(`SELECT count(*) as count FROM ${table}`).get();
        console.log(`${table}: ${row.count} rows`);
    } catch (err) {
        console.log(`${table}: Error - ${err.message}`);
    }
}
db.close();
