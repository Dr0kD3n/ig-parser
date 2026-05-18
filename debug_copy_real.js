const Database = require('better-sqlite3');
const db = new Database('C:/Users/root/Documents/Projects/ig-bot — копия/config/database.sqlite');
console.log('--- DATABASE INVENTORY (COPY PROJECT) ---');
try {
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().forEach(t => {
        try {
            console.log(`${t.name}: ${db.prepare('SELECT count(*) as c FROM ' + t.name).get().c} rows`);
        } catch (e) { }
    });
} catch (e) { console.error(e.message); }
db.close();
