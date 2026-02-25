const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { createBrowserContext, startLiveView, takeLiveScreenshot } = require('./lib/browser');
const { humanType, wait } = require('./lib/utils');
const { StateManager } = require('./lib/state');
const { getDB } = require('./lib/db');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { generateFingerprint } = require('./lib/fingerprint');
const { saveCrashReport } = require('./lib/reporter');

const logEmitter = new EventEmitter();
const LOGS_FILE = path.join(__dirname, 'logs.json');
let botProcesses = {
    index: null,
    parser: null
};

// Tracking sessions for log grouping
let currentSessionId = Date.now().toString();
function refreshSession() {
    currentSessionId = Date.now().toString();
}

// Load historical logs
let historicalLogs = [];
try {
    if (fs.existsSync(LOGS_FILE)) {
        historicalLogs = JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'));
    }
} catch (e) {
    originalLog('Error loading logs:', e);
}

function saveLogs() {
    try {
        fs.writeFileSync(LOGS_FILE, JSON.stringify(historicalLogs.slice(-1000)));
    } catch (e) {
        originalLog('Error saving logs:', e);
    }
}

let saveLogsTimer = null;
function debouncedSaveLogs() {
    if (saveLogsTimer) return;
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
    if (historicalLogs.length > 1000) historicalLogs.shift();
    debouncedSaveLogs();

    logEmitter.emit('log', logEntry);
}

// Save original console methods
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

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

const app = express();
const PORT = 1337;

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
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
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
    const db = await getDB();
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

    return {
        accounts,
        activeParserAccountIds: activeParserIds,
        activeServerAccountIds: activeServerIds,
        activeIndexAccountIds: activeIndexIds,
        activeProfilesAccountIds: activeProfilesIds,
        showBrowser,
        concurrentProfiles
    };
}

const { getProxy, getCookies, getList, getConfigPath, getSetting } = require('./lib/config');

app.use(express.json());

// --- Static frontend (production build from frontend/) ---
const publicDir = path.join(__dirname, 'public');
const legacyHtml = path.join(__dirname, 'index.html');
if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir));
} else {
    // --- Fallback to old single-file index.html during migration
    app.get('/', (req, res) => res.sendFile(legacyHtml));
}

// --- In-memory cache for profiles ---
let girlsCache = null;
let girlsCacheTime = 0;
const CACHE_TTL = 5000; // 5 seconds

async function getGirlsCached() {
    const now = Date.now();
    if (girlsCache && (now - girlsCacheTime) < CACHE_TTL) return girlsCache;
    try {
        const db = await getDB();
        let profiles = await db.all(`SELECT * FROM profiles ORDER BY timestamp DESC`);

        girlsCache = profiles;
        girlsCacheTime = now;
    } catch (e) {
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

app.get('/api/votes', async (req, res) => {
    const profiles = await getGirlsCached();
    const votes = {};
    profiles.forEach(p => {
        if (p.vote) votes[p.url] = p.vote;
    });
    res.json(votes);
});

app.post('/api/vote', async (req, res) => {
    const { url, status } = req.body;

    if (!url || !status) {
        return res.status(400).json({ success: false, error: 'Нет url или status' });
    }

    try {
        const db = await getDB();
        await db.run(`UPDATE profiles SET vote = ? WHERE url = ?`, [status, url]);

        invalidateGirlsCache();
        console.log(`[GOLOS] ${status} -> добавлен в профиль: ${url}`);
        res.json({ success: true });
    } catch (e) {
        console.log(`[GOLOS ERROR] Ошибка при голосовании: ${e.message}`);
        res.status(500).json({ success: false, error: 'Ошибка сервера при сохранении' });
    }
});

async function checkTelegramProfile(url) {
    const fetchUrl = url.startsWith('http') ? url : `https://t.me/${url}`;
    return new Promise((resolve, reject) => {
        const req = https.get(fetchUrl, {
            headers: { 'User-Agent': CONFIG.userAgent }
        }, (res) => {
            // Follow redirects manually if needed for t.me
            if ([301, 302].includes(res.statusCode) && res.headers.location) {
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
                } else {
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
    const { url } = req.query;
    if (!url) return res.status(400).json({ success: false, error: 'Missing url' });

    console.log(`[TG CHECK] Checking: ${url}`);

    try {
        const status = await checkTelegramProfile(url);
        console.log(`[TG CHECK] Result for ${url}: ${status}`);

        // Update DB
        const db = await getDB();
        await db.run(`UPDATE profiles SET tg_status = ? WHERE url = ? OR name = ?`, [status, url, url.replace('https://t.me/', '')]);

        invalidateGirlsCache();
        res.json({ success: true, status });
    } catch (e) {
        console.error(`[TG CHECK ERROR] ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/check-telegram-batch', async (req, res) => {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) return res.status(400).json({ success: false, error: 'Invalid urls' });

    console.log(`[TG BATCH CHECK] Starting for ${urls.length} profiles`);

    const results = [];
    const BATCH_SIZE = 10;
    const db = await getDB();

    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
        const batch = urls.slice(i, i + BATCH_SIZE);
        console.log(`[TG BATCH CHECK] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(urls.length / BATCH_SIZE)}`);

        const batchPromises = batch.map(async (url) => {
            try {
                const status = await checkTelegramProfile(url);
                await db.run(`UPDATE profiles SET tg_status = ? WHERE url = ? OR name = ?`, [status, url, url.replace('https://t.me/', '')]);
                return { url, status, success: true };
            } catch (e) {
                console.error(`[TG BATCH CHECK ERROR] Failed ${url}: ${e.message}`);
                return { url, success: false, error: e.message };
            }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Small delay between batches to avoid being too aggressive
        if (i + BATCH_SIZE < urls.length) {
            await wait(1000);
        }
    }

    invalidateGirlsCache();
    res.json({ success: true, results });
});

app.get('/api/settings', async (req, res) => {
    const settings = await getSettings();
    const names = await getList('names.txt');
    const cities = await getList('cityKeywords.txt');
    const niches = await getList('nicheKeywords.txt');
    const donors = await StateManager.loadDonors();
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
        concurrentProfiles: settings.concurrentProfiles
    });
});

app.post('/api/settings', async (req, res) => {
    const { accounts, names, cities, niches, donors, showBrowser } = req.body;

    try {
        const db = await getDB();

        await db.run('BEGIN TRANSACTION');
        try {
            if (req.body.hasOwnProperty('accounts')) {
                // Safeguard: don't delete all accounts if list is empty but we had accounts, 
                // unless it's a deliberate choice (e.g. forceEmpty flag)
                const existingAccounts = await db.all('SELECT id FROM accounts');
                if (existingAccounts.length > 0 && (!accounts || accounts.length === 0) && !req.body.forceEmpty) {
                    console.warn('Blocked attempt to clear accounts list without forceEmpty flag');
                } else {
                    const incomingIds = (accounts || []).map(a => a.id);
                    if (incomingIds.length > 0) {
                        const placeholders = incomingIds.map(() => '?').join(',');
                        await db.run(`DELETE FROM accounts WHERE id NOT IN (${placeholders})`, incomingIds);
                    } else {
                        await db.run(`DELETE FROM accounts`);
                    }
                    for (const a of (accounts || [])) {
                        const getPriority = (arr, id) => {
                            const idx = (arr || []).indexOf(id);
                            return idx === -1 ? 0 : idx + 1;
                        };

                        let fingerprint = a.fingerprint;
                        if (!fingerprint) {
                            fingerprint = JSON.stringify(generateFingerprint());
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
                if (!req.body.hasOwnProperty(type + 's')) return;
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
                const cleanDonors = (donors || []).map(d => d.trim()).filter(Boolean);

                // Safeguard: if incoming is empty but DB has many, block it unless forceEmpty
                const existingDonors = await StateManager.loadDonors();
                if (existingDonors.length > 5 && cleanDonors.length === 0 && !req.body.forceEmpty) {
                    console.warn('Blocked attempt to clear donors list without forceEmpty flag');
                } else {
                    await StateManager.saveDonors(cleanDonors);
                }
            }

            if (req.body.hasOwnProperty('showBrowser')) {
                await db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, ['showBrowser', showBrowser ? 'true' : 'false']);
            }

            if (req.body.hasOwnProperty('concurrentProfiles')) {
                await db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, ['concurrentProfiles', req.body.concurrentProfiles.toString()]);
            }

            await db.run('COMMIT');
        } catch (txErr) {
            await db.run('ROLLBACK');
            throw txErr;
        }

        res.json({ success: true });
    } catch (e) {
        console.error('Ошибка сохранения настроек:', e);
        res.status(500).json({ success: false });
    }
});

app.put('/api/accounts/:id', async (req, res) => {
    const { id } = req.params;
    const { name, proxy, cookies, regenerateFingerprint } = req.body;

    try {
        const db = await getDB();
        const existing = await db.get('SELECT id FROM accounts WHERE id = ?', [id]);
        if (!existing) {
            return res.status(404).json({ success: false, error: 'Account not found' });
        }

        const updates = [];
        const values = [];
        if (name !== undefined) { updates.push('name = ?'); values.push(name); }
        if (proxy !== undefined) { updates.push('proxy = ?'); values.push(proxy); }
        if (cookies !== undefined) { updates.push('cookies = ?'); values.push(cookies); }
        if (regenerateFingerprint) {
            updates.push('fingerprint = ?');
            values.push(JSON.stringify(generateFingerprint()));
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        values.push(id);
        await db.run(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`, values);

        res.json({ success: true });
    } catch (e) {
        console.error('Ошибка обновления аккаунта:', e);
        res.status(500).json({ success: false });
    }
});

// --- Proxy image endpoint: fetches images through configured account proxy ---
app.get('/api/proxy-image', async (req, res) => {
    const imageUrl = req.query.url;
    if (!imageUrl) return res.status(400).send('Missing url parameter');

    try {
        const proxy = await getProxy('profiles');
        const parsedUrl = new URL(imageUrl);
        const transport = parsedUrl.protocol === 'https:' ? https : http;

        const fetchOptions = {
            hostname: parsedUrl.hostname,
            path: parsedUrl.pathname + parsedUrl.search,
            headers: {
                'User-Agent': CONFIG.userAgent,
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
                'Referer': 'https://www.instagram.com/'
            }
        };

        // If proxy is configured, route through it via HTTP CONNECT
        if (proxy) {
            const proxyUrl = new URL(proxy.server);
            const authHeader = 'Basic ' + Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');

            // For HTTPS targets, use HTTP CONNECT tunnel
            if (parsedUrl.protocol === 'https:') {
                const connectReq = http.request({
                    host: proxyUrl.hostname,
                    port: proxyUrl.port || 80,
                    method: 'CONNECT',
                    path: `${parsedUrl.hostname}:443`,
                    headers: { 'Proxy-Authorization': authHeader }
                });

                connectReq.on('connect', (_res, socket) => {
                    if (_res.statusCode !== 200) {
                        return res.status(502).send('Proxy CONNECT failed');
                    }
                    const tlsReq = https.request({
                        ...fetchOptions,
                        socket: socket,
                        agent: false
                    }, handleImageResponse);
                    tlsReq.on('error', () => res.status(502).send('Image fetch error'));
                    tlsReq.end();
                });
                connectReq.on('error', () => res.status(502).send('Proxy connect error'));
                connectReq.end();
            } else {
                // HTTP target through proxy
                const proxyReq = http.request({
                    hostname: proxyUrl.hostname,
                    port: proxyUrl.port || 80,
                    path: imageUrl,
                    headers: {
                        ...fetchOptions.headers,
                        'Proxy-Authorization': authHeader,
                        'Host': parsedUrl.hostname
                    }
                }, handleImageResponse);
                proxyReq.on('error', () => res.status(502).send('Proxy request error'));
                proxyReq.end();
            }
        } else {
            // No proxy — direct fetch
            const directReq = transport.request(fetchOptions, handleImageResponse);
            directReq.on('error', () => res.status(502).send('Direct fetch error'));
            directReq.end();
        }

        function handleImageResponse(imgRes) {
            // Follow redirects (Instagram CDN does 301/302)
            if ([301, 302, 307, 308].includes(imgRes.statusCode) && imgRes.headers.location) {
                // Redirect — fetch again without proxy (CDN URLs are public)
                const redirectTransport = imgRes.headers.location.startsWith('https') ? https : http;
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
    } catch (e) {
        res.status(500).send('Proxy image error');
    }
});

app.get('/api/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

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
    const liveViewPath = path.join(__dirname, '..', 'data', 'screenshots', 'live_view.jpg');
    res.sendFile(liveViewPath, { headers: { 'Cache-Control': 'no-store' } }, err => {
        if (err) res.status(404).send('Not generated yet');
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
    const scriptPath = path.join(__dirname, `${type}.js`);

    // Используем process.execPath вместо 'node' для надежности на Windows
    // и устанавливаем shell: true если необходимо (хотя для прямой ноды не обязательно)
    const child = spawn(process.execPath, [scriptPath], {
        cwd: __dirname,
        env: { ...process.env, FORCE_COLOR: '1' }
    });

    botProcesses[type] = child;

    // Обработка ошибки запуска самого процесса (например, если файл не найден или нет прав)
    child.on('error', (err) => {
        broadcastLog(`${type}-error`, `Failed to start process: ${err.message}`);
        botProcesses[type] = null;
    });

    child.stdout.on('data', (data) => broadcastLog(type, data));
    child.stderr.on('data', (data) => broadcastLog(`${type}-error`, data));

    child.on('close', (code) => {
        broadcastLog('system', `${type} bot exited with code ${code}`);
        botProcesses[type] = null;
    });

    res.json({ success: true });
});

app.post('/api/bot/stop', (req, res) => {
    const { type } = req.body;
    if (botProcesses[type]) {
        botProcesses[type].kill();
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Bot not running' });
    }
});

app.post('/api/bot/skip-donor', (req, res) => {
    try {
        console.log('📢 [API] Получен запрос на пропуск текущего донора...');
        fs.writeFileSync(path.join(__dirname, 'skip_donor.flag'), 'skip');
        res.json({ success: true, message: 'Сигнал пропуска донора отправлен' });
    } catch (e) {
        console.error('❌ [API] Ошибка при создании skip_donor.flag:', e);
        res.json({ success: false, error: 'Ошибка при отправке сигнала' });
    }
});

app.post('/api/dm', async (req, res) => {
    const { url, message } = req.body;
    console.log({ url, message })

    let currentContext = null;
    try {
        const accountsData = await getAllAccounts('server');
        const firstAccount = accountsData[0] || {};
        reqConfig.proxy = firstAccount.proxy;
        reqConfig.cookies = firstAccount.cookies;
        reqConfig.fingerprint = firstAccount.fingerprint;

        const showBrowser = await getSetting('showBrowser');

        refreshSession();
        const { browser, context } = await createBrowserContext(reqConfig, !(showBrowser === 'true' || showBrowser === true));
        console.log(`📡 [SENDER] Используется прокси: ${reqConfig.proxy ? reqConfig.proxy.server : 'ПРЯМОЕ СОЕДИНЕНИЕ'}`);
        console.log(`🍪 [SENDER] Загружено куки: ${reqConfig.cookies.length}`);
        currentContext = context;

        const liveViewInterval = startLiveView(context);
        const isSent = await sendMessageToProfile(context, url, message);
        clearInterval(liveViewInterval);

        if (isSent) {
            res.json({ success: true, message: 'Отправлено' });
        } else {
            res.json({ success: false, message: 'Не отправлено' });
        }

    } catch (e) {
        console.error('Ошибка запуска:', e);
        res.status(500).json({ success: false });
    } finally {
        if (currentContext) await currentContext.close();
        // Do NOT close browser, so we reuse the global instance
    }
});

// Stat endpoint removed

app.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});

// SPA catch-all (must be after all API routes)
if (fs.existsSync(publicDir)) {
    app.get('{*path}', (req, res) => {
        res.sendFile(path.join(publicDir, 'index.html'));
    });
}

const getSelectorString = (key) => {
    const val = CONFIG.selectors[key];
    return Array.isArray(val) ? val.join(',') : val;
}

// ==========================================
// MAIN LOGIC
// ==========================================

const sendMessageToProfile = async (context, url, message) => {
    const page = await context.newPage();
    console.log(`\n📨 [SENDER] Начало обработки: ${url}`);

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeouts.pageLoad });
        await takeLiveScreenshot(page);
        await wait(2000);

        let accessButton = null;
        const directBtnSelector = getSelectorString('directMessageBtn');
        const directBtn = page.locator(directBtnSelector).first();

        try {
            await directBtn.waitFor({ state: 'visible', timeout: 5000 });
            if (await directBtn.isVisible()) {
                console.log('✅ Кнопка "Написать" (или аналог) найдена в профиле.');
                accessButton = directBtn;
            }
        } catch (e) { }

        if (!accessButton) {
            console.log('⚠️ Прямая кнопка не найдена. Проверяем "3 точки"...');
            const optionsBtn = page.locator(getSelectorString('optionsBtn')).first();

            if (await optionsBtn.isVisible()) {
                await optionsBtn.click();
                await wait(1500);
                const menuMsgBtn = page.locator(getSelectorString('menuMessageBtn')).first();
                try {
                    await menuMsgBtn.waitFor({ state: 'visible', timeout: 3000 });
                    console.log('✅ Кнопка "Написать" найдена в меню.');
                    accessButton = menuMsgBtn;
                } catch (e) {
                    console.log('❌ В меню нет пункта отправки сообщения.');
                }
            }
        }

        if (!accessButton) {
            console.log(`⛔ [SKIP] Кнопки нет. Делаю скриншот...`);
            await page.screenshot({ path: path.join(__dirname, 'debug_error.png'), fullPage: true });
            return false;
        }

        await accessButton.click();
        await takeLiveScreenshot(page);

        try {
            await Promise.race([
                page.waitForSelector(CONFIG.selectors.chatInput, { state: 'visible', timeout: 15000 }),
                page.waitForSelector(getSelectorString('notNowBtn'), { state: 'visible', timeout: 15000 })
            ]);
        } catch (e) {
            console.log('❌ Тайм-аут: чат не открылся.');
            return false;
        }

        const notNowBtn = page.locator(getSelectorString('notNowBtn')).first();
        if (await notNowBtn.isVisible()) {
            await notNowBtn.click();
            await wait(1500);
        }

        const chatInput = page.locator(CONFIG.selectors.chatInput).first();
        if (!await chatInput.isVisible()) {
            console.log('❌ Поле ввода не найдено (ЛС закрыто).');
            return false;
        }

        console.log('🔍 Проверка истории переписки...');
        await wait(2500);

        const allRows = await page.locator(getSelectorString('messageRow')).all();
        let realMessageCount = 0;

        for (const row of allRows) {
            const text = await row.innerText();
            if (
                text.includes('Смотреть профиль') ||
                text.includes('View profile') ||
                text.includes('View Profile') ||
                text.includes('Аккаунт в Instagram') ||
                text.trim() === ''
            ) {
                continue;
            }
            realMessageCount++;
        }

        if (realMessageCount > 0) {
            console.log(`⛔ [SKIP] Уже есть переписка (${realMessageCount} реальных сообщений). Закрываем.`);
            return false;
        }

        console.log('✅ История чиста (баннер проигнорирован). Отправляем сообщение.');

        await humanType(page, CONFIG.selectors.chatInput, message, CONFIG.timeouts);
        await wait(1000);
        await page.keyboard.press('Enter');
        await takeLiveScreenshot(page);
        console.log(`🚀 [SENT] Сообщение отправлено: ${url}`);

        await wait(3000);
        return true;

    } catch (error) {
        console.error(`💥 Ошибка: ${error.message}`);
        await saveCrashReport(page, error, 'sender');
        return false;
    } finally {
        await page.close();
    }
};