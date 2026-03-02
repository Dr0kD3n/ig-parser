const express_1 = require("express");
const fs_1 = require("fs");
const path_1 = require("path");
const http_1 = require("http");
const https_1 = require("https");
const browser_1 = require("./lib/browser");
const utils_1 = require("./lib/utils");
const state_1 = require("./lib/state");
const db_1 = require("./lib/db");
const child_process_1 = require("child_process");
const events_1 = require("events");
const fingerprint_1 = require("./lib/fingerprint");
const reporter_1 = require("./lib/reporter");
const config_1 = require("./lib/config");
const logEmitter = new events_1.EventEmitter();
const LOGS_FILE = path_1.join(utils_1.getRootPath(), 'data', 'logs.json');
let botProcesses = {
    index: null,
    parser: null
};
// Tracking sessions for log grouping
let currentSessionId = Date.now().toString();
function refreshSession() {
    currentSessionId = Date.now().toString();
}
let historicalLogs = [];
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;
try {
    if (fs_1.existsSync(LOGS_FILE)) {
        historicalLogs = JSON.parse(fs_1.readFileSync(LOGS_FILE, 'utf8'));
    }
}
catch (e) {
    originalLog('Error loading logs:', e);
}
function saveLogs() {
    try {
        fs_1.writeFileSync(LOGS_FILE, JSON.stringify(historicalLogs.slice(-1000)));
    }
    catch (e) {
        originalLog('Error saving logs:', e);
    }
}
let saveLogsTimer = null;
function debouncedSaveLogs() {
    if (saveLogsTimer)
        return;
    saveLogsTimer = setTimeout(() => {
        saveLogsTimer = null;
        saveLogs();
    }, 2000);
}
function broadcastLog(source, message) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        source,
        message: message.toString().trim(),
        sessionId: currentSessionId
    };
    // Use originalLog to avoid infinite recursion when console.log is overridden
    originalLog(`[${source}] ${logEntry.message}`);
    historicalLogs.push(logEntry);
    if (historicalLogs.length > 1000)
        historicalLogs.shift();
    debouncedSaveLogs();
    logEmitter.emit('log', logEntry);
}
// Override console methods to broadcast logs
console.log = (...args) => {
    broadcastLog('server', args.join(' '));
};
console.error = (...args) => {
    broadcastLog('server-error', args.join(' '));
};
console.warn = (...args) => {
    broadcastLog('server-warn', args.join(' '));
};
const app = express_1();
const PORT = process.env.PORT || 1337;
// ==========================================
// 1. CONFIGURATION & SELECTORS
// ==========================================
const CONFIG = {
    timeouts: {
        pageLoad: 60000,
        element: 5000,
        typingDelayMin: 50,
        typingDelayMax: 180,
    },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    selectors: {
        directMessageBtn: [
            // RU
            'button:has-text("Написать")',
            'div[role="button"]:has-text("Написать")',
            'a:has-text("Написать")',
            'button:has-text("Отправить сообщение")',
            'div[role="button"]:has-text("Отправить сообщение")',
            'div[role="button"]:has-text("Сообщение")',
            // EN
            'div[role="button"]:has-text("Message")',
            'button:has-text("Message")',
            'div[role="button"]:has-text("Send Message")'
        ],
        optionsBtn: [
            'svg[aria-label="Параметры"]',
            'svg[aria-label="Options"]',
            'svg[aria-label="More options"]',
            'div[role="button"] > svg'
        ],
        menuMessageBtn: [
            'div[role="dialog"] button:has-text("Отправить сообщение")',
            'div[role="dialog"] button:has-text("Написать")',
            'div[role="dialog"] button:has-text("Send message")'
        ],
        chatInput: 'div[role="textbox"][contenteditable="true"]',
        notNowBtn: [
            'button:has-text("Не сейчас")',
            'button:has-text("Not Now")'
        ],
        messageRow: 'div[role="row"], div[role="listitem"]'
    }
};
async function getSettings() {
    const db = await (0, db_1.getDB)();
    const rows = await db.all(`SELECT * FROM accounts`);
    const accounts = rows.map(r => ({
        id: r.id, name: r.name, proxy: r.proxy, cookies: r.cookies, fingerprint: r.fingerprint
    }));
    const activeParserIds = rows.filter(r => r.active_parser).sort((a, b) => a.active_parser - b.active_parser).map(r => r.id);
    const activeServerIds = rows.filter(r => r.active_server).sort((a, b) => a.active_server - b.active_server).map(r => r.id);
    const activeIndexIds = rows.filter(r => r.active_index).sort((a, b) => a.active_index - b.active_index).map(r => r.id);
    const activeProfilesIds = rows.filter(r => r.active_profiles).sort((a, b) => a.active_profiles - b.active_profiles).map(r => r.id);
    const showBrowserStr = await db.get(`SELECT value FROM settings WHERE key = 'showBrowser'`);
    const showBrowser = showBrowserStr ? showBrowserStr.value === 'true' : false;
    const concurrentProfilesStr = await db.get(`SELECT value FROM settings WHERE key = 'concurrentProfiles'`);
    const concurrentProfiles = concurrentProfilesStr ? parseInt(concurrentProfilesStr.value) : 3;
    const humanEmulationStr = await db.get(`SELECT value FROM settings WHERE key = 'humanEmulation'`);
    const humanEmulation = humanEmulationStr ? humanEmulationStr.value === 'true' : false;
    return {
        accounts,
        activeParserAccountIds: activeParserIds,
        activeServerAccountIds: activeServerIds,
        activeIndexAccountIds: activeIndexIds,
        activeProfilesAccountIds: activeProfilesIds,
        showBrowser,
        concurrentProfiles,
        humanEmulation
    };
}
app.use(express_1.json());
// --- Static frontend (production build from frontend/) ---
const baseDir = path_1.basename(__dirname) === 'dist' ? path_1.join(__dirname, '..') : __dirname;
const publicDir = path_1.join(baseDir, 'public');
const legacyHtml = path_1.join(baseDir, 'index.html');
if (fs_1.existsSync(publicDir)) {
    app.use(express_1.static(publicDir));
}
else {
    // --- Fallback to old single-file index.html during migration
    app.get('/', (req, res) => res.sendFile(legacyHtml));
}
// --- In-memory cache for profiles ---
let girlsCache = null;
let girlsCacheTime = 0;
const CACHE_TTL = 5000; // 5 seconds
async function getGirlsCached() {
    const now = Date.now();
    if (girlsCache && (now - girlsCacheTime) < CACHE_TTL)
        return girlsCache;
    try {
        const db = await (0, db_1.getDB)();
        let profiles = await db.all(`
            SELECT p.*, 
                   d.name as donor_name, 
                   d.bio as donor_bio, 
                   d.followers_count as donor_followers_count,
                   d.photo as donor_photo
            FROM profiles p
            LEFT JOIN donors d ON p.donor = d.username
            ORDER BY p.timestamp DESC
        `);
        girlsCache = profiles;
        girlsCacheTime = now;
    }
    catch (e) {
        girlsCache = [];
    }
    return girlsCache;
}
function invalidateGirlsCache() {
    girlsCache = null;
    girlsCacheTime = 0;
}
app.get('/api/girls', async (req, res) => {
    res.json(await getGirlsCached());
});
app.get('/api/donors-collected', async (req, res) => {
    try {
        const db = await (0, db_1.getDB)();
        const rows = await db.all(`SELECT DISTINCT donor FROM profiles WHERE donor IS NOT NULL AND donor != '' ORDER BY donor ASC`);
        res.json(rows.map(r => r.donor));
    }
    catch (e) {
        res.status(500).json([]);
    }
});
app.get('/api/votes', async (req, res) => {
    const profiles = await getGirlsCached();
    const votes = {};
    profiles?.forEach(p => {
        if (p.vote)
            votes[p.url] = p.vote;
    });
    res.json(votes);
});
app.post('/api/vote', async (req, res) => {
    const { url, status } = req.body;
    if (!url || !status) {
        return res.status(400).json({ success: false, error: 'Нет url или status' });
    }
    try {
        const db = await (0, db_1.getDB)();
        await db.run(`UPDATE profiles SET vote = ? WHERE url = ?`, [status, url]);
        invalidateGirlsCache();
        console.log(`[GOLOS] ${status} -> добавлен в профиль: ${url}`);
        res.json({ success: true });
    }
    catch (e) {
        console.log(`[GOLOS ERROR] Ошибка при голосовании: ${e.message}`);
        res.status(500).json({ success: false, error: 'Ошибка сервера при сохранении' });
    }
});
async function checkTelegramProfile(url) {
    const fetchUrl = url.startsWith('http') ? url : `https://t.me/${url}`;
    return new Promise((resolve, reject) => {
        const req = https_1.get(fetchUrl, {
            headers: { 'User-Agent': CONFIG.userAgent }
        }, (res) => {
            // Follow redirects manually if needed for t.me
            if ([301, 302].includes(res.statusCode || 0) && res.headers.location) {
                if (res.headers.location.includes('telegram.org') && !res.headers.location.includes('t.me')) {
                    return resolve('invalid');
                }
                // Recurse for internal redirects if any
                return checkTelegramProfile(res.headers.location).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                // Check for profile markers
                // Valid profiles on t.me MUST have a "tgme_page_title"
                const hasTitle = data.includes('tgme_page_title');
                const isMainSite = data.includes('telegram.org') && !data.includes('tgme_page');
                if (isMainSite || !hasTitle) {
                    resolve('invalid');
                }
                else {
                    resolve('valid');
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
}
app.get('/api/check-telegram', async (req, res) => {
    const url = req.query.url;
    if (!url || typeof url !== 'string')
        return res.status(400).json({ success: false, error: 'Missing or invalid url' });
    console.log(`[TG CHECK] Checking: ${url}`);
    try {
        const status = await checkTelegramProfile(url);
        console.log(`[TG CHECK] Result for ${url}: ${status}`);
        // Update DB
        const db = await db_1.getDB();
        await db.run(`UPDATE profiles SET tg_status = ? WHERE url = ? OR name = ?`, [status, url, url.replace('https://t.me/', '')]);
        invalidateGirlsCache();
        res.json({ success: true, status });
    }
    catch (e) {
        console.error(`[TG CHECK ERROR] ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});
app.post('/api/check-telegram-batch', async (req, res) => {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls))
        return res.status(400).json({ success: false, error: 'Invalid urls' });
    console.log(`[TG BATCH CHECK] Starting for ${urls.length} profiles`);
    const results = [];
    const BATCH_SIZE = 10;
    const db = await (0, db_1.getDB)();
    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
        const batch = urls.slice(i, i + BATCH_SIZE);
        console.log(`[TG BATCH CHECK] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(urls.length / BATCH_SIZE)}`);
        const batchPromises = batch.map(async (url) => {
            try {
                const status = await checkTelegramProfile(url);
                await db.run(`UPDATE profiles SET tg_status = ? WHERE url = ? OR name = ?`, [status, url, url.replace('https://t.me/', '')]);
                return { url, status, success: true };
            }
            catch (e) {
                console.error(`[TG BATCH CHECK ERROR] Failed ${url}: ${e.message}`);
                return { url, success: false, error: e.message };
            }
        });
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        // Small delay between batches to avoid being too aggressive
        if (i + BATCH_SIZE < urls.length) {
            await (0, utils_1.wait)(1000);
        }
    }
    invalidateGirlsCache();
    res.json({ success: true, results });
});
app.get('/api/settings', async (req, res) => {
    const settings = await getSettings();
    const names = await (0, config_1.getList)('names.txt');
    const cities = await (0, config_1.getList)('cityKeywords.txt');
    const niches = await (0, config_1.getList)('nicheKeywords.txt');
    const donors = await state_1.StateManager.loadDonors();
    res.json({
        accounts: settings.accounts || [],
        activeParserAccountIds: settings.activeParserAccountIds,
        activeServerAccountIds: settings.activeServerAccountIds,
        activeIndexAccountIds: settings.activeIndexAccountIds,
        activeProfilesAccountIds: settings.activeProfilesAccountIds,
        names,
        cities,
        niches,
        donors,
        showBrowser: settings.showBrowser,
        concurrentProfiles: settings.concurrentProfiles,
        humanEmulation: settings.humanEmulation
    });
});
app.post('/api/settings', async (req, res) => {
    const { accounts, names, cities, niches, donors, showBrowser } = req.body;
    try {
        const db = await (0, db_1.getDB)();
        await db.run('BEGIN TRANSACTION');
        try {
            if (req.body.hasOwnProperty('accounts')) {
                // Safeguard: don't delete all accounts if list is empty but we had accounts, 
                // unless it's a deliberate choice (e.g. forceEmpty flag)
                const existingAccounts = await db.all('SELECT id FROM accounts');
                if (existingAccounts.length > 0 && (!accounts || accounts.length === 0) && !req.body.forceEmpty) {
                    console.warn('Blocked attempt to clear accounts list without forceEmpty flag');
                }
                else {
                    const incomingIds = (accounts || []).map((a) => a.id);
                    if (incomingIds.length > 0) {
                        const placeholders = incomingIds.map(() => '?').join(',');
                        await db.run(`DELETE FROM accounts WHERE id NOT IN (${placeholders})`, incomingIds);
                    }
                    else {
                        await db.run(`DELETE FROM accounts`);
                    }
                    for (const a of (accounts || [])) {
                        const getPriority = (arr, id) => {
                            const idx = (arr || []).indexOf(id);
                            return idx === -1 ? 0 : idx + 1;
                        };
                        let fingerprint = a.fingerprint;
                        if (!fingerprint) {
                            fingerprint = JSON.stringify((0, fingerprint_1.generateFingerprint)());
                        }
                        else if (typeof fingerprint !== 'string') {
                            fingerprint = JSON.stringify(fingerprint);
                        }
                        await db.run(`INSERT OR REPLACE INTO accounts (id, name, proxy, cookies, active_parser, active_server, active_index, active_profiles, fingerprint)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                            a.id, a.name, a.proxy || '', a.cookies || '',
                            getPriority(req.body.activeParserAccountIds, a.id),
                            getPriority(req.body.activeServerAccountIds, a.id),
                            getPriority(req.body.activeIndexAccountIds, a.id),
                            getPriority(req.body.activeProfilesAccountIds, a.id),
                            fingerprint
                        ]);
                    }
                }
            }
            // Only update keywords if they are explicitly provided in the request
            const updateList = async (type, items) => {
                if (!req.body.hasOwnProperty(type + 's'))
                    return;
                const cleanItems = (items || []).map(i => i.trim()).filter(Boolean);
                // Safeguard: if incoming is empty but DB has many, block it unless forceEmpty
                const existing = await db.get(`SELECT count(*) as c FROM keywords WHERE type = ?`, [type]);
                if (existing.c > 5 && cleanItems.length === 0 && !req.body.forceEmpty) {
                    console.warn(`Blocked attempt to clear ${type} list without forceEmpty flag`);
                    return;
                }
                await db.run(`DELETE FROM keywords WHERE type = ?`, [type]);
                for (const val of cleanItems) {
                    await db.run(`INSERT INTO keywords (type, value) VALUES (?, ?)`, [type, val]);
                }
            };
            await updateList('name', names);
            await updateList('city', cities);
            await updateList('niche', niches);
            if (req.body.hasOwnProperty('donors')) {
                const cleanDonors = (donors || []).map((d) => d.trim()).filter(Boolean);
                // Safeguard: if incoming is empty but DB has many, block it unless forceEmpty
                const existingDonors = await state_1.StateManager.loadDonors();
                if (existingDonors.length > 5 && cleanDonors.length === 0 && !req.body.forceEmpty) {
                    console.warn('Blocked attempt to clear donors list without forceEmpty flag');
                }
                else {
                    await state_1.StateManager.saveDonors(cleanDonors);
                }
            }
            if (req.body.hasOwnProperty('showBrowser')) {
                await db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, ['showBrowser', showBrowser ? 'true' : 'false']);
            }
            if (req.body.hasOwnProperty('concurrentProfiles')) {
                await db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, ['concurrentProfiles', req.body.concurrentProfiles.toString()]);
            }
            if (req.body.hasOwnProperty('humanEmulation')) {
                await db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, ['humanEmulation', req.body.humanEmulation ? 'true' : 'false']);
            }
            await db.run('COMMIT');
        }
        catch (txErr) {
            await db.run('ROLLBACK');
            throw txErr;
        }
        res.json({ success: true });
    }
    catch (e) {
        console.error('Ошибка сохранения настроек:', e);
        res.status(500).json({ success: false });
    }
});
const authorizer_1 = require("./lib/authorizer");
// ... existing code ...
app.post('/api/accounts/:id/authorize/start', async (req, res) => {
    const { id } = req.params;
    try {
        const db = await (0, db_1.getDB)();
        const acc = await db.get('SELECT * FROM accounts WHERE id = ?', [id]);
        if (!acc) return res.status(404).json({ success: false, error: 'Account not found' });

        const result = await authorizer_1.startAuthorization(id, acc.name, acc.proxy, acc.fingerprint ? JSON.parse(acc.fingerprint) : null);
        res.json(result);
    } catch (e) {
        console.error('Error starting auth:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/accounts/:id/authorize/status', (req, res) => {
    const { id } = req.params;
    res.json({ active: authorizer_1.getAuthorizationStatus(id) });
});

app.post('/api/accounts/:id/authorize/stop', async (req, res) => {
    const { id } = req.params;
    const result = await authorizer_1.stopAuthorization(id);
    res.json(result);
});

app.post('/api/accounts/:id/browser/start', async (req, res) => {
    const { id } = req.params;
    try {
        const db = await (0, db_1.getDB)();
        const acc = await db.get('SELECT * FROM accounts WHERE id = ?', [id]);
        if (!acc) return res.status(404).json({ success: false, error: 'Account not found' });

        const result = await authorizer_1.startAuthorization(id, acc.name, acc.proxy, acc.fingerprint ? JSON.parse(acc.fingerprint) : null, false);
        res.json(result);
    } catch (e) {
        console.error('Error starting browser:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.put('/api/accounts/:id', async (req, res) => {
    const { id } = req.params;
    const { name, proxy, cookies, fingerprint, regenerateFingerprint } = req.body;
    try {
        const db = await (0, db_1.getDB)();
        const existing = await db.get('SELECT id FROM accounts WHERE id = ?', [id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Account not found' });
        }
        const updates = [];
        const values = [];
        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name);
        }
        if (proxy !== undefined) {
            updates.push('proxy = ?');
            values.push(proxy);
        }
        if (cookies !== undefined) {
            updates.push('cookies = ?');
            values.push(cookies);
        }
        if (fingerprint !== undefined) {
            updates.push('fingerprint = ?');
            values.push(typeof fingerprint === 'object' ? JSON.stringify(fingerprint) : fingerprint);
        }
        if (regenerateFingerprint) {
            updates.push('fingerprint = ?');
            values.push(JSON.stringify((0, fingerprint_1.generateFingerprint)()));
        }
        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }
        values.push(id);
        await db.run(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`, values);
        res.json({ success: true });
    }
    catch (e) {
        console.error('Ошибка обновления аккаунта:', e);
        res.status(500).json({ success: false });
    }
});
// --- Proxy image endpoint: fetches images through configured account proxy ---
app.get('/api/proxy-image', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl || typeof imageUrl !== 'string')
        return res.status(400).send('Missing or invalid url parameter');
    try {
        const proxy = await config_1.getProxy('donors');
        const parsedUrl = new URL(imageUrl);
        const transport = parsedUrl.protocol === 'https:' ? https_1 : http_1;
        const fetchOptions = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            headers: {
                'User-Agent': CONFIG.userAgent,
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                'Referer': 'https://www.instagram.com/'
            }
        };
        async function fetchWithRetry(url, options, transport, retries = 3) {
            for (let i = 0; i < retries; i++) {
                try {
                    return await new Promise((resolve, reject) => {
                        const proxyReq = transport.request(options, (res) => {
                            resolve(res);
                        });
                        proxyReq.on('error', (e) => {
                            if (i === retries - 1)
                                reject(e);
                            else
                                reject(e); // Will be caught by catch block
                        });
                        proxyReq.setTimeout(15000, () => {
                            proxyReq.destroy();
                            reject(new Error('Timeout'));
                        });
                        proxyReq.end();
                    });
                }
                catch (e) {
                    console.warn(`[IMAGE PROXY] Fetch attempt ${i + 1} failed: ${e.message}`);
                    if (i === retries - 1)
                        throw e;
                    await (0, utils_1.wait)(1000 * (i + 1));
                }
            }
        }
        // If proxy is configured, route through it via HTTP CONNECT
        if (proxy) {
            const proxyUrl = new URL(proxy.server);
            const authHeader = 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
            // For HTTPS targets, use HTTP CONNECT tunnel
            if (parsedUrl.protocol === 'https:') {
                const connectReq = http_1.request({
                    host: proxyUrl.hostname,
                    port: proxyUrl.port || 80,
                    method: 'CONNECT',
                    path: `${parsedUrl.hostname}:443`,
                    headers: { 'Proxy-Authorization': authHeader }
                });
                connectReq.on('connect', async (_res, socket) => {
                    if (_res.statusCode !== 200) {
                        return res.status(502).send('Proxy CONNECT failed');
                    }
                    const connector = parsedUrl.protocol === 'https:' ? https_1 : http_1;
                    const proxyReqOptions = {
                        ...fetchOptions,
                        socket: socket,
                        agent: false
                    };
                    try {
                        const imgRes = await fetchWithRetry(imageUrl, proxyReqOptions, connector);
                        handleImageResponse(imgRes);
                    }
                    catch (e) {
                        console.error('Proxy HTTPS request error after retries:', e);
                        res.status(502).send('Proxy HTTPS image fetch error');
                    }
                });
                connectReq.on('error', () => res.status(502).send('Proxy connect error'));
                connectReq.end();
            }
            else {
                // For HTTP targets, use standard HTTP request
                const proxyReqOptions = {
                    hostname: proxyUrl.hostname,
                    port: proxyUrl.port || 80,
                    path: imageUrl,
                    headers: {
                        ...fetchOptions.headers,
                        'Proxy-Authorization': authHeader,
                        'Host': parsedUrl.hostname
                    }
                };
                try {
                    const imgRes = await fetchWithRetry(imageUrl, proxyReqOptions, http_1);
                    handleImageResponse(imgRes);
                }
                catch (e) {
                    console.error('Proxy HTTP error after retries:', e);
                    res.status(502).send('Proxy HTTP error');
                }
            }
        }
        else {
            // No proxy — direct fetch
            try {
                const imgRes = await fetchWithRetry(imageUrl, fetchOptions, transport);
                handleImageResponse(imgRes);
            }
            catch (e) {
                console.error('Direct fetch error after retries:', e);
                res.status(502).send('Direct image fetch error: ' + e.message);
            }
        }
        function handleImageResponse(imgRes) {
            // Follow redirects (Instagram CDN does 301/302)
            if ([301, 302, 307, 308].includes(imgRes.statusCode) && imgRes.headers.location) {
                // Redirect — fetch again without proxy (CDN URLs are public)
                const redirectTransport = imgRes.headers.location.startsWith('https') ? https_1 : http_1;
                redirectTransport.get(imgRes.headers.location, (redirRes) => {
                    res.setHeader('Content-Type', redirRes.headers['content-type'] || 'image/jpeg');
                    res.setHeader('Cache-Control', 'public, max-age=86400');
                    redirRes.pipe(res);
                }).on('error', () => res.status(502).send('Redirect fetch error'));
                return;
            }
            if (imgRes.statusCode !== 200) {
                return res.status(imgRes.statusCode || 502).send('Image not available');
            }
            res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            imgRes.pipe(res);
        }
    }
    catch (e) {
        console.error('Image proxy error:', e);
        res.status(500).send('Internal server error');
    }
});
app.post('/api/logs/clear', (req, res) => {
    historicalLogs = [];
    debouncedSaveLogs();
    res.json({ success: true });
});
app.get('/api/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // res.flushHeaders(); // Not available in some Express versions without compression middleware
    // Send historical logs first
    historicalLogs.forEach(log => {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
    });
    const onLog = (log) => {
        res.write(`data: ${JSON.stringify(log)}\n\n`);
    };
    logEmitter.on('log', onLog);
    req.on('close', () => {
        logEmitter.off('log', onLog);
    });
});
app.get('/api/live-view', (req, res) => {
    const liveViewPath = path_1.join(utils_1.getRootPath(), 'data', 'screenshots', 'live_view.jpg');
    res.sendFile(liveViewPath, { headers: { 'Cache-Control': 'no-store' } }, err => {
        if (err)
            res.status(404).send('Not generated yet');
    });
});
app.get('/api/bot/status', (req, res) => {
    res.json({
        index: !!botProcesses.index,
        parser: !!botProcesses.parser
    });
});
app.post('/api/bot/start', (req, res) => {
    const { type } = req.body;
    if (!['index', 'parser'].includes(type)) {
        return res.status(400).json({ success: false, error: 'Invalid bot type' });
    }
    if (botProcesses[type]) {
        return res.json({ success: false, error: 'Bot already running' });
    }
    refreshSession();
    const isPkg = process['pkg'] !== undefined;
    const scriptExt = 'js';
    const scriptPath = path_1.join(__dirname, `${type}.${scriptExt}`);
    if (!fs_1.existsSync(scriptPath)) {
        return res.status(404).json({ success: false, error: `Script for ${type} not found at ${scriptPath}` });
    }
    const runner = isPkg ? process.execPath : 'node';
    const args = isPkg ? [scriptPath] : [scriptPath];
    const cwdPath = isPkg ? path_1.dirname(process.execPath) : __dirname;
    const child = child_process_1.spawn(runner, args, {
        cwd: cwdPath,
        env: { ...process.env, FORCE_COLOR: '1' },
        shell: false
    });
    botProcesses[type] = child;
    // Обработка ошибки запуска самого процесса
    child.on('error', (err) => {
        broadcastLog(`${type}-error`, `Failed to start process: ${err.message}`);
        botProcesses[type] = null;
    });
    child.stdout?.on('data', (data) => broadcastLog(type, data));
    child.stderr?.on('data', (data) => broadcastLog(`${type}-error`, data));
    child.on('close', (code) => {
        broadcastLog('system', `${type} bot exited with code ${code}`);
        botProcesses[type] = null;
    });
    res.json({ success: true });
});
app.post('/api/bot/stop', (req, res) => {
    const { type } = req.body;
    const child = botProcesses[type];
    if (child) {
        let finished = false;
        const timeout = setTimeout(() => {
            if (!finished) {
                finished = true;
                if (botProcesses[type] === child) {
                    botProcesses[type] = null;
                }
                if (!res.headersSent) {
                    res.json({ success: true, message: 'Stop timeout' });
                }
            }
        }, 5000);

        child.once('close', () => {
            if (!finished) {
                finished = true;
                clearTimeout(timeout);
                if (!res.headersSent) {
                    res.json({ success: true });
                }
            }
        });

        if (process.platform === 'win32') {
            (0, child_process_1.exec)(`taskkill /F /T /PID ${child.pid}`, (err) => {
                if (err) {
                    console.error(`[SYSTEM] Error killing process ${child.pid}:`, err);
                    child.kill();
                }
            });
        }
        else {
            child.kill();
        }
    }
    else {
        res.json({ success: false, error: 'Bot not running' });
    }
});
app.post('/api/skip-donor', async (req, res) => {
    try {
        console.log('📢 [API] Получен запрос на пропуск текущего донора...');
        fs_1.writeFileSync(path_1.join((0, utils_1.getRootPath)(), 'data', 'skip_donor.flag'), 'skip');
        res.json({ success: true, message: 'Сигнал пропуска донора отправлен' });
    }
    catch (e) {
        console.error('❌ [API] Ошибка при создании skip_donor.flag:', e);
        res.json({ success: false, error: 'Ошибка при отправке сигнала' });
    }
});
app.post('/api/dm', async (req, res) => {
    const { url, message } = req.body;
    console.log({ url, message });
    let currentContext = null;
    try {
        const accountsData = await (0, config_1.getAllAccounts)('server');
        const firstAccount = accountsData[0] || {};
        const reqConfig = {
            id: firstAccount.id,
            proxy: firstAccount.proxy,
            cookies: firstAccount.cookies,
            fingerprint: firstAccount.fingerprint
        };

        if (!reqConfig.cookies || reqConfig.cookies.length === 0) {
            return res.status(400).json({ success: false, error: 'Выбранный аккаунт не имеет куки. Пожалуйста, авторизуйте его сначала.' });
        }

        const showBrowser = await (0, config_1.getSetting)('showBrowser');
        refreshSession();
        const { browser, context } = await (0, browser_1.createBrowserContext)(reqConfig, !(showBrowser === 'true' || showBrowser === true));
        console.log(`📡 [SENDER] Используется прокси: ${reqConfig.proxy ? reqConfig.proxy.server : 'ПРЯМОЕ СОЕДИНЕНИЕ'}`);
        console.log(`🍪 [SENDER] Загружено куки: ${reqConfig.cookies.length}`);
        currentContext = context;
        const liveViewInterval = (0, browser_1.startLiveView)(context);
        const isSent = await sendMessageToProfile(context, url, message);
        clearInterval(liveViewInterval);
        if (isSent) {
            try {
                const db = await (0, db_1.getDB)();
                await db.run(`INSERT INTO messages_log (url, message_text, status, timestamp) VALUES (?, ?, ?, ?)`, [url, message, 'sent', new Date().toISOString()]);
            }
            catch (dbErr) {
                console.error('Ошибка сохранения в messages_log:', dbErr);
            }
            res.json({ success: true, message: 'Отправлено' });
        }
        else {
            res.json({ success: false, message: 'Не отправлено' });
        }
    }
    catch (e) {
        console.error('Ошибка запуска:', e);
        res.status(500).json({ success: false });
    }
    finally {
        if (currentContext)
            await currentContext.close();
    }
});
app.get('/api/stats', async (req, res) => {
    try {
        const db = await (0, db_1.getDB)();
        const rows = await db.all(`
            SELECT 
                message_text,
                COUNT(*) as total_sent,
                SUM(CASE WHEN status IN ('replied', 'continued') THEN 1 ELSE 0 END) as replies,
                SUM(CASE WHEN status = 'continued' THEN 1 ELSE 0 END) as continuations
            FROM messages_log
            GROUP BY message_text
            ORDER BY total_sent DESC
        `);
        res.json({ success: true, data: rows });
    }
    catch (e) {
        console.error('Ошибка получения статистики:', e);
        res.status(500).json({ success: false, error: 'Ошибка сервера' });
    }
});
app.listen(PORT, async () => {
    await state_1.StateManager.init();
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});
// SPA catch-all (must be after all API routes)
app.use((req, res) => {
    if (fs_1.existsSync(publicDir)) {
        res.sendFile(path_1.join(publicDir, 'index.html'));
    }
    else {
        res.status(404).send('Not Found');
    }
});
const getSelectorString = (key) => {
    const val = CONFIG.selectors[key];
    return Array.isArray(val) ? val.join(',') : val;
};
// ==========================================
// MAIN LOGIC
// ==========================================
const sendMessageToProfile = async (context, url, message) => {
    const page = await context.newPage();
    console.log(`\n📨 [SENDER] Начало обработки: ${url}`);
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeouts.pageLoad });
        await (0, browser_1.takeLiveScreenshot)(page);
        await (0, utils_1.wait)(2000);
        let accessButton = null;
        const directBtnSelector = getSelectorString('directMessageBtn');
        const directBtn = page.locator(directBtnSelector).first();
        try {
            await directBtn.waitFor({ state: 'visible', timeout: 5000 });
            if (await directBtn.isVisible()) {
                console.log('✅ Кнопка "Написать" (или аналог) найдена в профиле.');
                accessButton = directBtn;
            }
        }
        catch (e) { }
        if (!accessButton) {
            console.log('⚠️ Прямая кнопка не найдена. Проверяем "3 точки"...');
            const optionsBtn = page.locator(getSelectorString('optionsBtn')).first();
            if (await optionsBtn.isVisible()) {
                await optionsBtn.click();
                await (0, utils_1.wait)(1500);
                const menuMsgBtn = page.locator(getSelectorString('menuMessageBtn')).first();
                try {
                    await menuMsgBtn.waitFor({ state: 'visible', timeout: 3000 });
                    console.log('✅ Кнопка "Написать" найдена в меню.');
                    accessButton = menuMsgBtn;
                }
                catch (e) {
                    console.log('❌ В меню нет пункта отправки сообщения.');
                }
            }
        }
        if (!accessButton) {
            console.log(`⛔ [SKIP] Кнопки нет. Делаю скриншот...`);
            await page.screenshot({ path: path_1.join(__dirname, 'debug_error.png'), fullPage: true });
            return false;
        }
        await accessButton.click();
        await browser_1.takeLiveScreenshot(page);
        try {
            await Promise.race([
                page.waitForSelector(CONFIG.selectors.chatInput, { state: 'visible', timeout: 15000 }),
                page.waitForSelector(getSelectorString('notNowBtn'), { state: 'visible', timeout: 15000 })
            ]);
        }
        catch (e) {
            console.log('❌ Тайм-аут: чат не открылся.');
            return false;
        }
        const notNowBtn = page.locator(getSelectorString('notNowBtn')).first();
        if (await notNowBtn.isVisible()) {
            await notNowBtn.click();
            await (0, utils_1.wait)(1500);
        }
        const chatInput = page.locator(CONFIG.selectors.chatInput).first();
        if (!await chatInput.isVisible()) {
            console.log('❌ Поле ввода не найдено (ЛС закрыто).');
            return false;
        }
        console.log('🔍 Проверка истории переписки...');
        await (0, utils_1.wait)(2500);
        const allRows = await page.locator(getSelectorString('messageRow')).all();
        let realMessageCount = 0;
        for (const row of allRows) {
            const text = await row.innerText();
            if (text.includes('Смотреть профиль') ||
                text.includes('View profile') ||
                text.includes('View Profile') ||
                text.includes('Аккаунт в Instagram') ||
                text.trim() === '') {
                continue;
            }
            realMessageCount++;
        }
        if (realMessageCount > 0) {
            console.log(`⛔ [SKIP] Уже есть переписка (${realMessageCount} реальных сообщений). Закрываем.`);
            return false;
        }
        console.log('✅ История чиста (баннер проигнорирован). Отправляем сообщение.');
        await (0, utils_1.humanType)(page, CONFIG.selectors.chatInput, message, CONFIG.timeouts);
        await (0, utils_1.wait)(1000);
        await page.keyboard.press('Enter');
        await (0, browser_1.takeLiveScreenshot)(page);
        console.log(`🚀 [SENT] Сообщение отправлено: ${url}`);
        await (0, utils_1.wait)(3000);
        return true;
    }
    catch (error) {
        console.error(`💥 Ошибка: ${error.message}`);
        await (0, reporter_1.saveCrashReport)(page, error, 'sender');
        return false;
    }
    finally {
        await page.close();
    }
};
