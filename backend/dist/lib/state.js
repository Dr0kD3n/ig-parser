"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PATHS = exports.StateManager = void 0;
const db_1 = require("./db");
const config_1 = require("./config");
exports.StateManager = {
    processed: new Set(),
    processedDonors: new Set(),
    resultsCache: [], // Used for fast memory lookups if needed elsewhere
    async init() {
        const db = await (0, db_1.getDB)();
        // В urls с type 'history' лежат как processed_profiles, так и processed_donors. 
        // Мы разделим логику сейчас, или загрузим все в processed history.
        // Для простоты, все URLs обработанные скриптами можно считать историей.
        const historyRows = await db.all(`SELECT url FROM urls WHERE type = 'history'`);
        this.processed = new Set(historyRows.map(r => r.url));
        console.log(`🗄️ [ИСТОРИЯ] Загружено проверенных профилей/доноров: ${this.processed.size}`);
        // processDonors tracks which donors have been fully scanned during the current session
        // or loaded from history (type='history').
        this.processedDonors = new Set(historyRows.map(r => r.url));
        const profiles = await db.all(`SELECT * FROM profiles`);
        this.resultsCache = profiles;
    },
    has(url) {
        return this.processed.has((0, config_1.normalizeUrl)(url));
    },
    async add(url) {
        const normUrl = (0, config_1.normalizeUrl)(url);
        if (this.processed.has(normUrl))
            return;
        this.processed.add(normUrl);
        const db = await (0, db_1.getDB)();
        try {
            await db.run(`INSERT INTO urls (type, url) VALUES (?, ?)`, ['history', normUrl]);
        }
        catch (e) {
            // Already exists constraint
        }
    },
    hasDonor(url) {
        return this.processedDonors.has((0, config_1.normalizeUrl)(url));
    },
    async addDonor(url) {
        await this.add(url);
        const normUrl = (0, config_1.normalizeUrl)(url);
        this.processedDonors.add(normUrl);
        // We no longer delete from 'donor' type to keep the list in Settings visible
        // const db = await getDB();
        // try {
        //     await db.run('DELETE FROM urls WHERE type = ? AND url = ?', ['donor', normUrl]);
        //     console.log(`🗑️ Донор удален из списка рассылки: ${normUrl}`);
        // } catch (e: any) {
        //     console.error('Ошибка при удалении отработанного донора:', e);
        // }
    },
    async saveResult(profileData) {
        const db = await (0, db_1.getDB)();
        const existing = await db.get(`SELECT * FROM profiles WHERE url = ?`, [profileData.url]);
        const ts = new Date().toISOString();
        if (existing) {
            await db.run(`UPDATE profiles SET name = ?, bio = ?, photo = ?, timestamp = ? WHERE url = ?`, [profileData.name || existing.name, profileData.bio || existing.bio, profileData.photo || existing.photo, ts, profileData.url]);
        }
        else {
            await db.run(`INSERT INTO profiles (url, name, bio, photo, vote, timestamp) VALUES (?, ?, ?, ?, ?, ?)`, [profileData.url, profileData.name || '', profileData.bio || '', profileData.photo || '', profileData.vote || '', ts]);
        }
        console.log(`   🏆 [НАЙДЕНА] ${profileData.name || profileData.url} -> сохранена в базу!`);
    },
    async loadDonors() {
        const db = await (0, db_1.getDB)();
        const rows = await db.all(`SELECT url FROM urls WHERE type = 'donor'`);
        return rows.map(r => r.url);
    },
    async saveDonor(url) {
        const normUrl = (0, config_1.normalizeUrl)(url);
        const db = await (0, db_1.getDB)();
        try {
            await db.run(`INSERT OR REPLACE INTO urls (type, url) VALUES (?, ?)`, ['donor', normUrl]);
            console.log(`✅ Сохранен новый донор: ${normUrl}`);
        }
        catch (e) {
            // Ignore if already exists in donor table
        }
    },
    async saveDonors(urls) {
        const db = await (0, db_1.getDB)();
        try {
            await db.run(`DELETE FROM urls WHERE type = 'donor'`);
            for (const url of urls) {
                const normUrl = (0, config_1.normalizeUrl)(url);
                await db.run(`INSERT OR REPLACE INTO urls (type, url) VALUES (?, ?)`, ['donor', normUrl]);
            }
        }
        catch (e) {
            console.error('Ошибка при сохранении списка доноров:', e);
            throw e;
        }
    }
};
exports.PATHS = {};
