const Database = require('better-sqlite3');
function getCount(file) {
    try {
        const db = new Database(file, { readonly: true, timeout: 2000 });
        const row = db.prepare('SELECT count(*) as count FROM profiles').get();
        return row.count;
    } catch (e) {
        return 'Error: ' + e.message;
    }
}
console.log('database.sqlite:', getCount('config/database.sqlite'));
console.log('database_pre_restore_20260313.sqlite:', getCount('config/database_pre_restore_20260313.sqlite'));
console.log('database_backup_20260309_220151.sqlite:', getCount('config/database_backup_20260309_220151.sqlite'));
