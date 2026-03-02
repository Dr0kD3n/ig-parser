const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(process.cwd(), 'config', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

const username = 'semengoskov1fsdvxc';

db.get('SELECT * FROM accounts WHERE name = ? OR id = ?', [username, username], (err, row) => {
    if (err) {
        console.error('Error querying database:', err);
        process.exit(1);
    }
    if (!row) {
        console.log(`Account ${username} not found in database.`);
    } else {
        console.log('Account Info:');
        console.log(`ID: ${row.id}`);
        console.log(`Name: ${row.name}`);

        let cookiesCount = 0;
        try {
            if (row.cookies) {
                const cookies = JSON.parse(row.cookies);
                cookiesCount = Array.isArray(cookies) ? cookies.length : 0;
            }
        } catch (e) {
            console.log('Error parsing cookies');
        }
        console.log(`Cookies count: ${cookiesCount}`);

        let hasLocalStorage = false;
        try {
            if (row.local_storage && row.local_storage !== '{}') {
                hasLocalStorage = true;
            }
        } catch (e) { }
        console.log(`Has Local Storage: ${hasLocalStorage}`);

        console.log(`Fingerprint: ${row.fingerprint ? 'Present' : 'Missing'}`);
    }
    db.close();
});
