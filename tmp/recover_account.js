const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = 'c:\\Users\\root\\Documents\\Projects\\ig\\ig-bot\\config\\database.sqlite';

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Could not connect to database', err);
        return;
    }
    console.log('Connected to database');
});

db.get("SELECT * FROM accounts WHERE name = ?", ['Основа'], (err, row) => {
    if (err) {
        console.error('Error querying database', err);
        return;
    }
    if (row) {
        require('fs').writeFileSync('c:\\Users\\root\\Documents\\Projects\\ig\\ig-bot\\tmp\\osnova_cookies_utf8.json', JSON.stringify(row));
        console.log('Account "Основа" recovered successfully.');
    } else {
        console.log('Account "Основа" not found.');
    }
    db.close();
});
