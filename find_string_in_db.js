const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function findDbs(dir, files = []) {
    try {
        fs.readdirSync(dir).forEach(file => {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                if (file !== 'node_modules' && file !== '.git') findDbs(fullPath, files);
            } else if (file.endsWith('.sqlite')) {
                files.push(fullPath);
            }
        });
    } catch (e) { }
    return files;
}

const allDbs = findDbs('C:/Users/root/Documents/Projects/ig');
console.log('--- Searching for "Какие цветы" ---');

allDbs.forEach(dbPath => {
    try {
        const db = new Database(dbPath);
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);

        for (const table of tables) {
            const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
            for (const col of columns) {
                try {
                    const rows = db.prepare(`SELECT count(*) as c FROM ${table} WHERE ${col} LIKE '%Какие цветы%'`).get();
                    if (rows && rows.c > 0) {
                        console.log(`FOUND in ${dbPath} -> [Table: ${table}, Column: ${col}] -> ${rows.c} rows`);
                    }
                } catch (e) { }
            }
        }
        db.close();
    } catch (e) { }
});
