const Database = require('better-sqlite3');
const db = new Database('tmp/db_copy.sqlite');
console.log('--- DATABASE INVENTORY (tmp/db_copy.sqlite) ---');
try {
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().forEach(t => {
        try {
            console.log(`${t.name}: ${db.prepare('SELECT count(*) as c FROM ' + t.name).get().c} rows`);
        } catch (e) { }
    });
} catch (e) { console.error(e.message); }
db.close();
