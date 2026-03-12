"use strict";
const sqlite3_1 = require("sqlite3");
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDB = getDB;

const sqlite_1 = require("sqlite");
const path_1 = require("path");
const promises_1 = require("fs/promises");
const utils_1 = require("./utils");
const DB_PATH = process.env.DATABASE_URL || (process.env.APP_ROOT
    ? path_1.join(process.env.APP_ROOT, 'config', process.env.NODE_ENV === 'test' ? 'database_test.sqlite' : 'database.sqlite')
    : path_1.join((0, utils_1.getRootPath)(), 'config', process.env.NODE_ENV === 'test' ? 'database_test.sqlite' : 'database.sqlite'));
const CONFIG_DIR = path_1.dirname(DB_PATH);
let dbInstance = null;
const resetDB = () => { dbInstance = null; };
exports.resetDB = resetDB;
async function getDB() {
    if (dbInstance)
        return dbInstance;
    // Обеспечиваем существование папки config если это не :memory:
    if (DB_PATH !== ':memory:') {
        try {
            await promises_1.mkdir(CONFIG_DIR, { recursive: true });
        }
        catch (e) { }
    }
    dbInstance = await (0, sqlite_1.open)({
        filename: DB_PATH,
        driver: sqlite3_1.Database
    });
    await dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
            id TEXT PRIMARY KEY,
            name TEXT,
            proxy TEXT,
            cookies TEXT,
            active_parser INTEGER DEFAULT 0,
            active_server INTEGER DEFAULT 0,
            active_index INTEGER DEFAULT 0,
            active_profiles INTEGER DEFAULT 0,
            fingerprint TEXT
        );

        CREATE TABLE IF NOT EXISTS keywords (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL, -- 'city', 'niche', 'name'
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS urls (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            type TEXT NOT NULL, -- 'history', 'donor'
            url TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS profiles (
            url TEXT PRIMARY KEY,
            name TEXT,
            username TEXT,
            bio TEXT,
            photo TEXT,
            followers_count INTEGER DEFAULT 0,
            publications_count INTEGER DEFAULT 0,
            posts_count INTEGER DEFAULT 0,
            donor TEXT,
            vote TEXT, -- 'like', 'dislike'
            tg_status TEXT, -- 'valid', 'invalid', NULL
            isInCity INTEGER DEFAULT 0,
            timestamp TEXT
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS messages_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT,
            message_text TEXT,
            status TEXT, -- 'sent', 'replied', etc.
            timestamp TEXT
        );

        CREATE TABLE IF NOT EXISTS donors (
            username TEXT PRIMARY KEY,
            name TEXT,
            bio TEXT,
            followers_count INTEGER DEFAULT 0,
            publications_count INTEGER DEFAULT 0,
            posts_count INTEGER DEFAULT 0,
            photo TEXT,
            last_updated TEXT
        );

        CREATE TABLE IF NOT EXISTS presets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            data TEXT NOT NULL -- JSON string of settings
        );
    `);
    try {
        await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN tg_status TEXT`);
    }
    catch (e) {
        // Ignore if column already exists
    }
    try {
        await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN username TEXT`);
    }
    catch (e) {
        // Ignore if column already exists
    }
    try {
        await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN followers_count INTEGER DEFAULT 0`);
    }
    catch (e) {
        // Ignore if column already exists
    }
    try {
        await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN publications_count INTEGER DEFAULT 0`);
    }
    catch (e) {
        // Ignore if column already exists
    }
    try {
        await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN donor TEXT`);
    }
    catch (e) {
        // Ignore if column already exists
    }
    try {
        await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN posts_count INTEGER DEFAULT 0`);
    }
    catch (e) {
        // Ignore if column already exists
    }
    try {
        await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN isInCity INTEGER DEFAULT 0`);
    }
    catch (e) {
        // Ignore if column already exists
    }
    try {
        await dbInstance.exec(`ALTER TABLE donors ADD COLUMN posts_count INTEGER DEFAULT 0`);
    }
    catch (e) {
        // Ignore if column already exists
    }
    try {
        await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN fingerprint TEXT`);
    }
    catch (e) {
        // Ignore if column already exists
    }
    try {
        await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN local_storage TEXT`);
    }
    catch (e) {
        // Ignore if column already exists
    }
    try {
        await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN warmup_score INTEGER DEFAULT 0`);
    }
    catch (e) {
        // Ignore if column already exists
    }
    try {
        await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN last_warmup TEXT`);
    }
    catch (e) {
        // Ignore if column already exists
    }

    try {
        await dbInstance.exec(`ALTER TABLE donors ADD COLUMN publications_count INTEGER DEFAULT 0`);
    }
    catch (e) {
        // Ignore if column already exists
    }

    // Import legacy data if needed
    // await importLegacyData(dbInstance);

    return dbInstance;
}

async function importLegacyData(db) {
    const fs = require('fs/promises');
    const rootPath = (0, utils_1.getRootPath)();

    const imports = [
        { file: 'cityKeywords.txt', type: 'city', table: 'keywords' },
        { file: 'names.txt', type: 'name', table: 'keywords' },
        { file: 'nicheKeywords.txt', type: 'niche', table: 'keywords' },
        { file: 'profiles.txt', type: 'donor', table: 'urls' },
        { file: 'donors.txt', type: 'donor', table: 'urls' }
    ];

    for (const item of imports) {
        try {
            const filePath = (0, path_1.join)(rootPath, 'config', item.file);
            const stats = await fs.stat(filePath).catch(() => null);
            if (!stats) continue;

            // Check if we already have data of this type
            let exists;
            if (item.table === 'keywords') {
                exists = await db.get(`SELECT id FROM keywords WHERE type = ? LIMIT 1`, [item.type]);
            } else {
                exists = await db.get(`SELECT id FROM urls WHERE type = ? LIMIT 1`, [item.type]);
            }

            if (!exists) {
                console.log(`[IMPORT] Found legacy file ${item.file}, importing to ${item.table}...`);
                const content = await fs.readFile(filePath, 'utf8');
                const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

                for (const line of lines) {
                    if (item.table === 'keywords') {
                        await db.run(`INSERT INTO keywords (type, value) VALUES (?, ?)`, [item.type, line]);
                    } else {
                        // For URLs, we use normalizeUrl from config or just trim
                        // To avoid circular dependency, we'll do basic normalization here
                        const normUrl = line.replace(/\/$/, '');
                        await db.run(`INSERT OR IGNORE INTO urls (type, url) VALUES (?, ?)`, [item.type, normUrl]);
                    }
                }
                console.log(`[IMPORT] Successfully imported ${lines.length} items from ${item.file}`);
            }
        } catch (err) {
            console.error(`[IMPORT ERROR] Failed to import ${item.file}:`, err.message);
        }
    }
}
