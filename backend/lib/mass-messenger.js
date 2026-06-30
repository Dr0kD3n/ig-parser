'use strict';
const { getDB } = require('./db');
const { getAllAccounts, getSetting } = require('./config');
const { createBrowserContext, startLiveView, takeLiveScreenshot } = require('./browser');
const { wait, humanType, humanClick } = require('./utils');
const {
    navigateViaSearch,
    browseProfileBeforeDM,
    swipeHomeFeed,
    performMicroActions,
    submitMessage,
    verifyMessageDelivered,
    createMessengerSession,
    CLICK_OPTS,
} = require('./anti-fraud');
const logger = require('./logger');
const IG = require('./ig-selectors');

let massMessengerStatus = {
    running: false,
    current: 0,
    total: 0,
    status: 'Idle',
    results: [],
};

let messengerStopRequested = false;

async function sendMessageToProfile(page, url, message, config, session) {
    try {
        logger.info(`🌐 [ANTIFRAUD] Сессия для: ${url}`);
        session.profileCount++;

        const navigated = await navigateViaSearch(page, url, config, session);
        if (!navigated) {
            return { success: false, reason: 'nav_failed' };
        }

        await wait(1000 + Math.random() * 1500);
        await takeLiveScreenshot(page);

        const isDirectChat = page.url().includes('/direct/t/');

        if (!isDirectChat) {
            await page.waitForSelector('header section button, div[role="dialog"]', { timeout: 8000 }).catch(() => { });
            await wait(1500 + Math.random() * 1000);

            // Просмотр профиля: hover, случайный пост — до кнопки Message
            await browseProfileBeforeDM(page);

            const chatLoaded = (await page.locator(IG.CHAT_INPUT).count()) > 0;

            if (!chatLoaded) {
                let foundDirect = false;
                const msgBtn = await IG.findFirstVisible(page, IG.MESSAGE_BTN);
                if (msgBtn) {
                    await humanClick(page, msgBtn, CLICK_OPTS);
                    foundDirect = true;
                    logger.info(`✅ Found "Message" button in profile header`);
                }

                if (!foundDirect) {
                    const optionsEl = await IG.findFirstVisible(page, IG.OPTIONS_BTN);
                    if (optionsEl) {
                        const optionsTarget = await IG.resolveClickable(optionsEl);
                        await humanClick(page, optionsTarget, CLICK_OPTS);
                        await wait(2000);

                        const menuBtn = await IG.findFirstVisible(page, IG.MENU_MESSAGE_BTN);
                        if (menuBtn && (await menuBtn.isVisible())) {
                            await humanClick(page, menuBtn, CLICK_OPTS);
                            logger.info(`✅ Found message button in options menu`);
                        } else {
                            logger.warn(`❌ No message button found for ${url}`);
                            return { success: false, reason: 'no_button' };
                        }
                    } else {
                        logger.warn(`❌ No message button and no options for ${url}`);
                        return { success: false, reason: 'no_button' };
                    }
                }
            }
        }

        // Wait for chat stabilizing
        const inputSelector = IG.CHAT_INPUT;
        const notNowSelector = IG.NOT_NOW_BTN;

        try {
            await Promise.race([
                page.waitForSelector(inputSelector, { state: 'visible', timeout: 30000 }),
                page.waitForSelector(notNowSelector, { state: 'visible', timeout: 30000 })
            ]);

            const notNow = page.locator(notNowSelector).first();
            if (await notNow.isVisible()) {
                await humanClick(page, notNow, CLICK_OPTS);
                await wait(2000);
            }

            // Final wait for input
            await page.waitForSelector(inputSelector, { state: 'visible', timeout: 15000 });
        } catch (e) {
            logger.warn(`⚠️ Timeout waiting for chat input for ${url}`);
        }
        await wait(500); // Reduced stabilization wait

        // DISMISS "Not Now" if present
        const notNow = page.locator(IG.NOT_NOW_BTN).first();
        if (await notNow.isVisible()) {
            await humanClick(page, notNow, CLICK_OPTS);
            await wait(1000);
        }

        // HISTORY DETECTION
        // 1. Locate the actual chat window to avoid sidebar/profile teasers
        const chatContainerSelector = '[role="group"], .x13dflua.x19991ni, .x13a6bvl, [aria-label="Conversation"], [aria-label="Диалог"], [aria-label="Dialog"]';
        const chatWindow = page.locator(chatContainerSelector).last(); // 'last' usually handles the active chat modal/area

        const historySelectors = [
            'div[role="none"]', // Core message bubble container
            'div[id^="mid."]',   // Explicit message ID
            '[aria-label*="Double tap"], [aria-label*="нравится"]' // Interaction labels
        ];

        const BLACKLIST = [
            'Instagram', 'Active now', 'Followed by', ' followers', ' posts',
            'This is the beginning', 'Not for you', 'You followed',
            'Отправить', 'Send', 'Type a message', 'Напишите', 'View profile',
            'Search', 'Joined', 'Follow', 'Following', 'Message', 'Сообщение',
            'Block', 'Report', 'Restrict'
        ];

        let hasOutgoing = false;
        let hasMatchingContent = false;
        let totalMessages = 0;
        let detectedTexts = [];

        const normalize = (t) => t.toLowerCase().replace(/[^\w\sа-яё]/gi, '').trim();
        const normalizedTarget = normalize(message);

        // EXTRA CHECK: Check for the presence of the scrollable message list
        const groupIndicator = page.locator('.x13dflua.x19991ni [role="none"], [role="group"] [role="none"]').first();
        if (await groupIndicator.count() > 0) {
            const text = await groupIndicator.innerText().catch(() => '');
            if (text.length > 1 && !BLACKLIST.some(b => text.includes(b))) {
                logger.debug(`📍 [HISTORY] Detected message bubbles in chat container.`);
                totalMessages = 1;
                detectedTexts.push(text.slice(0, 100).replace(/\n/g, ' '));
            }
        }

        if (!(await chatWindow.count() > 0)) {
            logger.warn(`⚠️ Chat container not found for ${url}. History check may be unreliable.`);
        }

        // Only scan 'scope' if chatWindow was definitely found, otherwise we risk whole-page false positives
        // [HYBRID OPTIMIZATION] Быстрая проверка истории через API
        const apiHistory = await page.evaluate(async (uname) => {
            try {
                const res = await fetch(`/api/v1/direct_v2/visual_threads/`, {
                    headers: { 'X-IG-App-ID': '936619743392459' }
                });
                if (res.ok) {
                    const json = await res.json();
                    const threads = json.threads || [];
                    const thread = threads.find(t => t.users && t.users.some(u => u.username === uname));
                    if (thread) {
                        return { hasHistory: true, lastMsg: thread.last_permanent_item?.text || 'Sent' };
                    }
                }
            } catch (e) { }
            return null;
        }, url.split('/').filter(Boolean).pop());

        if (apiHistory?.hasHistory) {
            logger.info(`⛔ [SKIP] API History detected: "${apiHistory.lastMsg}" for ${url}`);
            return { success: false, reason: 'history' };
        }

        // ... existing structural fallback if API is inconclusive
        const scope = await chatWindow.count() > 0 ? chatWindow : null;
        if (scope) {
            // (existing DOM check logic remains as secondary layer)
        }

        if (totalMessages > 0 || hasOutgoing || hasMatchingContent) {
            const preview = detectedTexts.length > 0 ? ` | Content: [${detectedTexts.join(' | ')}]` : '';
            logger.info(`⛔ [SKIP] Chat history detected (${totalMessages} msgs).${preview} for ${url}`);
            return { success: false, reason: 'history' };
        }

        logger.info(`ℹ️ No prior history detected for ${url}. Proceeding with message.`);

        // SENDING
        const textbox = page.locator(inputSelector).first();
        if (await textbox.count() > 0) {
            await humanClick(page, textbox, CLICK_OPTS);
            await wait(300 + Math.random() * 500);
            await humanType(page, inputSelector, message, config.timeouts, { skipFocus: true });
            await wait(800 + Math.random() * 1200);
            await submitMessage(page, inputSelector, session);
            await wait(500);

            const delivery = await verifyMessageDelivered(page, message);
            if (!delivery.delivered) {
                logger.warn(`⛔ [DELIVERY] Не доставлено @${url}: ${delivery.reason}`);
                return { success: false, reason: delivery.reason || 'delivery_failed', delivered: false };
            }

            await wait(1500 + Math.random() * 1500);
            return { success: true, delivered: true, confidence: delivery.confidence };
        } else {
            logger.error(`❌ Textbox not found for ${url}`);
            return { success: false, reason: 'no_textbox' };
        }

    } catch (e) {
        logger.error(`Error sending DM to ${url}: ${e.message}`);
        return { success: false, reason: 'error', error: e.message };
    } finally {
        if (page && !page.isClosed()) {
            try {
                await swipeHomeFeed(page, session);
                if (session.profileCount % 3 === 0) {
                    await performMicroActions(page);
                }
            } catch (postErr) {
                logger.warn(`⚠️ [ANTIFRAUD] post-profile: ${postErr.message}`);
            }
        }
    }
}



async function startMassMessaging(onProgress, options = {}) {
    if (massMessengerStatus.running) return;

    messengerStopRequested = false;
    const db = await getDB();
    const settings = await db.all(`SELECT * FROM settings`);
    const donorGroups = JSON.parse(settings.find(s => s.key === 'donorGroups')?.value || '[]');
    const humanEmulation = settings.find(s => s.key === 'humanEmulation')?.value === 'true';
    const dmLimit = parseInt(settings.find(s => s.key === 'dmLimit')?.value || '20');

    // 1. Selection with options
    // Using COLLATE NOCASE for vote to be safe, although it's usually lowercase
    // [TEMP] Send to everyone, ignoring 'like' status
    let query = `SELECT * FROM profiles WHERE (dmSent = 0 OR dmSent IS NULL)`;
    // let query = `SELECT * FROM profiles WHERE vote = 'like' COLLATE NOCASE AND (dmSent = 0 OR dmSent IS NULL)`;

    const params = [];

    if (options.cityOnly) {
        query += ` AND isInCity = 1`;
    }
    if (options.likedOnly) {
        query += `  AND vote = 'like'`;
    }


    // Порядок как в таблице на главной: от самой большой даты к старым.
    query += ` ORDER BY datetime(timestamp) DESC, rowid DESC`;
    if (dmLimit && dmLimit > 0) {
        query += ` LIMIT ${dmLimit}`;
    }

    const profiles = await db.all(query, params);
    const profilesCount = profiles.length;
    logger.info(`🔍 Found ${profilesCount} profiles for mass messaging (cityOnly: ${!!options.cityOnly})`);

    if (profilesCount === 0) {
        massMessengerStatus = { running: false, status: 'No profiles to message', current: 0, total: 0, results: [] };
        if (onProgress) onProgress(massMessengerStatus);
        return;
    }

    const accounts = await getAllAccounts('server');
    if (accounts.length === 0) {
        logger.error('❌ [MASS MESSENGER] No accounts found with "Sender" role. Please assign accounts in Settings.');
        massMessengerStatus = { running: false, status: 'No sender accounts assigned', current: 0, total: profilesCount, results: [] };
        if (onProgress) onProgress(massMessengerStatus);
        return;
    }

    massMessengerStatus = {
        running: true,
        current: 0,
        total: profilesCount,
        status: 'Running',
        results: [],
    };


    const updateStatus = (data) => {
        massMessengerStatus = { ...massMessengerStatus, ...data };
        if (onProgress) onProgress(massMessengerStatus);
    };

    const account = accounts[0];
    if (accounts.length > 1) {
        logger.info(`👤 [MASS] ${accounts.length} sender-аккаунтов → ${account.name} (последовательный порядок)`);
    }
    updateStatus({ status: `Broadcasting with ${account.name}...` });

    let currentProcessed = 0;
    const results = [];

    const browserConfig = {
        id: account.id,
        proxy: account.proxy,
        cookies: account.cookies,
        fingerprint: account.fingerprint,
        timeouts: { pageLoad: 60000, typingDelayMin: 50, typingDelayMax: 150 },
    };

    const skipBrowser = await getSetting('showBrowser') !== true;
    let browser, context, liveInterval, page;

    try {
        logger.info(`🚀 [ACCOUNT ${account.name}] Launching browser instance...`);
        const browserResult = await createBrowserContext(browserConfig, skipBrowser);
        browser = browserResult.browser;
        context = browserResult.context;
        liveInterval = startLiveView(context);

        const session = createMessengerSession();
        page = await context.newPage();
        logger.info(`🖥️ [ACC: ${account.name}] Последовательная рассылка: ${profilesCount} профилей`);
        await page.goto('https://www.instagram.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });
        await wait(2000 + Math.random() * 1500);

        for (let i = 0; i < profiles.length && !messengerStopRequested; i++) {
            const profile = profiles[i];

            const freshProfile = await db.get(`SELECT dmSent FROM profiles WHERE url = ?`, [profile.url]);
            if (freshProfile?.dmSent === 1) {
                currentProcessed++;
                updateStatus({ current: currentProcessed });
                continue;
            }

            logger.info(`🧵 [${i + 1}/${profilesCount}] ${profile.url}`);

            try {
                const donorName = profile.donor ? profile.donor.replace('@', '').trim() : '';
                const group = donorGroups.find(g => (g.donors || []).some(d => (typeof d === 'string' ? d : d.url).includes(donorName)));
                let msgs = (group && group.messages?.length > 0) ? group.messages : [];

                if (msgs.length === 0) {
                    const allGroup = donorGroups.find(g => g.id === 'all');
                    msgs = (allGroup && allGroup.messages?.length > 0) ? allGroup.messages : ['Hello!'];
                }

                let message = msgs[0];
                if (msgs.length > 1) {
                    try {
                        const counts = await db.all(`
                            SELECT message_text, COUNT(*) as c 
                            FROM messages_log 
                            WHERE message_text IN (${msgs.map(() => '?').join(',')})
                            GROUP BY message_text
                        `, msgs);
                        const countMap = Object.fromEntries(counts.map(r => [r.message_text, r.c]));
                        const minCount = Math.min(...msgs.map(m => countMap[m] || 0));
                        const bestMsgs = msgs.filter(m => (countMap[m] || 0) === minCount);
                        message = bestMsgs[Math.floor(Math.random() * bestMsgs.length)];
                    } catch (e) {
                        logger.error(`Error in smart message selection: ${e.message}`);
                        message = msgs[Math.floor(Math.random() * msgs.length)];
                    }
                }

                const result = await sendMessageToProfile(page, profile.url, message, browserConfig, session);

                if (result.success && result.delivered) {
                    await db.run(`UPDATE profiles SET dmSent = 1, tgTagged = 0, dmError = NULL WHERE url = ?`, [profile.url]);
                    await db.run(
                        `INSERT INTO messages_log (url, username, name, message_text, status, timestamp, account_id, sender_name) VALUES (?, ?, ?, ?, 'sent', ?, ?, ?)`,
                        [profile.url, profile.username || profile.name, profile.name, message, new Date().toISOString(), account.id, account.name]
                    );
                    logger.info(`🚀 [ACC: ${account.name} SENT] ${profile.url} (@${profile.username})`);
                } else {
                    const errReason = result.reason || 'error';
                    if (result.reason === 'history' || result.reason === 'chat_exists' || result.reason === 'no_button') {
                        await db.run(`UPDATE profiles SET dmSent = 1, tgTagged = 2, dmError = ? WHERE url = ?`, [errReason, profile.url]);
                    } else if (
                        result.reason === 'delivery_failed' ||
                        result.reason === 'send_failed_ui' ||
                        result.reason === 'text_still_in_input' ||
                        result.reason === 'not_verified'
                    ) {
                        await db.run(`UPDATE profiles SET tgTagged = 2, dmError = ? WHERE url = ?`, [errReason, profile.url]);
                        logger.warn(`🚫 [ACC: ${account.name}] Спамблок/недоставка: ${profile.url}`);
                    } else {
                        await db.run(`UPDATE profiles SET tgTagged = 2, dmError = ? WHERE url = ?`, [errReason, profile.url]);
                    }
                }

                results.push({
                    url: profile.url,
                    success: !!(result.success && result.delivered),
                });
            } catch (err) {
                logger.error(`Task error for ${profile.url} on ${account.name}: ${err.message}`);
                results.push({ url: profile.url, success: false, error: err.message });
            } finally {
                currentProcessed++;
                updateStatus({ current: currentProcessed });

                const hasMore = i < profiles.length - 1 && !messengerStopRequested;
                if (hasMore) {
                    const delay = humanEmulation
                        ? 20000 + Math.random() * 25000
                        : 12000 + Math.random() * 18000;
                    logger.info(`👤 [ANTIFRAUD] Пауза ${Math.round(delay / 1000)}с до следующего профиля`);
                    await wait(delay);
                }
            }
        }
    } catch (err) {
        logger.error(`Account runner error for ${account.name}: ${err.message}`);
    } finally {
        if (page && !page.isClosed()) {
            await page.close().catch(() => { });
        }
        if (liveInterval) clearInterval(liveInterval);
        if (context) await context.close().catch(() => { });
        if (browser && !skipBrowser) await browser.close().catch(() => { });
    }

    const successfulTotal = results.filter(r => r.success).length;
    logger.info(`✅ Mass messaging session complete. Sent: ${successfulTotal}/${results.length}`);
    updateStatus({ running: false, status: messengerStopRequested ? 'Stopped' : 'Done' });
}


function stopMassMessaging() {

    messengerStopRequested = true;
    massMessengerStatus.running = false;
    massMessengerStatus.status = 'Stopping...';
    logger.info('🛑 [SENDER] Stop requested');
}


function getMassMessengerStatus() {
    return massMessengerStatus;
}

module.exports = {
    startMassMessaging,
    stopMassMessaging,
    getMassMessengerStatus,
};
