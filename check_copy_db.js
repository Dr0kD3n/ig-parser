const Database = require('better-sqlite3');
const path = require('path');

const dbPath = "C:/Users/root/Documents/Projects/ig-bot — копия/config/database.sqlite";
try {
    const db = new Database(dbPath);
    const tables = ['profiles', 'accounts', 'donors', 'keywords', 'settings'];

    console.log('--- Copy Database Stats ---');
    for (const table of tables) {
        try {
            const row = db.prepare(`SELECT count(*) as count FROM ${table}`).get();
            console.log(`${table}: ${row.count} rows`);
        } catch (err) {
            console.log(`${table}: Error - ${err.message}`);
        }
    }
    db.close();
} catch (e) {
    console.error('Failed to open database:', e.message);
}
