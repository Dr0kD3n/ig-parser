const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve('config/database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

const tables = ['profiles', 'accounts', 'donors', 'keywords', 'settings'];

console.log('--- Database Stats ---');
tables.forEach(table => {
    db.get(`SELECT count(*) as count FROM ${table}`, [], (err, row) => {
        if (err) {
            console.log(`${table}: Table missing or error (${err.message})`);
        } else {
            console.log(`${table}: ${row.count} rows`);
        }
    });
});

setTimeout(() => db.close(), 2000);
