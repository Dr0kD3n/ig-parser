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

    const showBrowser = await getSetting('showBrowser') === true;

    const accounts = await getAllAccounts('server');

    if (accounts.length === 0) {
        checkerStatus = { running: false, status: 'No accounts assigned', current: 0, total: 0 };
        return;
    }

    const account = accounts[0]; // Use first sender account
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

        // Close any "Notifications" or "App info" dialogs
        const notNow = page.locator('button:has-text("Not Now"), button:has-text("Не сейчас")').first();
        if (await notNow.isVisible()) {
            await notNow.click();
            await wait(1000);
        }

        // The chat list container
        const scrollableSelector = 'div[role="navigation"] div.xb57i2i, div[role="main"] div.xb57i2i'; // Tentative based on user's deep path

        let checkedUrls = new Set();
        let scrollAttempts = 0;
        const maxScrollAttempts = 30; // Increased search depth but faster steps
        let lastItemText = '';

        while (scrollAttempts < maxScrollAttempts && !checkerStopRequested) {
            if (checkedUrls.size >= targets.length) {
                logger.info('✅ All targets checked, finishing early.');
                break;
            }

            const chatItems = await page.locator('div[role="listitem"], div[role="row"]').all();
            if (chatItems.length === 0) break;

            const currentLastItemText = await chatItems[chatItems.length - 1].innerText();

            for (const item of chatItems) {
                if (checkerStopRequested) break;

                const innerText = await item.innerText();

                // STRICT matching by Name (as per user request)
                const matchedProfile = targets.find(t => {
                    if (checkedUrls.has(t.url)) return false;
                    const cleanName = (t.name || '').trim();
                    return cleanName && innerText.includes(cleanName);
                });

                if (matchedProfile) {
                    let newStatus = null;
                    const blueDot = item.locator('div[style*="rgb(var(--ig-outgoing-message-bubble))"], div[style*="rgb(0, 149, 246)"]').first();

                    if (await blueDot.isVisible()) {
                        newStatus = 'replied';
                        logger.info(`✨ Found reply: ${matchedProfile.name}`);
                    } else if (innerText.toLowerCase().includes('liked a message') || innerText.toLowerCase().includes('отметил(а) «нравится»')) {
                        newStatus = 'liked';
                        logger.info(`❤️ Found like: ${matchedProfile.name}`);
                    }

                    if (newStatus) {
                        await db.run(`UPDATE messages_log SET status = ? WHERE id = ?`, [newStatus, matchedProfile.id]);
                        checkerStatus.current++;
                    }
                    checkedUrls.add(matchedProfile.url);
                }
            }


            if (currentLastItemText === lastItemText && scrollAttempts > 5) {
                logger.info('Reached end of inbox list.');
                break;
            }
            lastItemText = currentLastItemText;

            // Faster scroll and shorter wait
            await page.mouse.wheel(0, 1500);
            await wait(1000);
            scrollAttempts++;
            checkerStatus.status = `Scanning inbox (${checkedUrls.size}/${targets.length})...`;
        }


        checkerStatus.status = 'Finished';
    } catch (e) {
        logger.error(`Feedback checker error: ${e.message}`);
        checkerStatus.status = `Error: ${e.message}`;
    } finally {
        clearInterval(liveInterval);
        await context.close();
        if (browser) await browser.close();
        checkerStatus.running = false;
    }
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
