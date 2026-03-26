const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'config', 'database.sqlite');
const db = new sqlite3.Database(dbPath);
db.all(`SELECT count(*) as count FROM profiles`, [], (err, rows) => {
    if (err) { console.error(err); process.exit(1); }
    console.log('Profiles count:', rows[0].count);
    db.all(`SELECT count(*) as count FROM accounts`, [], (err, rows) => {
        if (err) { console.error(err); process.exit(1); }
        console.log('Accounts count:', rows[0].count);
        db.close();
    });
});
