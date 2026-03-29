const { chromium } = require('playwright');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const utils = require('../backend/lib/utils');

const SELECTORS = {
    SEARCH_INPUT: 'div[role="dialog"] input',
    FOLLOWERS_LINK: '#mount_0_0_TP > div > div > div.x9f619.x1n2onr6.x1ja2u2z > div > div > div.x78zum5.xdt5ytf.x1t2pt76.x1n2onr6.x1ja2u2z.x10cihs4 > div.html-div.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x9f619.x16ye13r.xvbhtw8.x78zum5.x15mokao.x1ga7v0g.x16uus16.xbiv7yw.x1uhb9sk.x1plvlek.xryxfnj.x1c4vz4f.x2lah0s.x1q0g3np.xqjyukv.x1qjc9v5.x1oa3qoh.x1qughib > div.x10o80wk.x14k21rp.xh8yej3 > section > main > div > div > header > div > section.x98rzlu.xeuugli > div.x7a106z.x972fbf.x10w94by.x1qhh985.x14e42zd.x9f619.x78zum5.xdt5ytf.x1yztbdb.xw7yly9.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x1n2onr6.x1r0jzty.x11njtxf.x1fkh5qu.x1ddbhtg.x1dlrdel > div.html-div.xdj266r.x14z9mp.xat24cr.x1lziwak.xexx8yu.xyri2b.x18d9i69.x1c1uobl.x9f619.xjbqb8w.x40hh3e.x78zum5.x15mokao.x1ga7v0g.x16uus16.xbiv7yw.x1uhb9sk.x1plvlek.xryxfnj.x1c4vz4f.x2lah0s.x1q0g3np.xqjyukv.x6s0dn4.x1oa3qoh.x1nhvcw1 > div:nth-child(2) > a > span',
    FOLLOWERS_LINK_FALLBACK: 'a[href$="/followers/"]',
};

const logger = { info: console.log, debug: console.log, warn: console.warn };

const JWT_SECRET = 'dev_secret_only_for_local_testing';
const ENCRYPTION_KEY = crypto.createHash('sha256').update(JWT_SECRET).digest();

function decrypt(text) {
    if (!text || !text.includes(':')) return text;
    const parts = text.split(':');
    const ivHex = parts[0];
    try {
        const iv = Buffer.from(ivHex, 'hex');
        const encryptedText = Buffer.from(parts.slice(1).join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) { return text; }
}

async function scrollAndCollectUrls(page, config) {
    const collectedUrls = new Set();
    let hasMore = true;
    let lastResponseTime = Date.now();
    let currentFollowerCount = 0;
    let resolveResponse;

    logger.info(`🔽 Начинаем сбор списка (Signal Mode)...`);

    const onResponse = async (response) => {
        const url = response.url();
        if (url.includes('/api/v1/friendships/') && url.includes('/followers')) {
            try {
                const text = await response.text();
                const json = JSON.parse(text);
                if (json.users && Array.isArray(json.users)) {
                    json.users.forEach(u => {
                        if (u.username) collectedUrls.add(`https://www.instagram.com/${u.username}/`);
                    });
                    hasMore = json.has_more === true;
                    lastResponseTime = Date.now();
                    if (collectedUrls.size > currentFollowerCount) {
                        currentFollowerCount = collectedUrls.size;
                        logger.info(`📥 Получено ${json.users.length} профилей. Всего: ${collectedUrls.size} | Далее: ${hasMore}`);
                        if (resolveResponse) resolveResponse();
                    }
                }
            } catch (e) { }
        }
    };

    page.on('response', onResponse);

    try {
        const modal = page.locator('div[role="dialog"]').first();
        const modalBox = await modal.boundingBox().catch(() => null);
        if (modalBox) {
            await utils.humanMouseMove(page, modalBox.x + modalBox.width / 2, modalBox.y + modalBox.height / 2);
        }

        for (let i = 0; i < config.scroll.maxAttempts; i++) {
            await utils.humanScroll(page, null, 'down', 800 + Math.random() * 400);

            await Promise.race([
                new Promise(resolve => { resolveResponse = resolve; }),
                utils.wait(2000)
            ]);

            resolveResponse = null;

            if (!hasMore) {
                logger.info(`🛑 Достигнут конец списка.`);
                break;
            }
        }
    } finally {
        page.off('response', onResponse);
    }
    return Array.from(collectedUrls);
}

async function main() {
    let rawData = fs.readFileSync('c:\\Users\\root\\Documents\\Projects\\ig\\ig-bot\\tmp\\osnova_cookies_utf8.json', 'utf8');
    if (rawData.charCodeAt(0) === 0xFEFF) rawData = rawData.slice(1);
    const accountData = JSON.parse(rawData);
    const decryptedCookies = JSON.parse(decrypt(accountData.cookies));

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    await context.addCookies(decryptedCookies);
    const page = await context.newPage();

    try {
        await page.goto('https://www.instagram.com/kseniyaa.alfyorovaa/');

        let followersBtn = page.locator(SELECTORS.FOLLOWERS_LINK);
        await followersBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
        if (!(await followersBtn.isVisible())) {
            followersBtn = page.locator(SELECTORS.FOLLOWERS_LINK_FALLBACK);
            await followersBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
        }

        await followersBtn.click();
        await page.waitForSelector('div[role="dialog"]');

        const searchInput = page.locator(SELECTORS.SEARCH_INPUT).first();
        await searchInput.fill('спб');
        await utils.wait(2000);

        const config = { scroll: { maxAttempts: 15 } };
        const results = await scrollAndCollectUrls(page, config);
        console.log('VERIFICATION FINISHED. Profile count:', results.length);

    } catch (e) { console.error(e); } finally { await browser.close(); }
}

main().catch(console.error);
