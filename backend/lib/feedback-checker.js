'use strict';
const { getDB } = require('./db');
const { getAllAccounts, getSetting } = require('./config');
const { createBrowserContext, startLiveView } = require('./browser');

const { wait, humanScroll } = require('./utils');
const logger = require('./logger');

let checkerStatus = {
    running: false,
    current: 0,
    total: 0,
    status: 'Idle',
};

let checkerStopRequested = false;

async function checkFeedback() {
    if (checkerStatus.running) return;

    checkerStatus.running = true;
    checkerStatus.status = 'Initializing...';
    checkerStopRequested = false;

    const db = await getDB();

    // Get profiles that were sent a message but haven't replied yet
    // Join with profiles to get the clear 'name' for matching in inbox
    const targets = await db.all(`
        SELECT m.id, m.url, p.name, p.username 
        FROM messages_log m
        JOIN profiles p ON m.url = p.url
        WHERE m.status NOT IN ('replied', 'liked')
    `);

    if (targets.length === 0) {
        checkerStatus = { running: false, status: 'No profiles to check', current: 0, total: 0 };
        return;
    }

    checkerStatus.total = targets.length;
    checkerStatus.status = 'Opening inbox...';

    const accounts = await getAllAccounts('server');
    if (accounts.length === 0) {
        checkerStatus = { running: false, status: 'No accounts assigned', current: 0, total: 0 };
        return;
    }

    const showBrowser = await getSetting('showBrowser') === true;

    for (const account of accounts) {
        if (checkerStopRequested) break;

        checkerStatus.status = `Checking inbox: ${account.name}...`;

        const browserConfig = {
            id: account.id,
            proxy: account.proxy,
            cookies: account.cookies,
            fingerprint: account.fingerprint,
            timeouts: { pageLoad: 60000 }
        };

        let { browser, context } = await createBrowserContext(browserConfig, !showBrowser);
        const liveInterval = startLiveView(context);
        const page = await context.newPage();

        try {
            await page.goto('https://www.instagram.com/direct/inbox/', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await wait(5000);

            // Close dialogs
            const notNow = page.locator('button:has-text("Not Now"), button:has-text("Не сейчас"), button:has-text("Save Info")').first();
            if (await notNow.isVisible()) {
                await notNow.click();
                await wait(1000);
            }

            let checkedUrls = new Set();
            let scrollAttempts = 0;
            const maxScrollAttempts = 20;
            let lastItemText = '';

            // Filter targets that were sent from THIS account, or targets where sender is unknown
            const accountTargets = targets.filter(t => !t.account_id || t.account_id === account.id);

            while (scrollAttempts < maxScrollAttempts && !checkerStopRequested) {
                if (page.isClosed()) break;

                const chatItems = await page.locator('[role="listitem"], [role="row"]').all();
                if (chatItems.length === 0) break;

                const currentLastItemText = await chatItems[chatItems.length - 1].innerText().catch(() => '');

                for (const item of chatItems) {
                    if (checkerStopRequested || page.isClosed()) break;

                    const innerText = (await item.innerText().catch(() => '')).trim();
                    if (!innerText) continue;

                    const matchedProfile = accountTargets.find(t => {
                        if (checkedUrls.has(t.url)) return false;
                        const cleanName = (t.name || '').trim();
                        const cleanUser = (t.username || '').trim();
                        return (cleanName && innerText.includes(cleanName.slice(0, 15))) ||
                            (cleanUser && innerText.includes(cleanUser));
                    });

                    if (matchedProfile) {
                        let newStatus = null;
                        const blueDot = item.locator('div[style*="rgb(0, 149, 246)"], div[style*="rgb(var(--ig-primary-button))"]').first();

                        if (await blueDot.isVisible().catch(() => false)) {
                            newStatus = 'replied';
                            logger.info(`✨ [${account.name}] Found reply from: ${matchedProfile.name}`);
                        } else if (innerText.toLowerCase().includes('liked') || innerText.toLowerCase().includes('нравится')) {
                            newStatus = 'liked';
                            logger.info(`❤️ [${account.name}] Found like from: ${matchedProfile.name}`);
                        }

                        if (newStatus) {
                            await db.run(`UPDATE messages_log SET status = ? WHERE id = ?`, [newStatus, matchedProfile.id]);
                            await db.run(`UPDATE profiles SET dm_status = ? WHERE url = ?`, [newStatus, matchedProfile.url]);
                            checkerStatus.current++;
                        }
                        checkedUrls.add(matchedProfile.url);
                    }
                }

                if (currentLastItemText === lastItemText && scrollAttempts > 3) break;
                lastItemText = currentLastItemText;
                await page.mouse.wheel(0, 1200);
                await wait(1500);
                scrollAttempts++;
                checkerStatus.status = `Scanning: ${account.name} (${checkedUrls.size}/${accountTargets.length})...`;
            }
        } catch (e) {
            logger.error(`Error checking ${account.name}: ${e.message}`);
        } finally {
            clearInterval(liveInterval);
            if (context) await context.close().catch(() => { });
            if (browser) await browser.close().catch(() => { });
        }
    }

    checkerStatus.status = 'Finished';
    checkerStatus.running = false;
}

function getCheckerStatus() {
    return checkerStatus;
}

function stopChecker() {
    checkerStopRequested = true;
}

module.exports = {
    checkFeedback,
    getCheckerStatus,
    stopChecker
};
