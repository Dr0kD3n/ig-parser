const path = require('path');
const { getDB } = require('./db');

// Оставляем для совместимости, хотя новые методы используют БД
const getConfigPath = (fileName) => path.join(__dirname, '..', '..', 'config', fileName);

// Нормализация ссылок (убирает слэши на конце и параметры)
const normalizeUrl = (url) => {
    try {
        return new URL(url).href.split('?')[0].replace(/\/$/, '');
    } catch {
        return url.replace(/\/$/, '');
    }
};

async function getProxy(type = '') {
    try {
        const db = await getDB();
        let column = 'active_parser';
        if (type === 'server') column = 'active_server';
        if (type === 'index') column = 'active_index';
        if (type === 'profiles') column = 'active_profiles';

        const row = await db.get(`SELECT proxy FROM accounts WHERE ${column} = 1 LIMIT 1`);
        if (!row || !row.proxy) return null;

        const proxyStr = row.proxy;
        const parts = proxyStr.trim().split(':');
        if (parts.length < 4) return null;
        return {
            server: `http://${parts[0]}:${parts[1]}`,
            username: parts[2],
            password: parts[3]
        };
    } catch (e) {
        return null;
    }
}

async function getCookies(type = '') {
    try {
        const db = await getDB();
        let column = 'active_parser';
        if (type === 'server') column = 'active_server';
        if (type === 'index') column = 'active_index';
        if (type === 'profiles') column = 'active_profiles';

        const row = await db.get(`SELECT cookies FROM accounts WHERE ${column} = 1 LIMIT 1`);
        if (!row || !row.cookies) return [];

        const raw = row.cookies;
        const cookies = [];
        const names = ['csrftoken', 'datr', 'ds_user_id', 'ig_did', 'mid', 'sessionid', 'rur', 'wd', 'ig_nrcb'];

        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) { }

        names.forEach(name => {
            const regex = new RegExp(`(?:^|\\s|;|:)${name}(?:\\s*[:=]\\s*|\\s+)([^;\\n\\r]+)`, 'i');
            const match = raw.match(regex);

            if (match && match[1]) {
                let value = match[1].trim();
                if (value.includes('.instagram.com')) value = value.split('.instagram.com')[0].trim();
                if (value.includes(' ')) value = value.split(' ')[0].trim();

                if (value) {
                    cookies.push({
                        name: name, value: value, domain: '.instagram.com', path: '/', secure: true, sameSite: 'None'
                    });
                }
            }
        });
        return cookies;
    } catch (e) {
        return [];
    }
}

async function getList(fileName) {
    try {
        const db = await getDB();
        let type = '';
        if (fileName === 'names.txt') type = 'name';
        else if (fileName === 'cityKeywords.txt') type = 'city';
        else if (fileName === 'nicheKeywords.txt') type = 'niche';
        else return [];

        const rows = await db.all(`SELECT value FROM keywords WHERE type = ?`, [type]);
        return rows.map(r => r.value);
    } catch (e) {
        console.error("getList error:", e);
        return [];
    }
}

module.exports = {
    getConfigPath,
    normalizeUrl,
    getProxy,
    getCookies,
    getList
};
