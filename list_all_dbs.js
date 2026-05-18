const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function findDbs(dir, files = []) {
    fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git') findDbs(fullPath, files);
        } else if (file.endsWith('.sqlite')) {
            files.push(fullPath);
        }
    });
    return files;
}

const allDbs = findDbs('C:/Users/root/Documents/Projects/ig');
console.log('--- Database Inventory ---');

allDbs.forEach(dbPath => {
    try {
        const db = new Database(dbPath);
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
        console.log(`\nDB: ${dbPath}`);
        console.log(`Tables: ${tables.join(', ')}`);

        // Check possible message history tables
        const historyTables = tables.filter(t => t.includes('message') || t.includes('log') || t.includes('stat'));
        for (const table of historyTables) {
            try {
                const count = db.prepare(`SELECT count(*) as c FROM ${table}`).get().c;
                console.log(`  Row count (${table}): ${count}`);
            } catch (e) { }
        }
        db.close();
    } catch (e) {
        console.log(`DB Error (${dbPath}): ${e.message}`);
    }
});
