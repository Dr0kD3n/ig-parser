const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'config', 'database.sqlite');
const db = new sqlite3.Database(dbPath);
db.all(`SELECT * FROM settings`, [], (err, rows) => {
    if (err) { console.error(err); process.exit(1); }
    console.log('Settings:', JSON.stringify(rows));
    db.close();
});
