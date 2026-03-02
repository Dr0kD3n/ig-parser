const { createBrowserContext } = require('./browser');
const { getDB } = require('./db');
const { wait, humanClick, humanMouseLeave, humanOverscroll, humanSelection } = require('./utils');
const http = require('http');

const GLOBAL_SITES = [
    'https://www.google.com', 'https://www.youtube.com', 'https://www.facebook.com',
    'https://www.wikipedia.org', 'https://www.amazon.com', 'https://www.reddit.com',
    'https://www.twitter.com', 'https://www.instagram.com', 'https://www.linkedin.com',
    'https://www.netflix.com', 'https://www.bing.com', 'https://www.yahoo.com'
];

const REGIONAL_SITES = {
    'RU': [
        'https://www.yandex.ru', 'https://www.vk.com', 'https://www.ok.ru',
        'https://www.mail.ru', 'https://www.avito.ru', 'https://www.wildberries.ru',
        'https://www.ozon.ru', 'https://www.rbc.ru', 'https://www.lenta.ru',
        'https://www.rambler.ru', 'https://www.dns-shop.ru', 'https://www.mvideo.ru',
        'https://www.gosuslugi.ru', 'https://www.hh.ru', 'https://www.kinopoisk.ru'
    ],
    'FR': [
        'https://www.lemonde.fr', 'https://www.orange.fr', 'https://www.leboncoin.fr',
        'https://www.allocine.fr', 'https://www.fnac.com', 'https://www.cdiscount.com',
        'https://www.lequipe.fr', 'https://www.caf.fr', 'https://www.ameli.fr',
        'https://www.doctissimo.fr', 'https://www.lefigaro.fr', 'https://www.darty.com'
    ],
    'DE': [
        'https://www.spiegel.de', 'https://www.bild.de', 'https://www.web.de',
        'https://www.ebay.de', 'https://www.mobile.de', 'https://www.t-online.de',
        'https://www.focus.de', 'https://www.chip.de', 'https://www.welt.de',
        'https://www.dhl.de', 'https://www.otto.de', 'https://www.adac.de'
    ],
    'ES': [
        'https://www.elmundo.es', 'https://www.elpais.com', 'https://www.marca.com',
        'https://www.as.com', 'https://www.wallapop.com', 'https://www.milanuncios.com',
        'https://www.rtve.es', 'https://www.abc.es', 'https://www.idealista.com',
        'https://www.pccomponentes.com', 'https://www.elcorteingles.es'
    ],
    'US': [
        'https://www.cnn.com', 'https://www.nytimes.com', 'https://www.walmart.com',
        'https://www.target.com', 'https://www.homedepot.com', 'https://www.craigslist.org',
        'https://www.bestbuy.com', 'https://www.zillow.com', 'https://www.foxnews.com',
        'https://www.ebay.com', 'https://www.etsy.com', 'https://www.chase.com'
    ]
};

async function getRegionFromProxy(proxy) {
    if (!proxy || !proxy.server) return 'GLOBAL';

    console.log(`🌍 [WARMUP] Detecting region for proxy: ${proxy.server}`);

    return new Promise((resolve) => {
        const url = new URL(proxy.server);
        const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');

        const options = {
            host: url.hostname,
            port: url.port || 80,
            path: 'http://ip-api.com/json',
            headers: {
                'Host': 'ip-api.com',
                'Proxy-Authorization': `Basic ${auth}`
            }
        };

        const req = http.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    console.log(`🌍 [WARMUP] Proxy region detected: ${json.countryCode} (${json.country})`);
                    resolve(json.countryCode);
                } catch (e) {
                    resolve('GLOBAL');
                }
            });
        });

        req.on('error', () => resolve('GLOBAL'));
        req.setTimeout(5000, () => { req.destroy(); resolve('GLOBAL'); });
    });
}

async function startWarmup(accountId, progressCallback = (p) => { }) {
    console.log(`🔥 [WARMUP] Starting for account: ${accountId}`);

    const db = await getDB();
    const acc = await db.get('SELECT * FROM accounts WHERE id = ?', [accountId]);
    if (!acc) throw new Error('Account not found');

    let proxy = null;
    if (acc.proxy) {
        const parts = acc.proxy.trim().split(':');
        if (parts.length >= 4) {
            proxy = {
                server: `http://${parts[0]}:${parts[1]}`,
                username: parts[2],
                password: parts[3]
            };
        }
    }

    const config = {
        id: accountId,
        proxy: proxy,
        fingerprint: acc.fingerprint ? JSON.parse(acc.fingerprint) : null
    };

    const countryCode = await getRegionFromProxy(proxy);
    const regionalSites = REGIONAL_SITES[countryCode] || [];

    const showBrowserRow = await db.get(`SELECT value FROM settings WHERE key = 'showBrowser'`);
    const showBrowser = showBrowserRow ? showBrowserRow.value === 'true' : false;
    const headless = !showBrowser;

    let sitePool = [...GLOBAL_SITES];
    if (regionalSites.length > 0) {
        sitePool = [...sitePool, ...regionalSites, ...regionalSites];
    }

    const sitesToVisit = sitePool.sort(() => Math.random() - 0.5).slice(0, 50);

    const { browser, context } = await createBrowserContext({
        ...config,
        countryCode,
        fingerprint: {
            ...(config.fingerprint || {}),
            locale: 'en-US',
            extraHTTPHeaders: {
                ...(config.fingerprint?.extraHTTPHeaders || {}),
                'Accept-Language': 'en-US,en;q=0.9'
            }
        }
    }, headless);

    try {
        const CONCURRENCY_LIMIT = 5;
        let completed = 0;

        // Helper to process tasks in parallel with limit
        const processPool = async (sites) => {
            const results = [];
            const executing = [];

            for (const site of sites) {
                const p = (async (currentSite) => {
                    const page = await context.newPage();
                    try {
                        console.log(`🔥 [WARMUP] Visiting [${countryCode}]: ${currentSite}`);
                        await page.goto(currentSite, { waitUntil: 'domcontentloaded', timeout: 30000 });

                        // Accept cookies logic
                        try {
                            const cookieButtons = [
                                'Accept', 'Allow', 'Agree', 'I accept', 'Accept all', 'Allow all',
                                'Принять', 'Согласен', 'Разрешить', 'Принять все', 'ОК', 'OK'
                            ];
                            const selectors = [
                                'button', 'a', '[role="button"]'
                            ];

                            for (const text of cookieButtons) {
                                for (const selector of selectors) {
                                    const handle = await page.$(`${selector}:has-text("${text}")`);
                                    if (handle && await handle.isVisible()) {
                                        await humanClick(page, handle, { timeout: 2000 }).catch(() => { });
                                        console.log(`🍪 [WARMUP] Clicked cookie button: "${text}" on ${currentSite}`);
                                        break;
                                    }
                                }
                            }
                        } catch (e) { }

                        await wait(Math.random() * 3000 + 3000);

                        // New hardcore humanization injection
                        if (Math.random() > 0.3) {
                            if (Math.random() > 0.5) {
                                await humanOverscroll(page, 'down', Math.random() * 800 + 400);
                            } else {
                                await page.mouse.wheel(0, Math.random() * 800 + 400);
                            }
                            await wait(Math.random() * 2000);
                        }

                        if (Math.random() > 0.6) {
                            await humanSelection(page);
                        }

                        if (Math.random() > 0.7) {
                            await humanMouseLeave(page);
                        }

                        // Deep page navigation
                        try {
                            if (Math.random() > 0.4) {
                                const links = await page.$$('a');
                                const validLinks = [];
                                for (const link of links) {
                                    const href = await link.getAttribute('href');
                                    if (href && (href.startsWith('/') || href.includes(new URL(currentSite).hostname))) {
                                        try {
                                            const isVisible = await link.isVisible();
                                            if (isVisible) validLinks.push(link);
                                        } catch (e) { }
                                    }
                                }
                                if (validLinks.length > 0) {
                                    const randomLink = validLinks[Math.floor(Math.random() * validLinks.length)];
                                    console.log(`🔗 [WARMUP] Navigating deeper into ${currentSite}`);
                                    await humanClick(page, randomLink, { timeout: 3000 }).catch(() => { });
                                    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => { });
                                    await wait(Math.random() * 4000 + 3000);
                                    if (Math.random() > 0.3) {
                                        await page.mouse.wheel(0, Math.random() * 600 + 300);
                                        await wait(Math.random() * 2000);
                                    }
                                }
                            }
                        } catch (innerError) {
                            // Ignored
                        }
                    } catch (e) {
                        console.warn(`⚠️ [WARMUP] Failed site ${currentSite}: ${e.message}`);
                    } finally {
                        await page.close();
                        completed++;
                        progressCallback({ current: completed, total: sitesToVisit.length, site: currentSite });
                    }
                })(site);

                results.push(p);

                if (CONCURRENCY_LIMIT <= sites.length) {
                    const e = p.then(() => executing.splice(executing.indexOf(e), 1));
                    executing.push(e);
                    if (executing.length >= CONCURRENCY_LIMIT) {
                        await Promise.race(executing);
                    }
                }
            }
            return Promise.all(results);
        };

        await processPool(sitesToVisit);

        const cookies = await context.cookies();
        // Since we closed all pages, we might need one more page to get localStorage if needed, 
        // but context.cookies() should be enough for "warming up" identity.
        // Actually, let's keep one page open at the end to be safe for any final data collection.
        const lastPage = await context.newPage();
        let localStorage = '{}';
        try {
            await lastPage.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 20000 });
            localStorage = await lastPage.evaluate(() => {
                const data = {};
                for (let i = 0; i < window.localStorage.length; i++) {
                    const key = window.localStorage.key(i);
                    data[key] = window.localStorage.getItem(key);
                }
                return JSON.stringify(data);
            });
        } catch (e) {
            console.warn(`⚠️ [WARMUP] Could not collect localStorage: ${e.message}`);
        }

        const warmupScore = Math.round((completed / sitesToVisit.length) * 100);
        const lastWarmup = new Date().toISOString();

        await db.run('UPDATE accounts SET cookies = ?, local_storage = ?, warmup_score = ?, last_warmup = ? WHERE id = ?', [
            JSON.stringify(cookies),
            localStorage,
            warmupScore,
            lastWarmup,
            accountId
        ]);

        console.log(`✅ [WARMUP] Completed for ${accountId} (${countryCode})`);
        return { success: true };
    } catch (error) {
        console.error(`❌ [WARMUP] Error: ${error.message}`);
        return { success: false, error: error.message };
    } finally {
        await context.close();
        await browser.close();
    }
}

exports.startWarmup = startWarmup;
