const { createBrowserContext, startLiveView } = require('./lib/browser');
const logger = require('./lib/logger');
const { getDB } = require('./lib/db');
const { getAllAccounts, getSetting } = require('./lib/config');
const { wait, humanType } = require('./lib/utils');
const { saveCrashReport } = require('./lib/reporter');
const { updateChatStats } = require('./lib/stats');
const path = require('path');

const CONFIG = {
    timeouts: {
        pageLoad: 60000,
        element: 5000,
        typingDelayMin: 50,
        typingDelayMax: 180,
    },
    selectors: {
        inboxLink: 'a[href^="/direct/inbox/"]',
        dialogRow: 'div[role="listitem"]',
        dialogLink: 'a[href^="/direct/t/"]',
        chatInput: 'div[role="textbox"][contenteditable="true"]',
        messageRow: 'div[role="row"]',
        messageText: 'div[dir="auto"]',
        ownMessageContainer: 'div[class*="--align-end"]', // Helper class often used for own messages, or we can check layout
    }
};

let db = null;

async function checkDialogs() {
    db = await getDB();
    logger.info('✅ [CHECKER] Старт работы парсера Inbox (Статистики)');

    try {
        const accounts = await getAllAccounts('checker');
        const showBrowser = await getSetting('showBrowser');
        const headless = !(showBrowser === 'true' || showBrowser === true);

        if (accounts.length === 0) {
            console.log('❌ [CHECKER] Нет аккаунтов для чекера (active_checker). Назначьте аккаунт в настройках!');
            return;
        }

        logger.info(`✅ [CHECKER] Найдено аккаунтов чекера: ${accounts.length}`);

        for (let aIdx = 0; aIdx < accounts.length; aIdx++) {
            const accountConfig = accounts[aIdx];
            logger.info(`\n\n=== 🛠️ [CHECKER] ЗАПУСК АККАУНТА ${aIdx + 1}/${accounts.length} ===`);

            const reqConfig = { ...CONFIG };
            reqConfig.proxy = accountConfig.proxy;
            reqConfig.cookies = accountConfig.cookies || [];
            reqConfig.fingerprint = accountConfig.fingerprint;

            logger.info(`📡 [CHECKER] Прокси: ${reqConfig.proxy ? reqConfig.proxy.server : 'ПРЯМОЕ СОЕДИНЕНИЕ'}`);
            logger.info(`🍪 [CHECKER] Загружено куки: ${reqConfig.cookies.length}`);

            if (reqConfig.cookies.length === 0) {
                logger.warn('⚠️ [CHECKER] Нет куков для этого аккаунта. Пропускаем.');
                continue;
            }

            let browser = null;
            let context = null;

            try {
                const bRes = await createBrowserContext(reqConfig, headless);
                browser = bRes.browser;
                context = bRes.context;

                const page = await context.newPage();

                logger.info('🌐 [CHECKER] Переход в Inbox...');
                await page.goto('https://www.instagram.com/direct/inbox/', { waitUntil: 'domcontentloaded', timeout: CONFIG.timeouts.pageLoad });
                await wait(5000);
                await page.screenshot({ path: path.join(__dirname, '..', 'data', 'screenshots', 'checker_test.jpg'), type: 'jpeg', quality: 50 });

                // Deal with "Not now" notifications modal if appears
                try {
                    const notNowBtn = page.locator('button:has-text("Не сейчас"), button:has-text("Not Now")').first();
                    if (await notNowBtn.isVisible({ timeout: 3000 })) {
                        await notNowBtn.click();
                        await wait(1000);
                    }
                } catch (e) { }

                logger.info('🔍 [CHECKER] Ожидание загрузки списка диалогов...');
                try {
                    await page.waitForSelector(CONFIG.selectors.dialogRow, { state: 'visible', timeout: 15000 });
                } catch (e) {
                    logger.warn('⚠️ [CHECKER] Диалогов не найдено или Inbox пуст для этого аккаунта.');
                    continue;
                }

                let processedUrls = new Set();
                let dialogElements = await page.locator(CONFIG.selectors.dialogRow).all();
                logger.info(`✅ [CHECKER] Найдено диалогов на экране: ${dialogElements.length}`);

                for (let i = 0; i < dialogElements.length; i++) {
                    // Re-query to prevent stale elements
                    dialogElements = await page.locator(CONFIG.selectors.dialogRow).all();
                    if (i >= dialogElements.length) break;

                    const row = dialogElements[i];
                    const linkLoc = row.locator(CONFIG.selectors.dialogLink).first();

                    if (!await linkLoc.isVisible()) continue;

                    const href = await linkLoc.getAttribute('href');
                    if (!href || processedUrls.has(href)) continue;
                    processedUrls.add(href);

                    logger.info(`\n📨 [CHECKER] Открываем диалог ${i + 1}/${dialogElements.length}...`);
                    await linkLoc.click();
                    await wait(2500);

                    // Fetch messages in the open chat
                    await page.waitForSelector(CONFIG.selectors.messageRow, { state: 'attached', timeout: 5000 }).catch(() => null);

                    // Scroll to top to load history
                    logger.info('   ⬆️ Листаем вверх для загрузки истории...');
                    const scrollContainer = page.locator('div[role="presentation"] > div > div[role="presentation"]').last();
                    let lastHeight = 0;
                    for (let s = 0; s < 10; s++) { // Scroll up to 10 times
                        await scrollContainer.evaluate(node => node.scrollTop = 0);
                        await wait(1500);
                        const newHeight = await scrollContainer.evaluate(node => node.scrollHeight);
                        if (newHeight === lastHeight) break;
                        lastHeight = newHeight;
                    }

                    const msgs = await page.locator(CONFIG.selectors.messageRow).all();
                    if (msgs.length === 0) {
                        logger.info('   ➖ Пустой диалог. Пропускаем.');
                        continue;
                    }

                    // Extract logic
                    const chatBox = await scrollContainer.boundingBox();
                    const chatCenter = chatBox ? chatBox.x + (chatBox.width / 2) : 500;

                    const seq = [];
                    for (const msg of msgs) {
                        const textNode = msg.locator(CONFIG.selectors.messageText).first();
                        if (!await textNode.isVisible()) continue;

                        const text = await textNode.innerText();
                        if (!text || text.trim() === '') continue;

                        const box = await textNode.boundingBox();
                        if (!box) continue;

                        const isOwn = (box.x + box.width / 2) > chatCenter;
                        seq.push({ text: text.trim(), isOwn });
                    }

                    if (seq.length === 0) {
                        logger.info('   ➖ Текстовых сообщений не найдено.');
                        continue;
                    }

                    const totalMessages = seq.length;
                    const firstOwnMessage = seq.find(m => m.isOwn);

                    if (!firstOwnMessage) {
                        logger.info('   ➖ Мы не писали первыми. Пропускаем.');
                        continue;
                    }

                    const templateText = firstOwnMessage.text;
                    let hasReply = false;
                    let continuedAfterReply = false;

                    const firstOwnIndex = seq.indexOf(firstOwnMessage);
                    const messagesAfterFirst = seq.slice(firstOwnIndex + 1);

                    for (const m of messagesAfterFirst) {
                        if (!m.isOwn) {
                            hasReply = true;
                        } else if (hasReply && m.isOwn) {
                            continuedAfterReply = true;
                        }
                    }

                    let finalStatus = 'sent';
                    if (continuedAfterReply) finalStatus = 'continued';
                    else if (hasReply) finalStatus = 'replied';

                    logger.info(`   📝 Первый: "${templateText.substring(0, 30)}..."`);
                    logger.info(`   📊 Сообщений: ${totalMessages}${totalMessages > 5 ? ' (>5!)' : ''}`);

                    await updateChatStats(href, templateText, seq);
                    logger.info(`   🔄 Обновлена статистика в БД`);
                }
            } catch (err) {
                logger.error(`💥 [CHECKER ERROR] Ошибка при обработке аккаунта: ${err.message}`);
                // Try to get the active page from context if available
                let activePage = null;
                if (context) {
                    const pages = context.pages();
                    if (pages.length > 0) activePage = pages[pages.length - 1];
                }
                await saveCrashReport(activePage, err, 'checker_account');
            } finally {
                if (context) {
                    await context.close().catch(() => { });
                }
                if (browser) {
                    await browser.close().catch(() => { });
                    logger.info('🔌 [CHECKER] Инстанс браузера для аккаунта закрыт.');
                }
            }
        }

        logger.info('\n🎉 [CHECKER] ЗАВЕРШЕНА проверка всех аккаунтов.');
    } catch (e) {
        logger.error(`💥 [CHECKER ERROR] КРИТИЧЕСКАЯ ОШИБКА: ${e.message}`);
    } finally {
        process.exit(0);
    }
}

checkDialogs();
