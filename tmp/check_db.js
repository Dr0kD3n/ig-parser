const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(process.cwd(), 'config', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.all("SELECT name FROM sqlite_master WHERE type='table'", (err, tables) => {
    if (err) {
        console.error('Error listing tables:', err);
        return;
    }
    console.log('Tables:', tables.map(t => t.name));

    // Check if critical auth tables have columns
    const criticalTables = ['users', 'registration_codes', 'login_logs'];
    criticalTables.forEach(table => {
        if (tables.find(t => t.name === table)) {
            db.all(`PRAGMA table_info(${table})`, (err, columns) => {
                if (err) {
                    console.error(`Error checking columns for ${table}:`, err);
                } else {
                    console.log(`Columns for ${table}:`, columns.map(c => c.name));
                }
            });
        } else {
            console.log(`Table ${table} DOES NOT EXIST`);
        }
    });
});
