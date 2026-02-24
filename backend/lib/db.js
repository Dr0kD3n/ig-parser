const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs/promises');

const DB_PATH = path.join(__dirname, '..', '..', 'config', 'database.sqlite');
const CONFIG_DIR = path.dirname(DB_PATH);

let dbInstance = null;

async function getDB() {
    if (dbInstance) return dbInstance;

    // Обеспечиваем существование папки config
    try {
        await fs.mkdir(CONFIG_DIR, { recursive: true });
    } catch (e) {
        // Игнорируем ошибку, если папка уже существует
    }

    dbInstance = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
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
            bio TEXT,
            photo TEXT,
            vote TEXT, -- 'like', 'dislike'
            timestamp TEXT
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);

    try {
        await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN fingerprint TEXT`);
    } catch (e) {
        // Ignore if column already exists
    }

    return dbInstance;
}

module.exports = { getDB };
