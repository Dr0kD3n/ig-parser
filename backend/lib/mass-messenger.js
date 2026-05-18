'use strict';
const { getDB } = require('./db');
const { getAllAccounts, getSetting } = require('./config');
const { createBrowserContext, startLiveView } = require('./browser');
const { wait, humanType } = require('./utils');
const logger = require('./logger');

let massMessengerStatus = {
    running: false,
    current: 0,
    total: 0,
    status: 'Idle',
    results: [],
};

let messengerStopRequested = false;

async function sendMessageToProfile(context, url, message, config) {
    let page;
    try {
        page = await context.newPage();
        logger.info(`🌐 Opening: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await wait(2000); // Give it a moment to stabilize

        const isDirectChat = page.url().includes('/direct/t/');

        if (!isDirectChat) {
            // Wait for profile buttons to load
            await page.waitForSelector('header section button, div[role="dialog"]', { timeout: 8000 }).catch(() => { });
            await wait(1500);

            // Double check: if we are already in a DM modal after loading (sometimes IG auto-opens)
            const chatLoaded = await page.locator('div[role="textbox"][contenteditable="true"]').count() > 0;

            if (!chatLoaded) {
                let foundDirect = false;
                const messageButtonSelectors = [
                    'header section button:has-text("Message")',
                    'header section button:has-text("Сообщение")',
                    'header section button:has-text("Send message")',
                    'header section div[role="button"]:has-text("Message")',
                    'header section div[role="button"]:has-text("Сообщение")',
                    'header section button:has-text("Написать")',
                    'header section a:has-text("Message")',
                    'header section a:has-text("Сообщение")'
                ];

                for (const selector of messageButtonSelectors) {
                    const btn = page.locator(selector).first();
                    if (await btn.count() > 0 && await btn.isVisible()) {
                        await btn.click();
                        foundDirect = true;
                        logger.info(`✅ Found "Message" button in header: ${selector}`);
                        break;
                    }
                }

                if (!foundDirect) {
                    const optionsBtn = page.locator('header svg[aria-label*="Параметры"], header svg[aria-label*="Options"], header svg[aria-label*="More options"], header button:has(svg[aria-label*="Options"])').first();
                    if (await optionsBtn.isVisible()) {
                        await optionsBtn.click();
                        await wait(2000);

                        const labels = ["Send message", "Отправить сообщение", "Написать", "Message", "Сообщение"];
                        let targetBtn = null;
                        for (const label of labels) {
                            const btn = page.getByRole('button', { name: label, exact: false });
                            if (await btn.count() > 0) {
                                targetBtn = btn;
                                break;
                            }
                        }

                        if (targetBtn && await targetBtn.isVisible()) {
                            await targetBtn.click();
                            logger.info(`✅ Found message button in menu`);
                        } else {
                            // Last ditch loose text fallback
                            const fallback = page.locator('div[role="dialog"] button:has-text("Message"), div[role="dialog"] [role="button"]:has-text("Message")').first();
                            if (await fallback.count() > 0) {
                                await fallback.click();
                                logger.info(`⚠️ Using loose fallback in menu`);
                            } else {
                                logger.warn(`❌ No message button found for ${url}`);
                                return { success: false, reason: 'no_button' };
                            }
                        }
                    } else {
                        logger.warn(`❌ No message button and no options for ${url}`);
                        return { success: false, reason: 'no_button' };
                    }
                }
            }
        }

        // Wait for chat stabilizing
        const inputSelector = 'div[role="textbox"][contenteditable="true"], div[aria-label="Message"], div[aria-label="Напишите сообщение..."], [aria-label="Message"], [aria-label="Напишите сообщение..."]';
        const notNowSelector = 'button:has-text("Not Now"), button:has-text("Не сейчас")';

        try {
            await Promise.race([
                page.waitForSelector(inputSelector, { state: 'visible', timeout: 30000 }),
                page.waitForSelector(notNowSelector, { state: 'visible', timeout: 30000 })
            ]);

            const notNow = page.locator(notNowSelector).first();
            if (await notNow.isVisible()) {
                await notNow.click();
                await wait(2000);
            }

            // Final wait for input
            await page.waitForSelector(inputSelector, { state: 'visible', timeout: 15000 });
        } catch (e) {
            logger.warn(`⚠️ Timeout waiting for chat input for ${url}`);
        }
        await wait(1000); // Stabilization wait

        // DISMISS "Not Now" if present
        const notNow = page.locator('button:has-text("Not Now"), button:has-text("Не сейчас")').first();
        if (await notNow.isVisible()) {
            await notNow.click();
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
        const scope = await chatWindow.count() > 0 ? chatWindow : null;

        if (scope) {
            for (const selector of historySelectors) {
                if (page.isClosed()) break;
                const elements = await scope.locator(selector).all().catch(() => []);
                for (const el of elements) {
                    try {
                        if (page.isClosed()) break;
                        const text = (await el.innerText() || '').trim();
                        if (!text || text.length < 2) continue;
                        if (BLACKLIST.some(b => text.includes(b))) continue;

                        // Match by content: if history contains our message
                        if (normalizedTarget.length > 5 && normalize(text).includes(normalizedTarget)) {
                            hasMatchingContent = true;
                        }

                        // Match common templates
                        const lowerText = text.toLowerCase();
                        if ((lowerText.includes("вайб") && (lowerText.includes("космос") || lowerText.includes("танцуешь") || lowerText.includes("пизды"))) ||
                            (lowerText.includes("взгляд") && lowerText.includes("черти")) ||
                            (lowerText.includes("творческая") || lowerText.includes("танцами занимаешься"))) {
                            hasMatchingContent = true;
                        }

                        // Property check (color/alignment) for outgoing bubbles
                        const isOutgoing = await el.evaluate(node => {
                            const style = window.getComputedStyle(node);
                            const bg = style.backgroundColor;
                            const isRightAligned = style.alignSelf === 'flex-end' ||
                                (node.parentElement && window.getComputedStyle(node.parentElement).justifyContent === 'flex-end');

                            return bg.includes('0, 149, 246') ||
                                bg.includes('55, 151, 240') ||
                                bg.includes('74, 93, 249') ||
                                bg.includes('0, 116, 204') ||
                                isRightAligned;
                        }).catch(() => false);

                        if (isOutgoing) {
                            hasOutgoing = true;
                        }
                        totalMessages++;
                        if (detectedTexts.length < 5) {
                            detectedTexts.push(text.slice(0, 70).replace(/\n/g, ' '));
                        }
                    } catch (e) { }
                }
            }
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
            await humanType(page, inputSelector, message, config.timeouts);
            await wait(1000);
            await page.keyboard.press('Enter');
            await wait(200); // Micro-delay requested AFTER sending
            await wait(3000); // Additional wait to ensure message is visually sent/logged by IG
            return { success: true };
        } else {
            logger.error(`❌ Textbox not found for ${url}`);
            return { success: false, reason: 'no_textbox' };
        }

    } catch (e) {
        logger.error(`Error sending DM to ${url}: ${e.message}`);
        return { success: false, reason: 'error', error: e.message };
    } finally {
        if (page && !page.isClosed()) {
            await page.close().catch(() => { });
        }
    }
}



async function startMassMessaging(onProgress, options = {}) {
    if (massMessengerStatus.running) return;

    messengerStopRequested = false;
    const db = await getDB();
    const settings = await db.all(`SELECT * FROM settings`);
    const donorGroups = JSON.parse(settings.find(s => s.key === 'donorGroups')?.value || '[]');
    const concurrentProfiles = parseInt(settings.find(s => s.key === 'concurrentProfiles')?.value || '3');
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
    } else {
        query += ` AND (isInCity = 0 OR isInCity IS NULL)`;
    }

    query += ` ORDER BY timestamp DESC`;
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

    updateStatus({ status: `Broadcasting with ${accounts.length} accounts...` });

    const queue = [...profiles];
    let currentProcessed = 0;
    const results = [];

    // Account Runner: starts one browser per account and manages multiple workers (tabs)
    const runAccount = async (account) => {
        const browserConfig = {
            id: account.id,
            proxy: account.proxy,
            cookies: account.cookies,
            fingerprint: account.fingerprint,
            timeouts: { pageLoad: 60000, typingDelayMin: 50, typingDelayMax: 150 }
        };

        let skipBrowser = await getSetting('showBrowser') !== true;
        let browser, context, liveInterval;

        try {
            logger.info(`🚀 [ACCOUNT ${account.name}] Launching browser instance...`);
            const browserResult = await createBrowserContext(browserConfig, skipBrowser);
            browser = browserResult.browser;
            context = browserResult.context;
            liveInterval = startLiveView(context);

            const workerPromises = [];
            // Spawn concurrent workers (tabs) for THIS account
            for (let i = 0; i < concurrentProfiles; i++) {
                workerPromises.push((async (workerId) => {
                    // Stagger the start of each tab to avoid overwhelming navigation
                    await wait(workerId * 1000);

                    try {
                        while (queue.length > 0 && !messengerStopRequested) {
                            const profile = queue.shift();
                            if (!profile) break;

                            // Double-check dmSent status before proceeding to prevent race conditions in parallel mode
                            const freshProfile = await db.get(`SELECT dmSent FROM profiles WHERE url = ?`, [profile.url]);
                            if (freshProfile?.dmSent === 1) {
                                currentProcessed++;
                                updateStatus({ current: currentProcessed });
                                continue;
                            }

                            logger.info(`🧵 [ACC: ${account.name} | TAB: ${workerId}] Starting for ${profile.url}`);

                            try {
                                // Select message logic
                                const donorName = profile.donor ? profile.donor.replace('@', '').trim() : '';
                                const group = donorGroups.find(g => (g.donors || []).some(d => (typeof d === 'string' ? d : d.url).includes(donorName)));
                                let msgs = (group && group.messages?.length > 0) ? group.messages : [];

                                if (msgs.length === 0) {
                                    const allGroup = donorGroups.find(g => g.id === 'all');
                                    msgs = (allGroup && allGroup.messages?.length > 0) ? allGroup.messages : ['Hello!'];
                                }

                                // [SMART SELECTION] Сортируем сообщения по количеству отправок, чтобы статистика была ровной
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

                                        // Находим минимальное количество отправок
                                        const minCount = Math.min(...msgs.map(m => countMap[m] || 0));
                                        // Выбираем все сообщения с минимальным количеством
                                        const bestMsgs = msgs.filter(m => (countMap[m] || 0) === minCount);
                                        // Рандом из лучших (чтобы не спамить одним и тем же в одну секунду)
                                        message = bestMsgs[Math.floor(Math.random() * bestMsgs.length)];
                                    } catch (e) {
                                        logger.error(`Error in smart message selection: ${e.message}`);
                                        message = msgs[Math.floor(Math.random() * msgs.length)];
                                    }
                                }

                                // Process the profile using a new tab in the shared context
                                const result = await sendMessageToProfile(context, profile.url, message, browserConfig);

                                // IMPORTANT: Mark as sent if SUCCESS or skipped due to HISTORY/EXISTING CHAT
                                if (result.success) {
                                    await db.run(`UPDATE profiles SET dmSent = 1, tgTagged = 0, dmError = NULL WHERE url = ?`, [profile.url]);

                                    await db.run(
                                        `INSERT INTO messages_log (url, username, name, message_text, status, timestamp, account_id, sender_name) VALUES (?, ?, ?, ?, 'sent', ?, ?, ?)`,
                                        [profile.url, profile.username || profile.name, profile.name, message, new Date().toISOString(), account.id, account.name]
                                    );
                                    logger.info(`🚀 [ACC: ${account.name} SENT] ${profile.url} (@${profile.username})`);
                                } else {
                                    // Mark as skipped/failed: tgTagged = 2 means "Не написал" (automatic error report)
                                    if (result.reason === 'history' || result.reason === 'chat_exists' || result.reason === 'no_button') {
                                        await db.run(`UPDATE profiles SET dmSent = 1, tgTagged = 2, dmError = ? WHERE url = ?`, [result.reason, profile.url]);
                                    } else {
                                        await db.run(`UPDATE profiles SET tgTagged = 2, dmError = ? WHERE url = ?`, [result.reason || 'error', profile.url]);
                                    }
                                }

                                results.push({ url: profile.url, success: result.success });
                            } catch (err) {
                                logger.error(`Task error for ${profile.url} on ${account.name}: ${err.message}`);
                                results.push({ url: profile.url, success: false, error: err.message });
                            } finally {
                                currentProcessed++;
                                updateStatus({ current: currentProcessed });

                                // Human-like pause between tasks for THIS tab
                                if (queue.length > 0 && !messengerStopRequested) {
                                    const delay = humanEmulation ? 15000 + Math.random() * 20000 : 3000;
                                    await wait(delay);
                                }
                            }
                        }
                    } catch (workerErr) {
                        logger.error(`Worker ${workerId} loop error on ${account.name}: ${workerErr.message}`);
                    }
                })(i));
            }

            await Promise.all(workerPromises);

        } catch (err) {
            logger.error(`Account runner error for ${account.name}: ${err.message}`);
        } finally {
            if (liveInterval) clearInterval(liveInterval);
            if (context) await context.close().catch(() => { });
            if (browser && !skipBrowser) await browser.close().catch(() => { });
        }
    };

    // Parallel execution across all accounts
    const accountPromises = accounts.map(acc => runAccount(acc));
    await Promise.all(accountPromises);

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
