import path from 'path';
import { getDB } from './db';

// Оставляем для совместимости, хотя новые методы используют БД
export const getConfigPath = (fileName: string): string => path.join(__dirname, '..', '..', 'config', fileName);

// Нормализация ссылок (убирает слэши на конце и параметры)
export const normalizeUrl = (url: string): string => {
    try {
        return new URL(url).href.split('?')[0].replace(/\/$/, '');
    } catch {
        return url.replace(/\/$/, '');
    }
};

export interface ProxyConfig {
    server: string;
    username: string;
    password: string;
}

export async function getProxy(type: string = ''): Promise<ProxyConfig | null> {
    try {
        const db = await getDB();
        let column: string | undefined;
        if (type === 'server') column = 'active_server';
        else if (type === 'index') column = 'active_index';
        else if (type === 'profiles') column = 'active_profiles';
        else if (type === 'checker') column = 'active_checker';
        else if (type === 'parser') column = 'active_parser';

        if (!column) return null;

        const row = await db.get(`SELECT proxy FROM accounts WHERE ${column} > 0 ORDER BY ${column} ASC LIMIT 1`);
        if (!row || !row.proxy) return null;

        const proxyStr: string = row.proxy;
        const parts = proxyStr.trim().split(':');
        if (parts.length < 4) return null;
        return {
            server: `http://${parts[0]}:${parts[1]}`,
            username: parts[2],
            password: parts[3]
        };
    } catch (e: any) {
        return null;
    }
}

export interface Cookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    secure: boolean;
    sameSite: 'None' | 'Lax' | 'Strict';
}

export async function getCookies(type: string = ''): Promise<Cookie[]> {
    try {
        const db = await getDB();
        let column: string | undefined;
        if (type === 'server') column = 'active_server';
        else if (type === 'index') column = 'active_index';
        else if (type === 'profiles') column = 'active_profiles';
        else if (type === 'checker') column = 'active_checker';
        else if (type === 'parser') column = 'active_parser';

        if (!column) return [];

        const row = await db.get(`SELECT cookies FROM accounts WHERE ${column} > 0 ORDER BY ${column} ASC LIMIT 1`);
        if (!row || !row.cookies) return [];

        const raw: string = row.cookies;
        const cookies: Cookie[] = [];
        const names = ['csrftoken', 'datr', 'ds_user_id', 'ig_did', 'mid', 'sessionid', 'rur', 'wd', 'ig_nrcb'];

        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                return parsed.filter(c => names.includes(c.name));
            }
        } catch (e: any) { }

        names.forEach(name => {
            const regex = new RegExp(`(?:^|\\s|;|:)${name}(?:\\s*[:=]\\s*|\\s+)([^;\\n\\r]+)`, 'i');
            const match = raw.match(regex);

            if (match && match[1]) {
                let value = match[1].trim();
                if (value.includes('.instagram.com')) value = value.split('.instagram.com')[0].trim();
                if (value.includes(' ')) value = value.split(' ')[0].trim();

                if (value) {
                    cookies.push({
                        name: name,
                        value: value,
                        domain: '.instagram.com',
                        path: '/',
                        secure: true,
                        sameSite: 'None'
                    });
                }
            }
        });
        return cookies;
    } catch (e: any) {
        return [];
    }
}

export async function getList(fileName: string): Promise<string[]> {
    try {
        const db = await getDB();
        let type = '';
        if (fileName === 'names.txt') type = 'name';
        else if (fileName === 'cityKeywords.txt') type = 'city';
        else if (fileName === 'nicheKeywords.txt') type = 'niche';
        else return [];

        const rows = await db.all(`SELECT value FROM keywords WHERE type = ?`, [type]);
        return rows.map(r => r.value);
    } catch (e: any) {
        console.error("getList error:", e);
        return [];
    }
}

export async function getSetting<T = any>(key: string): Promise<T | null> {
    try {
        const db = await getDB();
        const row = await db.get(`SELECT value FROM settings WHERE key = ?`, [key]);
        if (!row) return null;
        try { return JSON.parse(row.value); } catch { return row.value as unknown as T; }
    } catch (e: any) {
        return null;
    }
}

export interface AccountInfo {
    proxy: ProxyConfig | null;
    cookies: Cookie[];
    fingerprint: any | null;
}

export async function getAllAccounts(type: string = ''): Promise<AccountInfo[]> {
    try {
        const db = await getDB();
        let column: string | undefined;
        if (type === 'server') column = 'active_server';
        else if (type === 'index') column = 'active_index';
        else if (type === 'profiles') column = 'active_profiles';
        else if (type === 'checker') column = 'active_checker';
        else if (type === 'parser') column = 'active_parser';

        if (!column) return [];

        const rows = await db.all(`SELECT proxy, cookies, fingerprint FROM accounts WHERE ${column} > 0 ORDER BY ${column} ASC`);
        if (!rows || rows.length === 0) return [];

        return rows.map(row => {
            let proxyObj: ProxyConfig | null = null;
            if (row.proxy) {
                const parts = row.proxy.trim().split(':');
                if (parts.length >= 4) {
                    proxyObj = {
                        server: `http://${parts[0]}:${parts[1]}`,
                        username: parts[2],
                        password: parts[3]
                    };
                }
            }

            let cookiesArr: Cookie[] = [];
            if (row.cookies) {
                const raw: string = row.cookies;
                const names = ['csrftoken', 'datr', 'ds_user_id', 'ig_did', 'mid', 'sessionid', 'rur', 'wd', 'ig_nrcb'];
                try {
                    const parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        cookiesArr = parsed.filter(c => names.includes(c.name));
                    }
                } catch (e: any) {
                    names.forEach(name => {
                        const regex = new RegExp(`(?:^|\\s|;|:)${name}(?:\\s*[:=]\\s*|\\s+)([^;\\n\\r]+)`, 'i');
                        const match = raw.match(regex);
                        if (match && match[1]) {
                            let value = match[1].trim();
                            if (value.includes('.instagram.com')) value = value.split('.instagram.com')[0].trim();
                            if (value.includes(' ')) value = value.split(' ')[0].trim();
                            if (value) {
                                cookiesArr.push({
                                    name: name,
                                    value: value,
                                    domain: '.instagram.com',
                                    path: '/',
                                    secure: true,
                                    sameSite: 'None'
                                });
                            }
                        }
                    });
                }
            }
            let fingerprintObj: any = null;
            if (row.fingerprint) {
                try {
                    fingerprintObj = JSON.parse(row.fingerprint);
                } catch (e: any) {
                    console.error('Error parsing fingerprint:', e);
                }
            }
            return { proxy: proxyObj, cookies: cookiesArr, fingerprint: fingerprintObj };
        });
    } catch (e: any) {
        return [];
    }
}
