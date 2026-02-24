const fs = require('fs');
const path = require('path');
const { createBrowserContext } = require('./backend/lib/browser');
const { getDB } = require('./backend/lib/db');
const { getSetting } = require('./backend/lib/config');
const { wait } = require('./backend/lib/utils');
const { saveCrashReport } = require('./backend/lib/reporter');
const { updateChatStats } = require('./backend/lib/stats');

const SELECTORS = {
    dialogRow: 'div.xb57i2i.x1q594ok.x5lxg6s.x78zum5.xdt5ytf.x6ikm8r.x1ja2u2z.x1pq812k.x1rohswg.xfk6m8.x1yqm8si.xjx87ck.xx8ngbg.xwo3gff.x1n2onr6.x1oyok0e.x1odjw0f.x1e4zzel.x1xzczws > div.x78zum5.xdt5ytf.x1iyjqo2.x1n2onr6 > div > div > div',
    dialogList: 'div[aria-label="Chats"], div[aria-label="Чаты"], div[role="tabpanel"]',
    messageRow: 'div[role="row"]',
    messageText: 'div[dir="auto"]',
    tabGeneral: 'div[role="tab"]:has-text("Общие"), div[role="tab"]:has-text("General"), span:has-text("General"), span:has-text("Общие")',
    tabPrimary: 'div[role="tab"]:has-text("Основное"), div[role="tab"]:has-text("Primary"), span:has-text("Primary"), span:has-text("Основное")',
    notNowBtn: 'button:has-text("Не сейчас"), button:has-text("Not Now"), button:has-text("Cancel")'
};

function parseProxy(proxyStr) {
    if (!proxyStr) return null;
    const parts = proxyStr.trim().split(':');
    if (parts.length < 4) return null;
    return { server: `http://${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] };
}

function parseCookies(raw) {
    if (!raw) return [];
    const names = ['csrftoken', 'datr', 'ds_user_id', 'ig_did', 'mid', 'sessionid', 'rur', 'wd', 'ig_nrcb', 'dpr', 'ps_l', 'ps_n'];
    const cookies = [];
    if (raw.trim().startsWith('[') || raw.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.filter(c => names.includes(c.name));
        } catch (e) { }
    }
    raw.split('\n').forEach(line => {
        const parts = line.split('\t');
        if (parts.length >= 2 && names.includes(parts[0].trim())) {
            cookies.push({ name: parts[0].trim(), value: parts[1].trim(), domain: '.instagram.com', path: '/', secure: true, sameSite: 'None' });
        }
    });
    return cookies;
}

async function checkAUInBox() {
    console.log('🚀 [AU_CHECKER] Starting Instagram Inbox Check for "AU" profile...');
    const db = await getDB();
    const account = await db.get('SELECT * FROM accounts WHERE name = ?', ['AU']);

    if (!account) {
        console.error('❌ [AU_CHECKER] Account "AU" not found in database.');
        process.exit(1);
    }

    const showBrowser = await getSetting('showBrowser');
    const headless = !(showBrowser === 'true' || showBrowser === true);

    const config = {
        proxy: account.proxy ? parseProxy(account.proxy) : null,
        cookies: parseCookies(account.cookies),
        fingerprint: account.fingerprint ? JSON.parse(account.fingerprint) : null
    };

    console.log(`📡 [AU_CHECKER] Using Proxy: ${config.proxy ? config.proxy.server : 'None'}`);
    console.log(`🍪 [AU_CHECKER] Loaded Cookies: ${config.cookies.length}`);

    const { browser, context } = await createBrowserContext(config, headless);
    const page = await context.newPage();

    try {
        await page.setViewportSize({ width: 1280, height: 900 });

        console.log('🌐 [AU_CHECKER] Navigating to Instagram...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await wait(7000);
        await page.screenshot({ path: 'au_checker_home.jpg' });

        // Вход в профиль если нужно (based on inbox_exporter.js)
        const targetProfile = "augustus.himself";
        const profileBtn = page.locator(`div[role="button"]:has-text("${targetProfile}")`).first();
        if (await profileBtn.isVisible({ timeout: 5000 })) {
            console.log(`👆 [AU_CHECKER] Clicking profile: ${targetProfile}`);
            await profileBtn.click();
            await wait(10000);
        }

        console.log('🌐 [AU_CHECKER] Navigating to Instagram Inbox...');
        try {
            await page.goto('https://www.instagram.com/direct/inbox/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (e) {
            console.log('⚠️ [AU_CHECKER] Direct navigation failed, trying via main page...');
            await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' }).catch(() => { });
            await wait(5000);
            const directBtn = page.locator('a[href="/direct/inbox/"], svg[aria-label="Direct"]').first();
            if (await directBtn.isVisible()) {
                await directBtn.click();
            } else {
                throw new Error('Could not find Direct button');
            }
        }
        await wait(10000);
        await page.screenshot({ path: 'au_checker_inbox.jpg' });

        // Handle modals
        try {
            const notNow = page.locator(SELECTORS.notNowBtn).first();
            if (await notNow.isVisible({ timeout: 5000 })) await notNow.click();
        } catch (e) { }

        const results = [];

        // Primary Tab
        console.log('📬 [AU_CHECKER] Processing "Primary" tab...');
        await processTab(page, 'Primary', results);

        // General Tab
        const generalTab = page.locator(SELECTORS.tabGeneral).first();
        if (await generalTab.isVisible()) {
            console.log('📬 [AU_CHECKER] Switching to "General" tab...');
            await generalTab.click();
            await wait(5000);
            await processTab(page, 'General', results);
        }

        if (results.length > 0) {
            saveToCSV(results);
            console.log(`✅ [AU_CHECKER] Successfully processed ${results.length} chats.`);
        } else {
            console.log('⚠️ [AU_CHECKER] No chats found.');
        }

    } catch (error) {
        console.error('💥 [AU_CHECKER] Error:', error.message);
        await saveCrashReport(page, error, 'au_checker');
    } finally {
        await browser.close();
        process.exit(0);
    }
}

async function processTab(page, tabName, results) {
    let processedUrls = new Set();

    try {
        await page.waitForSelector(SELECTORS.dialogRow, { timeout: 15000 });
    } catch (e) {
        console.log(`⚠️ Tab ${tabName} seems empty or failed to load dialogs.`);
        return;
    }

    // Capture initial dialogs
    let dialogElements = await page.locator(SELECTORS.dialogRow).all();
    console.log(`🔍 [${tabName}] Found ${dialogElements.length} rows initially.`);

    for (let i = 0; i < dialogElements.length; i++) {
        try {
            // Re-fetch to avoid stale handle issues
            dialogElements = await page.locator(SELECTORS.dialogRow).all();
            if (i >= dialogElements.length) break;

            const row = dialogElements[i];
            const linkLoc = row.locator('a[href^="/direct/t/"]').first();
            const href = await linkLoc.getAttribute('href').catch(() => null);

            if (!href || processedUrls.has(href)) continue;
            processedUrls.add(href);

            const nameNode = row.locator('span[dir="auto"]').first();
            const displayName = (await nameNode.innerText().catch(() => 'Unknown')).trim();

            console.log(`   👉 Chat ${i + 1}: ${displayName} (${href})`);
            await linkLoc.click();
            await wait(3000);

            // Scroll up to load history
            console.log('      ⬆️ Internal scrolling up for history...');
            const scrollContainer = page.locator('div[role="presentation"] > div > div[role="presentation"]').last();
            let lastHeight = 0;
            for (let s = 0; s < 10; s++) {
                await scrollContainer.evaluate(node => node.scrollTop = 0);
                await wait(1500);
                const newHeight = await scrollContainer.evaluate(node => node.scrollHeight);
                if (newHeight === lastHeight) break;
                lastHeight = newHeight;
            }

            // Extract messages
            const messages = await page.locator(SELECTORS.messageRow).all();
            const seq = [];

            // Determine chat center for side detection (own vs partner)
            const chatBox = await scrollContainer.boundingBox();
            const chatCenter = chatBox ? chatBox.x + (chatBox.width / 2) : 640;

            for (const msg of messages) {
                const textNode = msg.locator(SELECTORS.messageText).first();
                if (await textNode.isVisible()) {
                    const text = (await textNode.innerText()).trim();
                    if (!text) continue;

                    const box = await textNode.boundingBox();
                    if (!box) continue;

                    const isOwn = (box.x + box.width / 2) > chatCenter;
                    seq.push({ text, isOwn });
                }
            }

            if (seq.length > 0) {
                const firstMsg = seq[0];
                const partnerReplied = seq.slice(1).some(m => !m.isOwn);

                results.push({
                    Tab: tabName,
                    Chat: displayName,
                    URL: href,
                    FirstMessage: firstMsg.text.replace(/\n/g, ' '),
                    FirstSender: firstMsg.isOwn ? 'Me' : 'Partner',
                    HasReply: partnerReplied ? 'Yes' : 'No',
                    Count: seq.length,
                    Is5Plus: seq.length >= 5 ? 'Yes' : 'No'
                });

                console.log(`      📝 Found ${seq.length} messages. First: "${firstMsg.text.substring(0, 20)}...". Reply: ${partnerReplied}`);

                // Update database immediately
                await updateChatStats(href, firstMsg.isOwn ? firstMsg.text : null, seq);
            } else {
                console.log('      ⚠️ No text messages found in this chat.');
            }

        } catch (e) {
            console.warn(`      ⚠️ Error processing row ${i}: ${e.message}`);
        }
    }
}

function saveToCSV(data) {
    const csvHeader = 'Tab,Chat,URL,FirstMessage,FirstSender,HasReply,Count,Is5Plus\n';
    const csvRows = data.map(row => {
        return `"${row.Tab}","${row.Chat}","${row.URL}","${row.FirstMessage.replace(/"/g, '""')}","${row.FirstSender}","${row.HasReply}","${row.Count}","${row.Is5Plus}"`;
    }).join('\n');

    const filePath = path.join(process.cwd(), 'au_inbox_results.csv');
    fs.writeFileSync(filePath, '\ufeff' + csvHeader + csvRows, 'utf8');
    console.log(`\n📊 Results saved to: ${filePath}`);
}

checkAUInBox();
