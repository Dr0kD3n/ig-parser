const Database = require('better-sqlite3');

const db = new Database('config/database.sqlite');
console.log('--- DATABASE INVENTORY (config/database.sqlite) ---');

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
for (const t of tables) {
    try {
        const count = db.prepare(`SELECT count(*) as c FROM ${t.name}`).get().c;
        console.log(`${t.name}: ${count} rows`);

        // Check if it's the one with messages
        if (t.name === 'messages_log') {
            const samples = db.prepare(`SELECT message_text FROM messages_log LIMIT 10`).all();
            console.log('  Samples:', samples.map(s => s.message_text.split('\n')[0].slice(0, 30)));
        }
    } catch (e) {
        console.log(`${t.name}: error - ${e.message}`);
    }
}
db.close();
