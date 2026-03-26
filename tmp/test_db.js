const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '..', 'config', 'database.sqlite');
console.log('Using DB:', dbPath);
const db = new sqlite3.Database(dbPath);
db.all(`SELECT id, name, active_parser, active_server, active_index, active_profiles, active_checker FROM accounts`, [], (err, rows) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(JSON.stringify(rows));
    db.close();
});
