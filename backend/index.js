const fs = require('fs/promises');
const path = require('path');
const { getProxy, getCookies, getList, normalizeUrl } = require('./lib/config');
const { StateManager } = require('./lib/state');
const { createBrowserContext, optimizeContextForScraping } = require('./lib/browser');
const { shuffleArray, wait } = require('./lib/utils');

const getDynamicConfig = async () => {
    const width = 1280 + Math.floor(Math.random() * 150);
    const height = 900 + Math.floor(Math.random() * 100);

    const rawNames = await getList('names.txt');
    const shuffledNames = shuffleArray(rawNames);

    return {
        viewport: { width, height },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        timeouts: { pageLoad: 25000, element: 10000, inputWait: 5000 },
        scroll: { maxAttempts: 15, maxRetries: 3 },
        proxy: await getProxy('index'),
        cookies: await getCookies('index'),
        target: {
            cityKeywords: await getList('cityKeywords.txt'),
            names: shuffledNames
        }
    };
};

const SELECTORS = {
    HEADER: 'header',
    DIALOG: 'div[role="dialog"]',
    SEARCH_INPUT: 'div[role="dialog"] input',
    FOLLOWERS_LINK: 'a[href*="/followers/"]',
    LOADER: 'div[role="dialog"] [role="progressbar"], div[role="dialog"] svg[aria-label="Loading..."], div[role="dialog"] svg[aria-label="Загрузка..."]'
};

const randomDelay = (min = 100, max = 300) => wait(min + Math.random() * (max - min));

const extractVisibleCandidates = () => {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return [];
    const results = [];
    const canvases = dialog.querySelectorAll('canvas');
    canvases.forEach(canvas => {
        const storyBtn = canvas.closest('div[role="button"]');
        if (!storyBtn || storyBtn.getAttribute('aria-disabled') === 'true') return;
        let parent = storyBtn.parentElement;
        for (let i = 0; i < 6; i++) {
            if (!parent) break;
            const link = parent.querySelector('a[href^="/"]:not([role="button"])');
            if (link && link.innerText.trim().length > 0) {
                const href = link.getAttribute('href');
                if (href && !href.includes('followers')) results.push(`https://www.instagram.com${href}`);
                break;
            }
            parent = parent.parentElement;
        }
    });
    return results;
};

const scrollAndCollectUrls = async (page, config) => {
    const collectedUrls = new Set();
    let previousHeight = 0;
    let sameHeightCount = 0;

    console.log(`      🔽 Начинаем скролл списка...`);

    for (let i = 0; i < config.scroll.maxAttempts; i++) {
        const visible = await page.evaluate(extractVisibleCandidates);
        visible.forEach(url => collectedUrls.add(url));

        const scrolledHeight = await page.evaluate(() => {
            const dialog = document.querySelector('div[role="dialog"]');
            const scrollable = dialog ? Array.from(dialog.querySelectorAll('div')).find(el => {
                const s = window.getComputedStyle(el);
                return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
            }) : null;
            if (scrollable) {
                scrollable.scrollTop = scrollable.scrollHeight;
                return scrollable.scrollHeight;
            }
            return false;
        });

        if (!scrolledHeight) await page.mouse.wheel(0, 600);
        await wait(50);

        try { await page.waitForSelector(SELECTORS.LOADER, { state: 'hidden', timeout: 3000 }); } catch (e) { }

        await wait(50);

        const newHeight = await page.evaluate(() => {
            const dialog = document.querySelector('div[role="dialog"]');
            const scrollable = dialog ? Array.from(dialog.querySelectorAll('div')).find(el => {
                const s = window.getComputedStyle(el);
                return (s.overflowY === 'auto' || s.overflowY === 'scroll');
            }) : null;
            return scrollable ? scrollable.scrollHeight : false;
        });

        if (newHeight === previousHeight) {
            sameHeightCount++;
            if (sameHeightCount >= config.scroll.maxRetries) {
                console.log(`      🛑 Достигнут конец списка (или лимит подгрузки).`);
                break;
            }
            await wait(250);
        } else {
            sameHeightCount = 0;
        }
        previousHeight = newHeight;

        if ((i + 1) % 3 === 0) {
            console.log(`      🔄 Скролл ${i + 1}/${config.scroll.maxAttempts} | Собрано профилей: ${collectedUrls.size}`);
        }
    }
    return Array.from(collectedUrls);
};

const analyzeProfile = async (context, url, config) => {
    if (StateManager.has(url)) return;
    await StateManager.add(url);

    const page = await context.newPage();
    console.log(`      👀 Открываем профиль: ${url}`);

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeouts.pageLoad });
        await page.waitForSelector('header', { timeout: 10000 });
        await wait(150);

        const username = url.split('/').filter(Boolean).pop() || '';

        const extracted = await page.evaluate(() => {
            let bioClean = '';
            let fullSearchText = '';

            const header = document.querySelector('header');
            if (header) {
                fullSearchText = header.innerText || '';

                const ulList = header.querySelector('ul');
                if (ulList && ulList.nextElementSibling) {
                    bioClean = ulList.nextElementSibling.innerText || '';
                } else {
                    const autoSpans = Array.from(header.querySelectorAll('span[dir="auto"]'));
                    const spanTexts = autoSpans.map(s => s.innerText.trim()).filter(Boolean);
                    if (spanTexts.length > 0) {
                        bioClean = spanTexts.join(' | ');
                    }
                }

                const highlightsBlock = header.nextElementSibling;
                if (highlightsBlock) {
                    fullSearchText += ' ' + (highlightsBlock.innerText || '');
                }
            }

            return {
                fullSearchText: fullSearchText.replace(/\d+/g, ' '),
                bioClean: bioClean.replace(/\n/g, ' ').trim()
            };
        });

        const searchString = `${extracted.fullSearchText} ${username}`.toLowerCase();
        const isTarget = config.target.cityKeywords.some(kw => searchString.includes(kw.toLowerCase()));

        if (isTarget) {
            console.log(`         ✅ Целевой профиль! Парсим данные (ищем фото)...`);
            const name = await page.locator('header h2, header h1, header span[dir="auto"]').first().innerText().catch(() => username);

            const bio = extracted.bioClean;

            const profileData = { name, bio, photo: photoUrl, url };

            await StateManager.saveResult(profileData);
        } else {
            console.log(`         ➖ Пропуск: нет целевых слов.`);
        }
    } catch (e) {
        if (!e.message.includes('Timeout')) {
            console.error(`         ❌ Ошибка анализа профиля: ${e.message.split('\n')[0]}`);
        } else {
            console.error(`         ❌ Ошибка: Timeout при загрузке профиля.`);
        }
    } finally {
        await page.close();
    }
};

const processDonor = async (context, donorUrl, config) => {
    console.log(`\n==============================================`);
    console.log(`📂 ОТКРЫВАЕМ ДОНОРА: ${donorUrl}`);
    console.log(`==============================================`);
    const page = await context.newPage();
    try {
        await page.goto(donorUrl, { waitUntil: 'domcontentloaded' });
        console.log(`   ✅ Страница донора загружена. Ищем кнопку подписчиков...`);

        const followersBtn = page.locator(SELECTORS.FOLLOWERS_LINK);
        await followersBtn.waitFor({ state: 'visible' });
        await followersBtn.click();

        await page.waitForSelector('div[role="dialog"]');
        console.log(`   ✅ Список подписчиков открыт.`);

        const searchInput = page.locator(SELECTORS.SEARCH_INPUT).first();
        await searchInput.waitFor({ state: 'visible', timeout: config.timeouts.inputWait });

        for (const name of config.target.names) {
            console.log(`\n   🔎 ПОИСК ПО ИМЕНИ: "${name}"`);

            await searchInput.click({ clickCount: 3 });
            await page.keyboard.press('Backspace');

            try { await page.waitForSelector(SELECTORS.LOADER, { state: 'hidden', timeout: 2000 }); } catch (e) { }

            const typeDelay = Math.floor(Math.random() * (60 - 20 + 1) + 20);
            await searchInput.pressSequentially(name, { delay: typeDelay });

            console.log(`      ⏳ Ждем выдачу результатов от Инстаграма...`);
            try { await page.waitForSelector(SELECTORS.LOADER, { state: 'hidden', timeout: 3000 }); } catch (e) { }
            await wait(50);

            const candidates = await scrollAndCollectUrls(page, config);

            const newCandidates = candidates.filter(url => !StateManager.has(url));
            const skippedCount = candidates.length - newCandidates.length;

            console.log(`      📊 ИТОГИ СБОРА ССЫЛОК:`);
            console.log(`         • Всего найдено (со сторис): ${candidates.length}`);
            console.log(`         • Пропущено (уже в истории): ${skippedCount}`);
            console.log(`         • Идем проверять: ${newCandidates.length}`);

            if (newCandidates.length === 0) {
                console.log(`      ⏭️ Новых профилей нет, переходим к следующему имени.`);
                continue;
            }

            console.log(`      🚀 Обрабатываем новые профили пачками по 3 штуки (экономия ОЗУ)...`);
            const CHUNK_SIZE = 3;
            for (let i = 0; i < newCandidates.length; i += CHUNK_SIZE) {
                const chunk = newCandidates.slice(i, i + CHUNK_SIZE);
                await Promise.all(chunk.map(url => analyzeProfile(context, url, config)));
                await randomDelay(100, 300);
            }
        }
    } catch (e) {
        console.error(`   ❌ КРИТИЧЕСКАЯ ОШИБКА ДОНОРА: ${e.message}`);
    } finally {
        await page.close();
        console.log(`   🚪 Донор закрыт.`);
    }
};

const run = async () => {
    console.log('🚀 ЗАПУСК СКРЕЙПЕРА (STEALTH MODE + LOGS)...');
    console.log('----------------------------------------------');
    const CONFIG = await getDynamicConfig();

    await StateManager.init();
    const donors = await StateManager.loadDonors();

    if (!donors.length) {
        console.log('⚠️ [ОШИБКА] Список доноров в config/profiles.txt пуст.');
        return;
    }
    console.log(`🎯 Загружено доноров: ${donors.length}`);

    console.log('🌐 Запуск браузера (Фоновый режим / Headless)...');
    console.log(`📡 Прокси: ${CONFIG.proxy ? CONFIG.proxy.server : 'ПРЯМОЕ СОЕДИНЕНИЕ'}`);
    console.log(`🍪 Загружено куки: ${CONFIG.cookies.length}`);

    const { browser, context } = await createBrowserContext(CONFIG, true);
    await optimizeContextForScraping(context);

    for (const donorUrl of donors) {
        if (StateManager.hasDonor(donorUrl)) {
            console.log(`\n⏭️ Донор ${donorUrl} уже был обработан ранее, пропускаем.`);
            continue;
        }
        await processDonor(context, donorUrl, CONFIG);
        await StateManager.addDonor(donorUrl);
    }

    await browser.close();
    console.log('\n✅ ========================================== ✅');
    console.log('👋 РАБОТА ПОЛНОСТЬЮ ЗАВЕРШЕНА! Все результаты сохранены.');
    console.log('✅ ========================================== ✅');
};

run().catch(console.error);