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
        const inputSelector = 'div[role="textbox"][contenteditable="true"]';
        await page.waitForSelector(inputSelector, { state: 'visible', timeout: 15000 }).catch(() => { });
        await wait(2500);

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
            await wait(3000);
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

    // 1. Selection with options
    // Using COLLATE NOCASE for vote to be safe, although it's usually lowercase
    let query = `SELECT * FROM profiles WHERE vote = 'like' COLLATE NOCASE AND (dmSent = 0 OR dmSent IS NULL)`;

    const params = [];

    if (options.cityOnly) {
        query += ` AND isInCity = 1`;
    }

    query += ` ORDER BY timestamp DESC`;

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
    const maxWorkers = Math.min(concurrentProfiles, accounts.length);
    let currentProcessed = 0;
    const results = [];

    // Worker function to process profiles from the shared queue
    const processWorker = async (account, workerId) => {
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

            logger.info(`🧵 [WORKER ${workerId}] Starting for ${profile.url} using ${account.name} (ID: ${account.id})`);

            const browserConfig = {
                id: account.id,
                proxy: account.proxy,
                cookies: account.cookies,
                fingerprint: account.fingerprint,
                timeouts: { pageLoad: 60000, typingDelayMin: 50, typingDelayMax: 150 }
            };

            let skipBrowser = await getSetting('showBrowser') !== true;
            let browser, context;

            try {
                const browserResult = await createBrowserContext(browserConfig, skipBrowser);
                browser = browserResult.browser;
                context = browserResult.context;

                const liveInterval = startLiveView(context);

                // Select message logic
                const donorName = profile.donor ? profile.donor.replace('@', '').trim() : '';
                const group = donorGroups.find(g => (g.donors || []).some(d => (typeof d === 'string' ? d : d.url).includes(donorName)));
                let msgs = (group && group.messages?.length > 0) ? group.messages : [];

                if (msgs.length === 0) {
                    const allGroup = donorGroups.find(g => g.id === 'all');
                    msgs = (allGroup && allGroup.messages?.length > 0) ? allGroup.messages : ['Hello!'];
                }

                const message = msgs[Math.floor(Math.random() * msgs.length)];

                const result = await sendMessageToProfile(context, profile.url, message, browserConfig);

                // IMPORTANT: Mark as sent if SUCCESS or skipped due to HISTORY/EXISTING CHAT
                if (result.success || result.reason === 'history' || result.reason === 'chat_exists') {
                    await db.run(`UPDATE profiles SET dmSent = 1 WHERE url = ?`, [profile.url]);
                }


                if (result.success) {
                    await db.run(
                        `INSERT INTO messages_log (url, username, name, message_text, status, timestamp) VALUES (?, ?, ?, ?, 'sent', ?)`,
                        [profile.url, profile.username || profile.name, profile.name, message, new Date().toISOString()]
                    );
                    logger.info(`🚀 [WORKER ${workerId} SENT] ${profile.url} (@${profile.username})`);
                }

                results.push({ url: profile.url, success: result.success });
                clearInterval(liveInterval);
            } catch (err) {
                logger.error(`Task error for ${profile.url} on worker ${workerId}: ${err.message}`);
                results.push({ url: profile.url, success: false, error: err.message });
            } finally {
                if (context) await context.close().catch(() => { });
                if (browser && !skipBrowser) await browser.close().catch(() => { });

                currentProcessed++;
                updateStatus({ current: currentProcessed });

                // Human-like pause between tasks for THIS worker/account
                if (queue.length > 0 && !messengerStopRequested) {
                    const delay = humanEmulation ? 15000 + Math.random() * 20000 : 3000;
                    logger.info(`⏳ [WORKER ${workerId}] Waiting ${Math.round(delay / 1000)}s before next profile...`);
                    await wait(delay);
                }
            }
        }
    };

    // Launch workers in parallel
    const workerPromises = [];
    for (let i = 0; i < maxWorkers; i++) {
        workerPromises.push(processWorker(accounts[i % accounts.length], i));
    }

    await Promise.all(workerPromises);

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
