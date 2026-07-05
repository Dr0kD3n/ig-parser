'use strict';
const { getDB } = require('./db');
const logger = require('./logger');
const IG = require('./ig-selectors');
const { getAllAccounts, getSetting, getList } = require('./config');
const { createBrowserContext, startLiveView, takeLiveScreenshot } = require('./browser');
const { wait, humanType, humanClick, humanScrollToTop } = require('./utils');
const {
    navigateViaSearch,
    browseProfileBeforeDM,
    swipeHomeFeed,
    performMicroActions,
    submitMessage,
    verifyMessageDelivered,
    createMessengerSession,
    closeStoryIfOpen,
    closeDirectModal,
    closeFloatingInbox,
    ensureCorrectChatOrClosed,
    isChatForUsername,
    openProfileDM,
    waitForChatComposer,
    CLICK_OPTS,
    PROFILE_GAP,
    waitWithActivity,
} = require('./anti-fraud');
const state_1 = require('./state');
const { findCategoryMessages } = require('./donor-category-stats');
const {
    dedupeProfilesForMessaging,
    markDmSentByUsername,
    normalizeUsername,
    USERNAME_SQL,
} = require('./profile-dedup');

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
        if (!page || page.isClosed()) {
            logger.warn(`⚠️ [MASS] Вкладка закрыта до обработки ${url}`);
            return { success: false, reason: 'page_closed' };
        }

        logger.info(`🌐 [ANTIFRAUD] Сессия для: ${url}`);
        session.profileCount++;
        const username = url.split('/').filter(Boolean).pop() || '';
        session.lastOpenedDM = null;

        await closeDirectModal(page, session);

        const navigated = await navigateViaSearch(page, url, config, session);
        if (!navigated) {
            return { success: false, reason: 'nav_failed' };
        }

        await waitWithActivity(page, 400 + Math.random() * 600, { noScroll: true });
        await closeStoryIfOpen(page);
        await closeFloatingInbox(page);
        await ensureCorrectChatOrClosed(page, username, session);
        await takeLiveScreenshot(page);

        const isDirectChat = page.url().includes('/direct/t/');

        if (!isDirectChat) {
            await page.waitForSelector('header section button, div[role="dialog"]', { timeout: 8000 }).catch(() => { });
            await wait(500 + Math.random() * 400);

            await browseProfileBeforeDM(page);
            await closeStoryIfOpen(page);
            await closeFloatingInbox(page);
            await ensureCorrectChatOrClosed(page, username, session);
            await humanScrollToTop(page);
            await wait(300 + Math.random() * 300);

            const chatInput = await IG.findActiveChatInput(page);
            const chatLoaded = chatInput && (await isChatForUsername(page, username, session));

            if (!chatLoaded) {
                const opened = await openProfileDM(page, username, session);
                if (!opened) {
                    logger.warn(`❌ No message button found for ${url}`);
                    return { success: false, reason: 'no_button' };
                }
            }
        }

        const scopedChatInput = await waitForChatComposer(page, 15000);

        if (!scopedChatInput) {
            logger.error(`❌ Textbox not found after Message click for ${url}`);
            return { success: false, reason: 'no_textbox' };
        }

        if (!(await isChatForUsername(page, username, session))) {
            logger.warn(`⚠️ [HISTORY] Открыт не тот чат для @${username}, закрываем и пропускаем`);
            await closeDirectModal(page, session);
            return { success: false, reason: 'wrong_chat' };
        }

        // HISTORY DETECTION — только в активном диалоге текущего пользователя
        const chatInputShort = 'div[role="textbox"][contenteditable="true"]';
        const activeChat = page
            .locator(`div[role="dialog"]:has(${chatInputShort})`)
            .last()
            .or(page.locator('section main').filter({ has: page.locator(chatInputShort) }));

        const BLACKLIST = [
            'Instagram', 'Active now', 'Followed by', ' followers', ' posts',
            'This is the beginning', 'Not for you', 'You followed',
            'Отправить', 'Send', 'Type a message', 'Напишите', 'View profile',
            'Search', 'Joined', 'Follow', 'Following', 'Message', 'Сообщение',
            'Block', 'Report', 'Restrict', 'Смотреть профиль', 'View Profile',
        ];

        let totalMessages = 0;
        let detectedTexts = [];

        // [HYBRID OPTIMIZATION] Быстрая проверка истории через API — только если есть реальный текст
        const apiHistory = await page.evaluate(async (uname) => {
            try {
                const res = await fetch(`/api/v1/direct_v2/visual_threads/`, {
                    headers: { 'X-IG-App-ID': '936619743392459' }
                });
                if (res.ok) {
                    const json = await res.json();
                    const threads = json.threads || [];
                    const thread = threads.find(t => t.users && t.users.some(u => u.username === uname));
                    const lastText = thread?.last_permanent_item?.text?.trim();
                    if (thread && lastText) {
                        return { hasHistory: true, lastMsg: lastText };
                    }
                }
            } catch (e) { }
            return null;
        }, username);

        if (apiHistory?.hasHistory) {
            logger.info(`⛔ [SKIP] API History detected: "${apiHistory.lastMsg}" for ${url}`);
            return { success: false, reason: 'history' };
        }

        if ((await activeChat.count()) > 0) {
            const bubbles = activeChat.locator('div[role="none"], div[id^="mid."]');
            const bubbleCount = await bubbles.count();
            for (let i = 0; i < Math.min(bubbleCount, 20); i++) {
                const text = ((await bubbles.nth(i).innerText().catch(() => '')) || '').trim();
                if (!text || text.length <= 1) continue;
                if (BLACKLIST.some((b) => text.includes(b))) continue;
                totalMessages++;
                detectedTexts.push(text.slice(0, 100).replace(/\n/g, ' '));
            }
        }

        if (totalMessages > 0) {
            const preview = detectedTexts.length > 0 ? ` | Content: [${detectedTexts.join(' | ')}]` : '';
            logger.info(`⛔ [SKIP] Chat history detected (${totalMessages} msgs).${preview} for ${url}`);
            return { success: false, reason: 'history' };
        }

        logger.info(`ℹ️ No prior history detected for ${url}. Proceeding with message.`);

        // SENDING
        const textbox = scopedChatInput;
        if (textbox) {
            await closeStoryIfOpen(page);
            await humanClick(page, textbox, CLICK_OPTS);
            await wait(200 + Math.random() * 300);
            await humanType(page, textbox, message, config.timeouts);
            // После ввода нельзя запускать idle-действия: они могут увести фокус из composer.
            await wait(250 + Math.random() * 350);
            await submitMessage(page, scopedChatInput, session);
            await wait(200);

            const delivery = await verifyMessageDelivered(page, message);
            if (!delivery.delivered) {
                logger.warn(`⛔ [DELIVERY] Не доставлено @${url}: ${delivery.reason}`);
                return { success: false, reason: delivery.reason || 'delivery_failed', delivered: false };
            }

            await waitWithActivity(page, 500 + Math.random() * 700);
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
                await closeDirectModal(page, session);
                session.lastOpenedDM = null;
                await swipeHomeFeed(page, session);
                if (session.profileCount % 5 === 0) {
                    await performMicroActions(page);
                }
            } catch (postErr) {
                logger.warn(`⚠️ [ANTIFRAUD] post-profile: ${postErr.message}`);
            }
        }
    }
}


/** E2E: имитация рассылки без браузера */
async function runE2eMassMessaging({ profiles, dmLimit, likedOnly, onProgress, db, account }) {
    messengerStopRequested = false;

    let candidates = profiles;
    if (likedOnly) {
        candidates = candidates.filter((p) => String(p.vote || '').toLowerCase() === 'like');
    }

    const limit = dmLimit && dmLimit > 0 ? dmLimit : 1;
    const toSend = candidates.slice(0, limit);

    if (toSend.length === 0) {
        massMessengerStatus = {
            running: false,
            status: likedOnly ? 'No liked profiles to message' : 'No profiles to message',
            current: 0,
            total: 0,
            results: [],
        };
        if (onProgress) onProgress(massMessengerStatus);
        return { started: true, reason: 'no_profiles', sent: 0, stopped: false };
    }

    massMessengerStatus = {
        running: true,
        current: 0,
        total: toSend.length,
        status: 'Running',
        results: [],
    };
    if (onProgress) onProgress(massMessengerStatus);

    const results = [];
    const message = 'E2E test message';

    for (let i = 0; i < toSend.length && !messengerStopRequested; i++) {
        const profile = toSend[i];
        await markDmSentByUsername(db, profile.username || profile.name, { clearError: true, tgTagged: 0 });
        await db.run(
            `INSERT INTO messages_log (url, username, name, message_text, status, timestamp, account_id, sender_name) VALUES (?, ?, ?, ?, 'sent', ?, ?, ?)`,
            [
                profile.url,
                profile.username || profile.name,
                profile.name,
                message,
                new Date().toISOString(),
                account.id,
                account.name,
            ]
        );
        logger.info(`🚀 [E2E-MASS] Отправлено: ${profile.url} (@${profile.username})`);
        results.push({ url: profile.url, success: true });
        if (onProgress) onProgress({ current: i + 1, results: [...results] });
        await wait(30);
    }

    massMessengerStatus = {
        ...massMessengerStatus,
        running: false,
        status: messengerStopRequested ? 'Stopped' : 'Done',
        results,
    };
    if (onProgress) onProgress(massMessengerStatus);

    const sent = results.filter((r) => r.success).length;
    logger.info(`✅ [E2E-MASS] Рассылка завершена. Отправлено: ${sent}/${results.length}`);
    return { started: true, sent, stopped: !!messengerStopRequested, total: results.length };
}

async function startMassMessaging(onProgress, options = {}) {
    if (massMessengerStatus.running) return { started: false, reason: 'already_running' };

    messengerStopRequested = false;
    const db = await getDB();
    const settings = await db.all(`SELECT * FROM settings`);
    const donorGroups = JSON.parse(settings.find(s => s.key === 'donorGroups')?.value || '[]');
    const donorsList = await state_1.StateManager.loadDonors();
    const humanEmulation =
        settings.find(s => s.key === 'humanEmulation')?.value === 'true' || !!options.restAfter;
    const dmLimit = options.dmLimit != null
        ? parseInt(options.dmLimit, 10)
        : parseInt(settings.find(s => s.key === 'dmLimit')?.value || '20');

    // 1. Selection with options
    // Using COLLATE NOCASE for vote to be safe, although it's usually lowercase
    // [TEMP] Send to everyone, ignoring 'like' status
    let query = `SELECT * FROM profiles WHERE (dmSent = 0 OR dmSent IS NULL)`;
    // let query = `SELECT * FROM profiles WHERE vote = 'like' COLLATE NOCASE AND (dmSent = 0 OR dmSent IS NULL)`;

    const params = [];

    if (options.cityOnly) {
        query += ` AND isInCity = 1`;
    }
    if (options.exceptCity) {
        query += ` AND (isInCity = 0 OR isInCity IS NULL)`;
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
    const wordsBlacklist = await getList('wordBlacklist.txt');
    const dmSentRows = await db.all(`
        SELECT DISTINCT ${USERNAME_SQL} AS uname
        FROM profiles
        WHERE dmSent = 1 AND username IS NOT NULL AND TRIM(username) != ''
    `);
    const dmSentUsernames = new Set(dmSentRows.map((r) => r.uname));

    const afterBlacklist =
        wordsBlacklist.length > 0
            ? profiles.filter((p) => {
                const text = `${p.name || ''} ${p.bio || ''} ${p.username || ''}`.toLowerCase();
                return !wordsBlacklist.some((kw) => text.includes(String(kw).trim().toLowerCase()));
            })
            : profiles;

    const filteredProfiles = dedupeProfilesForMessaging(
        afterBlacklist.filter((p) => {
            const uname = normalizeUsername(p.username);
            return !uname || !dmSentUsernames.has(uname);
        })
    );
    const profilesCount = filteredProfiles.length;
    logger.info(`🔍 Found ${profilesCount} profiles for mass messaging (cityOnly: ${!!options.cityOnly}, exceptCity: ${!!options.exceptCity})`);

    if (profilesCount === 0) {
        massMessengerStatus = { running: false, status: 'No profiles to message', current: 0, total: 0, results: [] };
        if (onProgress) onProgress(massMessengerStatus);
        return { started: true, reason: 'no_profiles', sent: 0, stopped: false };
    }

    const accounts = await getAllAccounts('server');
    if (accounts.length === 0) {
        logger.error('❌ [MASS MESSENGER] No accounts found with "Sender" role. Please assign accounts in Settings.');
        massMessengerStatus = { running: false, status: 'No sender accounts assigned', current: 0, total: profilesCount, results: [] };
        if (onProgress) onProgress(massMessengerStatus);
        return { started: false, reason: 'no_accounts' };
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

    if (process.env.E2E_TEST === '1' || options.e2eSimulate) {
        return runE2eMassMessaging({
            profiles: filteredProfiles,
            dmLimit,
            likedOnly: !!options.likedOnly,
            onProgress: updateStatus,
            db,
            account,
        });
    }

    updateStatus({ status: `Broadcasting with ${account.name}...` });

    let currentProcessed = 0;
    const results = [];

    const browserConfig = {
        id: account.id,
        proxy: account.proxy,
        cookies: account.cookies,
        fingerprint: account.fingerprint,
        timeouts: { pageLoad: 60000, typingDelayMin: 30, typingDelayMax: 90 },
    };

    const skipBrowser =
        options.showBrowser != null
            ? !options.showBrowser
            : (await getSetting('showBrowser')) !== true;
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
        await waitWithActivity(page, 700 + Math.random() * 600);

        const reopenPage = async (reason = 'closed') => {
            logger.warn(`⚠️ [MASS] Вкладка закрылась (${reason}). Открываем новую и продолжаем со следующего профиля.`);
            page = await context.newPage();
            await page.goto('https://www.instagram.com/', {
                waitUntil: 'domcontentloaded',
                timeout: 60000,
            });
            await waitWithActivity(page, 700 + Math.random() * 600);
            return page;
        };

        for (let i = 0; i < filteredProfiles.length && !messengerStopRequested; i++) {
            const profile = filteredProfiles[i];

            if (!page || page.isClosed()) {
                await reopenPage('before_profile');
                currentProcessed++;
                updateStatus({ current: currentProcessed });
                continue;
            }

            const freshProfile = await db.get(`SELECT dmSent, username FROM profiles WHERE url = ?`, [profile.url]);
            if (freshProfile?.dmSent === 1) {
                currentProcessed++;
                updateStatus({ current: currentProcessed });
                continue;
            }
            const freshUname = normalizeUsername(freshProfile?.username || profile.username);
            if (freshUname && dmSentUsernames.has(freshUname)) {
                await markDmSentByUsername(db, freshUname, { clearError: true });
                currentProcessed++;
                updateStatus({ current: currentProcessed });
                continue;
            }

            logger.info(`🧵 [${i + 1}/${profilesCount}] ${profile.url}`);

            try {
                const donorNames = String(profile.donor || '')
                    .split(',')
                    .map((d) => d.replace('@', '').trim())
                    .filter(Boolean);
                const primaryDonor = donorNames[0] || profile.donor || '';
                const catMsgs = findCategoryMessages(donorGroups, donorsList, primaryDonor);
                let msgs = catMsgs?.length ? catMsgs : [];

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

                if (result.reason === 'page_closed') {
                    await reopenPage('during_profile');
                    results.push({ url: profile.url, success: false, error: 'page_closed' });
                    continue;
                }

                if (result.success && result.delivered) {
                    await markDmSentByUsername(db, profile.username || profile.name, { clearError: true, tgTagged: 0 });
                    if (profile.username) dmSentUsernames.add(normalizeUsername(profile.username));
                    await db.run(
                        `INSERT INTO messages_log (url, username, name, message_text, status, timestamp, account_id, sender_name) VALUES (?, ?, ?, ?, 'sent', ?, ?, ?)`,
                        [profile.url, profile.username || profile.name, profile.name, message, new Date().toISOString(), account.id, account.name]
                    );
                    logger.info(`🚀 [ACC: ${account.name} SENT] ${profile.url} (@${profile.username})`);
                } else {
                    const errReason = result.reason || 'error';
                    if (result.reason === 'history' || result.reason === 'chat_exists' || result.reason === 'no_button') {
                        await markDmSentByUsername(db, profile.username || profile.name, { dmError: errReason });
                        if (profile.username) dmSentUsernames.add(normalizeUsername(profile.username));
                    } else if (
                        result.reason === 'delivery_failed' ||
                        result.reason === 'send_failed_ui' ||
                        result.reason === 'text_still_in_input' ||
                        result.reason === 'not_verified'
                    ) {
                        await db.run(`UPDATE profiles SET dmError = ? WHERE url = ?`, [errReason, profile.url]);
                        logger.warn(`🚫 [ACC: ${account.name}] Спамблок/недоставка: ${profile.url}`);
                    } else {
                        await db.run(`UPDATE profiles SET dmError = ? WHERE url = ?`, [errReason, profile.url]);
                    }
                }

                results.push({
                    url: profile.url,
                    success: !!(result.success && result.delivered),
                });
            } catch (err) {
                if (/Target page, context or browser has been closed|Page closed|Target closed/i.test(err.message || '')) {
                    await reopenPage('exception').catch((e) => {
                        logger.warn(`⚠️ [MASS] Не удалось открыть новую вкладку: ${e.message}`);
                    });
                    results.push({ url: profile.url, success: false, error: 'page_closed' });
                    continue;
                }
                logger.error(`Task error for ${profile.url} on ${account.name}: ${err.message}`);
                results.push({ url: profile.url, success: false, error: err.message });
            } finally {
                currentProcessed++;
                updateStatus({ current: currentProcessed });

                const hasMore = i < filteredProfiles.length - 1 && !messengerStopRequested;
                if (hasMore) {
                    const [gapMin, gapMax] = humanEmulation ? PROFILE_GAP.human : PROFILE_GAP.normal;
                    const delay = gapMin + Math.random() * (gapMax - gapMin);
                    logger.info(`👤 [ANTIFRAUD] Пауза ${Math.round(delay / 1000)}с до следующего профиля`);
                    if (!page || page.isClosed()) {
                        await reopenPage('before_gap');
                    } else {
                        await waitWithActivity(page, delay);
                    }
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
    return {
        started: true,
        sent: successfulTotal,
        stopped: !!messengerStopRequested,
        total: results.length,
    };
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
