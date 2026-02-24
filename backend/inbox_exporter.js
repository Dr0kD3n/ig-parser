const fs = require('fs');
const path = require('path');
const { createBrowserContext } = require('./lib/browser');
const { getDB } = require('./lib/db');
const { getSetting } = require('./lib/config');
const { wait } = require('./lib/utils');
const { saveCrashReport } = require('./lib/reporter');
const { updateChatStats } = require('./lib/stats');

const SELECTORS = {
    dialogRow: 'div[role="listitem"], a[href*="/direct/t/"], div[style*="height: 72px"], div[role="button"]:has(span[dir="auto"])',
    dialogList: 'div[aria-label="Chats"], div[aria-label="Чаты"], div[role="tabpanel"], div[style*="overflow-y: auto"]',
    messages: 'div[role="row"], div[dir="auto"]',
    messagesContainer: 'div[role="main"]',
    tabGeneral: 'div[role="tab"]:has-text("Общие"), div[role="tab"]:has-text("General"), span:has-text("General"), span:has-text("Общие")',
    modalCloseButtons: [
        'button:has-text("Not Now")',
        'button:has-text("Не сейчас")',
        'button:has-text("Cancel")',
        'button:has-text("Закрыть")',
        'button:has-text("Скрыть")',
        'div[role="dialog"] button:has-text("Not Now")',
        'div[role="dialog"] button:has-text("Не сейчас")'
    ]
};

async function handleModals(page) {
    console.log('🛡️ [INBOX_EXPORTER] Checking for blocking modals...');
    const selectors = SELECTORS.modalCloseButtons;
    for (const selector of selectors) {
        try {
            const btn = page.locator(selector).first();
            if (await btn.isVisible({ timeout: 500 })) {
                console.log(`👆 [INBOX_EXPORTER] Dismissing modal with: ${selector}`);
                await btn.click({ timeout: 2000 });
                await wait(1000); // Краткая пауза после клика
                return true; // Выходим сразу после закрытия одного окна
            }
        } catch (e) { }
    }
    return false;
}

async function exportInbox() {
    console.log('📄 [INBOX_EXPORTER] Запуск парсера сообщений (Deep Scan)...');
    const db = await getDB();
    const account = await db.get('SELECT * FROM accounts WHERE name = ?', ['AU']);

    if (!account) {
        console.error('❌ [INBOX_EXPORTER] Аккаунт "AU" не найден.');
        process.exit(1);
    }

    const showBrowser = await getSetting('showBrowser');
    const headless = !(showBrowser === 'true' || showBrowser === true);

    const config = {
        proxy: account.proxy ? parseProxy(account.proxy) : null,
        cookies: parseCookies(account.cookies),
        fingerprint: account.fingerprint ? JSON.parse(account.fingerprint) : null
    };

    console.log(`🚀 [INBOX_EXPORTER] Запуск браузера для: ${account.name}`);
    const { browser, context } = await createBrowserContext(config, headless);
    const page = await context.newPage();

    try {
        // Устанавливаем размер окна побольше для удобства пагинации
        await page.setViewportSize({ width: 1280, height: 900 });

        console.log('🌐 [INBOX_EXPORTER] Переход в Instagram...');

        // Попытка зайти с ретраями
        let success = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                console.log(`📡 [INBOX_EXPORTER] Попытка ${attempt}...`);
                await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
                success = true;
                break;
            } catch (e) {
                console.warn(`⚠️ [INBOX_EXPORTER] Попытка ${attempt} не удалась: ${e.message}`);
                await wait(5000 * attempt);
            }
        }

        if (!success) {
            throw new Error('Не удалось загрузить Instagram после 3 попыток. Проверьте прокси или соединение.');
        }

        await wait(5000);
        await page.screenshot({ path: 'home_loaded.jpg' });

        // Переходим сразу в Inbox для экономии времени
        console.log('📥 [INBOX_EXPORTER] Переход в Direct Inbox...');
        await page.goto('https://www.instagram.com/direct/inbox/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        await wait(3000); // Даем немного времени на первичную прогрузку

        // Закрываем мешающие окна
        await handleModals(page);
        await page.screenshot({ path: 'inbox_after_modal.jpg' });

        const results = [];

        // Обрабатываем Primary
        console.log('📥 [INBOX_EXPORTER] Парсинг вкладки "Primary"...');
        await processTab(page, 'Primary', results);

        // Переключаемся на General
        const generalTab = page.locator(SELECTORS.tabGeneral).first();
        if (await generalTab.isVisible()) {
            console.log('📥 [INBOX_EXPORTER] Переход во вкладку "General"...');
            await generalTab.click();
            await wait(5000);
            await handleModals(page); // Проверяем модалки после перехода
            await processTab(page, 'General', results);
        }

        if (results.length > 0) {
            saveToCSV(results);
            console.log(`✅ [INBOX_EXPORTER] Успешно собрано ${results.length} сообщений.`);
        } else {
            console.log('❌ [INBOX_EXPORTER] Сообщений не найдено.');
        }

    } catch (error) {
        console.error('💥 [INBOX_EXPORTER] Ошибка:', error.message);
        await saveCrashReport(page, error, 'inbox_exporter');
    } finally {
        await browser.close();
        process.exit(0);
    }
}

async function processTab(page, tabName, results) {
    let processedChats = new Set();

    // Скроллим список чатов для подгрузки (небольшая имитация)
    const listSelector = SELECTORS.dialogList;
    try {
        await page.waitForSelector(SELECTORS.dialogRow, { timeout: 20000 });
    } catch (e) {
        console.log(`⚠️ Вкладка ${tabName} пуста или не загрузилась. Пробуем еще раз закрыть модалки...`);
        await handleModals(page);
        try {
            await page.waitForSelector(SELECTORS.dialogRow, { timeout: 10000 });
        } catch (e2) {
            console.log(`❌ Вкладка ${tabName} действительно пуста.`);
            return;
        }
    }

    for (let scrollStep = 0; scrollStep < 3; scrollStep++) {
        let dialogs = await page.locator(SELECTORS.dialogRow).all();
        console.log(`🔍 [${tabName}] Найдено ${dialogs.length} диалогов на шаге ${scrollStep + 1}`);

        for (let i = 0; i < dialogs.length; i++) {
            try {
                // Пытаемся получить имя чата (улучшено)
                dialogs = await page.locator(SELECTORS.dialogRow).all();
                const dialog = dialogs[i];
                if (!dialog) continue;

                const nameNodes = await dialog.locator('span[dir="auto"]').all();
                let chatName = 'Unknown';
                for (const node of nameNodes) {
                    const text = (await node.innerText().catch(() => '')).trim();
                    // Пропускаем пустые, слишком короткие или похожие на время, а также заметки
                    if (text && text.length > 1 && !/^\d+[dhwmsчднм]$/.test(text) && !text.includes('·')) {
                        chatName = text;
                        break;
                    }
                }

                // Пропускаем "Ваша заметка" и аналогичные элементы
                if (chatName.includes('заметка') || chatName.includes('note') || chatName === 'Ваша заметка' || chatName === 'Новая заметка') {
                    console.log(`   ⏭️ Пропуск заметки: ${chatName}`);
                    continue;
                }

                if (processedChats.has(chatName)) continue;
                processedChats.add(chatName);

                console.log(`   👉 Обработка чата: ${chatName}`);

                // Прокручиваем к элементу
                await dialog.scrollIntoViewIfNeeded().catch(() => { });
                await wait(500);

                // Кликаем максимально надежно
                const clickTarget = dialog.locator('a[href*="/direct/t/"], div[role="button"]').first();
                if (await clickTarget.isVisible()) {
                    await clickTarget.click({ force: true });
                } else {
                    const box = await dialog.boundingBox();
                    if (box) {
                        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                    } else {
                        await dialog.click({ force: true });
                    }
                }

                // Ждем появления сообщений, а не фиксированное время
                try {
                    await page.waitForSelector('*[dir="auto"]', { state: 'visible', timeout: 3000 });
                } catch (e) {
                    await wait(1500); // Fallback если селектор не сработал сразу
                }

                // Дебаг-скриншот
                await page.screenshot({ path: `chat_debug_last.jpg` });

                // Сбор сообщений (максимально агрессивный поиск)
                // Ищем все блоки с текстом, которые находятся в правой части экрана (вне сайдбара)
                const messageBlocks = await page.locator('div[role="main"] *[dir="auto"], div[aria-label="Messages"] *[dir="auto"], div[aria-label="Сообщения"] *[dir="auto"]').all();

                // Если ничего не нашли, пробуем самый широкий поиск
                let blocksToProcess = messageBlocks;
                if (blocksToProcess.length === 0) {
                    console.log(`      ⚠️ Целевые контейнеры не сработали. Ищем по всем блокам [dir="auto"]...`);
                    blocksToProcess = await page.locator('*[dir="auto"]').all();
                }

                console.log(`      📝 Найдено ${blocksToProcess.length} потенциальных текстовых блоков`);

                const seenTexts = new Set();
                let collectedCount = 0;

                for (const block of blocksToProcess) {
                    try {
                        const box = await block.boundingBox();
                        if (!box || box.x < 250) continue;

                        const text = (await block.innerText().catch(() => '')).trim();

                        if (text && text.length > 0) {
                            if ([chatName, 'Seen', 'Sent', 'Delivered', 'Просмотрено', 'Отправлено'].includes(text)) continue;
                            if (text.includes('Опубликовано для следующей аудитории') || text.includes('Напишите сообщение') || text === 'Active now' || text === 'В сети') continue;
                            if (seenTexts.has(text)) continue;
                            seenTexts.add(text);

                            const isOutgoing = await block.evaluate(el => {
                                let curr = el;
                                for (let i = 0; i < 10; i++) {
                                    if (!curr) break;
                                    const s = window.getComputedStyle(curr);
                                    if (s.justifyContent === 'flex-end' || s.alignItems === 'flex-end') return true;
                                    const bg = s.backgroundColor;
                                    // Синий, черный или специфические цвета исходящих
                                    if (bg.includes('rgb(0, 149, 246)') || bg.includes('rgb(55, 151, 240)') || bg.includes('rgb(38, 38, 38)') || bg.includes('rgb(55, 151, 240)')) return true;
                                    curr = curr.parentElement;
                                }
                                return false;
                            }).catch(() => false);

                            results.push({
                                tab: tabName,
                                chat: chatName,
                                sender: isOutgoing ? 'Me' : 'Partner',
                                text: text.replace(/\n/g, ' ').trim()
                            });
                            collectedCount++;
                        }
                    } catch (msgErr) { }
                }

                // Update database immediately
                const chatSeq = results.filter(r => r.chat === chatName);
                if (chatSeq.length > 0) {
                    const firstOwn = chatSeq.find(m => m.sender === 'Me');
                    const threadId = `/direct/t/${chatName.toLowerCase().replace(/[^a-z0-9]/g, '')}`; // Hacky threadId for inbox_exporter as it doesn't have URLs easily available per row in current logic
                    // Wait, let's see if we can get a better threadId.
                    // The results in inbox_exporter are {tab, chat, sender, text}.
                    // Actually, updateChatStats expects messages as {text, isOwn}.
                    const formattedMsgs = chatSeq.map(m => ({ text: m.text, isOwn: m.sender === 'Me' }));
                    await updateChatStats(chatName, firstOwn ? firstOwn.text : null, formattedMsgs);
                }

                console.log(`      ✅ Собрано ${collectedCount} уникальных сообщений`);
            } catch (e) {
                console.warn(`      ⚠️ Ошибка в чате ${i}:`, e.message);
            }
        }

        // Скроллим вниз
        await page.evaluate((sel) => {
            const list = document.querySelector(sel);
            if (list) list.scrollBy(0, 1000);
        }, listSelector).catch(() => { });
        await wait(1000);
    }
}

function saveToCSV(data) {
    const csvHeader = 'Tab,Chat,Sender,Message\n';
    const csvRows = data.map(row => {
        const chat = (row.chat || '').replace(/"/g, '""');
        const text = (row.text || '').replace(/"/g, '""');
        return `"${row.tab}","${chat}","${row.sender}","${text}"`;
    }).join('\n');

    const filePath = path.join(__dirname, 'inbox_export.csv');
    fs.writeFileSync(filePath, '\ufeff' + csvHeader + csvRows, 'utf8');
    console.log(`📄 Данные сохранены в CSV: ${filePath}`);
}

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

exportInbox();
