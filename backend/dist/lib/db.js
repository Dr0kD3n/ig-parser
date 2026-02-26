"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDB = getDB;
const sqlite3_1 = __importDefault(require("sqlite3"));
const sqlite_1 = require("sqlite");
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const utils_1 = require("./utils");
const DB_PATH = path_1.default.join((0, utils_1.getRootPath)(), 'config', 'database.sqlite');
const CONFIG_DIR = path_1.default.dirname(DB_PATH);
let dbInstance = null;
async function getDB() {
    if (dbInstance)
        return dbInstance;
    // Обеспечиваем существование папки config
    try {
        await promises_1.default.mkdir(CONFIG_DIR, { recursive: true });
    }
    catch (e) {
        // Игнорируем ошибку, если папка уже существует
    }
    dbInstance = await (0, sqlite_1.open)({
        filename: DB_PATH,
        driver: sqlite3_1.default.Database
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
            tg_status TEXT, -- 'valid', 'invalid', NULL
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
    `);
    try {
        await dbInstance.exec(`ALTER TABLE profiles ADD COLUMN tg_status TEXT`);
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
    return dbInstance;
}
