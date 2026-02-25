const fs = require('fs/promises');
const path = require('path');
const { getProxy, getCookies, getList, normalizeUrl, getSetting, getAllAccounts } = require('./lib/config');
const { StateManager } = require('./lib/state');
const { createBrowserContext, optimizeContextForScraping, startLiveView, checkLoginPage, takeLiveScreenshot } = require('./lib/browser');
const { shuffleArray, wait } = require('./lib/utils');
const logger = require('./lib/logger');
const { saveCrashReport } = require('./lib/reporter');

class RotateAccountError extends Error {
    constructor(reason, remainingNames) {
        super(`Rotate Account: ${reason}`);
        this.name = 'RotateAccountError';
        this.reason = reason;
        this.remainingNames = remainingNames;
    }
}

const getDynamicConfig = async () => {
    const width = 1280 + Math.floor(Math.random() * 150);
    const height = 900 + Math.floor(Math.random() * 100);

    const rawNames = await getList('names.txt');
    const shuffledNames = shuffleArray(rawNames);

    return {
        viewport: { width, height },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0',
        timeouts: { pageLoad: 25000, element: 15000, inputWait: 15000 },
        scroll: { maxAttempts: 15, maxRetries: 3 },
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
    FOLLOWERS_LINK: 'a[href$="/followers/"]',
    LOADER: 'div[role="dialog"] [role="progressbar"], div[role="dialog"] svg[aria-label="Loading..."], div[role="dialog"] svg[aria-label="Загрузка..."]'
};

const checkSkipSignal = () => {
    const flagPath = path.join(__dirname, 'skip_donor.flag');
    if (require('fs').existsSync(flagPath)) {
        try {
            require('fs').unlinkSync(flagPath);
            return true;
        } catch (e) { }
    }
    return false;
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

    logger.info(`      🔽 Начинаем скролл списка...`);

    for (let i = 0; i < config.scroll.maxAttempts; i++) {
        if (checkSkipSignal()) return [];

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
                logger.info(`      🛑 Достигнут конец списка (или лимит подгрузки).`);
                break;
            }
            await wait(250);
        } else {
            sameHeightCount = 0;
        }
        previousHeight = newHeight;

        if ((i + 1) % 3 === 0) {
            logger.info(`      🔄 Скролл ${i + 1}/${config.scroll.maxAttempts} | Собрано профилей: ${collectedUrls.size}`);
        }
    }
    return Array.from(collectedUrls);
};

const analyzeProfile = async (context, url, config) => {
    if (StateManager.has(url)) return;
    await StateManager.add(url);

    const page = await context.newPage();
    logger.info(`      👀 Открываем профиль: ${url}`);

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeouts.pageLoad });
        await takeLiveScreenshot(page);
        await page.waitForSelector('header', { timeout: 10000 });
        await takeLiveScreenshot(page);
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
            logger.info(`         ✅ Целевой профиль! Парсим данные (ищем фото)...`);
            const name = await page.locator('header h2, header h1, header span[dir="auto"]').first().innerText().catch(() => username);
            const photoUrl = await page.evaluate(async (uname) => {
                let pUrl = '';
                try {
                    const res = await fetch(`/api/v1/users/web_profile_info/?username=${uname}`, {
                        headers: { 'X-IG-App-ID': '936619743392459' }
                    });
                    if (res.ok) {
                        const json = await res.json();
                        if (json?.data?.user?.profile_pic_url_hd) {
                            pUrl = json.data.user.profile_pic_url_hd;
                        }
                    }
                } catch (e) { }

                if (!pUrl) {
                    const html = document.documentElement.innerHTML;
                    const matches = [...html.matchAll(/"profile_pic_url_hd":"([^"]+)"/g)];
                    if (matches.length > 0) {
                        const rawUrl = matches[matches.length - 1][1];
                        try {
                            pUrl = JSON.parse('"' + rawUrl + '"');
                        } catch (e) {
                            pUrl = rawUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                        }
                    }
                }

                if (!pUrl) {
                    const header = document.querySelector('header');
                    if (header) {
                        const img = header.querySelector('img');
                        if (img) pUrl = img.getAttribute('src') || img.src || '';
                    }
                }
                return pUrl;
            }, username).catch(() => '');

            const bio = extracted.bioClean;

            const profileData = { name, bio, photo: photoUrl, url };

            await StateManager.saveResult(profileData);
        } else {
            logger.info(`         ➖ Пропуск: нет целевых слов.`);
        }
    } catch (e) {
        if (!e.message.includes('Timeout')) {
            logger.error(`         ❌ Ошибка анализа профиля: ${e.message.split('\n')[0]}`);
        } else {
            logger.error(`         ❌ Ошибка: Timeout при загрузке профиля.`);
        }
        await saveCrashReport(page, e, `analyze_profile_${url.split('/').filter(Boolean).pop()}`);
    } finally {
        await page.close();
    }
};

const processDonor = async (context, donorUrl, config, totalAccounts = 0) => {
    logger.info(`\n==============================================`);
    logger.info(`📂 ОТКРЫВАЕМ ДОНОРА: ${donorUrl}`);
    logger.info(`==============================================`);
    const page = await context.newPage();
    let shouldSkipDonor = false;
    try {
        await page.goto(donorUrl, { waitUntil: 'domcontentloaded' });
        await takeLiveScreenshot(page);

        // 1. Проверка на страницу логина
        if (await checkLoginPage(page)) {
            throw new RotateAccountError('Session expired (login page)', config.target.names);
        }

        // 2. Проверка на приватный аккаунт
        const isPrivate = await page.evaluate(() => {
            const privateText = ['Это закрытый аккаунт', 'This account is private', 'This Account is Private'];
            return privateText.some(text => document.body.innerText.includes(text));
        });

        if (isPrivate) {
            logger.info(`   🔒 Пропуск: ${donorUrl} — закрытый аккаунт.`);
            return;
        }

        // 3. Проверка на Action Blocked
        const isBlocked = await page.evaluate(() => {
            const blockText = ['попробуйте еще раз позже', 'try again later', 'Action Blocked', 'Действие заблокировано'];
            return blockText.some(text => document.body.innerText.includes(text));
        });

        if (isBlocked) {
            throw new RotateAccountError('Action Blocked / Shadowban detected', config.target.names);
        }

        logger.info(`   ✅ Страница донора загружена. Ищем кнопку подписчиков...`);

        const followersBtn = page.locator(SELECTORS.FOLLOWERS_LINK);
        await followersBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null);

        if (!await followersBtn.isVisible()) {
            logger.warn(`   ⚠️ Кнопка подписчиков не найдена (возможно, аккаунт пуст или скрыт).`);
            return;
        }

        // 4. Проверка количества подписчиков
        const { parsedCount, rawValue } = await page.evaluate(() => {
            const link = document.querySelector('a[href$="/followers/"]');
            if (!link) return { parsedCount: 0, rawValue: 'NOT_FOUND' };
            const span = link.querySelector('span[title]');
            const rawValue = span ? span.getAttribute('title') : link.innerText;

            const parseFollowers = (str) => {
                // 1. Normalize: handle localized comma as decimal if it seems like a ratio (e.g. 10,3M)
                // but since we force en-GB, we primarily treat dot as decimal and remove commas as thousands.
                let clean = str.replace(/,/g, '').replace(/\s+/g, '');

                // 2. Extract number and suffix
                const match = clean.match(/([\d.]+)\s*([^\d\s]*)/);
                if (!match) return 0;

                const numPart = match[1];
                const suffix = (match[2] || '').toLowerCase();

                let multiplier = 1;
                // Expanded suffix check for different languages just in case
                if (suffix.startsWith('k') || suffix.startsWith('к') || suffix.includes('mil')) {
                    multiplier = 1000;
                } else if (suffix.startsWith('m') || suffix.startsWith('м') || suffix.includes('млн') || suffix.includes('mio')) {
                    multiplier = 1000000;
                }

                const val = parseFloat(numPart);
                return isNaN(val) ? 0 : Math.floor(val * multiplier);
            };

            return { parsedCount: parseFollowers(rawValue), rawValue };
        }).catch(() => ({ parsedCount: 0, rawValue: 'ERROR' }));

        if (parsedCount < 1000) {
            logger.info(`   ⏭️ Пропуск и удаление: ${donorUrl} — слишком мало подписчиков. (Текст: "${rawValue}", Парсинг: ${parsedCount} < 1000)`);
            return;
        }

        await followersBtn.click();
        await takeLiveScreenshot(page);

        await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
        logger.info(`   ✅ Список подписчиков открыт.`);

        const searchInput = page.locator(SELECTORS.SEARCH_INPUT).first();
        await searchInput.waitFor({ state: 'visible', timeout: config.timeouts.inputWait });

        let emptyResultsCount = 0;
        let namesToSearch = config.target.names;

        for (let nameIdx = 0; nameIdx < namesToSearch.length; nameIdx++) {
            const name = namesToSearch[nameIdx];
            logger.info(`\n   🔎 ПОИСК ПО ИМЕНИ: "${name}"`);

            if (checkSkipSignal()) {
                console.log(`\n⏭️ [СИГНАЛ] Получен сигнал пропуска. Завершаем работу с донором ${donorUrl}...`);
                break;
            }

            await searchInput.click({ clickCount: 3 });
            await page.keyboard.press('Backspace');

            try { await page.waitForSelector(SELECTORS.LOADER, { state: 'hidden', timeout: 2000 }); } catch (e) { }

            const typeDelay = Math.floor(Math.random() * (60 - 20 + 1) + 20);
            await searchInput.pressSequentially(name, { delay: typeDelay });

            logger.info(`      ⏳ Ждем выдачу результатов от Инстаграма...`);
            try { await page.waitForSelector(SELECTORS.LOADER, { state: 'hidden', timeout: 3000 }); } catch (e) { }
            await takeLiveScreenshot(page);
            await wait(50);

            const candidates = await scrollAndCollectUrls(page, config);

            const newCandidates = candidates.filter(url => !StateManager.has(url));
            const skippedCount = candidates.length - newCandidates.length;

            logger.info(`      📊 ИТОГИ СБОРА ССЫЛОК:`);
            logger.info(`         • Всего найдено (со сторис): ${candidates.length}`);
            logger.info(`         • Пропущено (уже в истории): ${skippedCount}`);
            logger.info(`         • Идем проверять: ${newCandidates.length}`);

            if (newCandidates.length === 0) {
                emptyResultsCount++;
                logger.info(`      ⏭️ Новых профилей нет (${emptyResultsCount}/3 подряд).`);
                if (emptyResultsCount >= 3) {
                    if (totalAccounts > 1) {
                        logger.warn(`⚠️ 3 ПУСТЫХ РЕЗУЛЬТАТА ПОДРЯД. СКОРЕЕ ВСЕГО ШЕДОУБАН. ИНИЦИИРУЕМ СМЕНУ ПРОФИЛЯ...`);
                        throw new RotateAccountError('Shadowban (3 empty results)', namesToSearch.slice(nameIdx + 1));
                    } else {
                        logger.warn(`⚠️ 3 ПУСТЫХ РЕЗУЛЬТАТА ПОДРЯД. ВОЗМОЖЕН ШЕДОУБАН. ПРОДОЛЖАЕМ (ТОЛЬКО 1 АККАУНТ ДЛЯ ЗАДАЧИ).`);
                        emptyResultsCount = 0; // Reset to allow continuing
                    }
                }
                continue;
            } else {
                emptyResultsCount = 0;
            }

            logger.info(`      🚀 Обрабатываем новые профили пачками...`);
            const concurrentProfiles = await getSetting('concurrentProfiles');
            const CHUNK_SIZE = concurrentProfiles ? parseInt(concurrentProfiles) : 3;
            for (let i = 0; i < newCandidates.length; i += CHUNK_SIZE) {
                if (checkSkipSignal()) {
                    console.log(`\n⏭️ [СИГНАЛ] Получен сигнал пропуска в процессе анализа профилей...`);
                    shouldSkipDonor = true;
                    break;
                }
                const chunk = newCandidates.slice(i, i + CHUNK_SIZE);
                for (const url of chunk) {
                    if (checkSkipSignal()) {
                        console.log(`\n⏭️ [СИГНАЛ] Получен сигнал пропуска перед анализом профиля: ${url}`);
                        shouldSkipDonor = true;
                        break;
                    }
                    await analyzeProfile(context, url, config);
                }
                if (shouldSkipDonor) break;
                await randomDelay(100, 300);
            }
            if (shouldSkipDonor) break;
        }
    } catch (e) {
        if (e.name === 'RotateAccountError') {
            throw e;
        }
        logger.error(`   ❌ КРИТИЧЕСКАЯ ОШИБКА ДОНОРА: ${e.message}`);
        await saveCrashReport(page, e, `donor_${donorUrl.split('/').filter(Boolean).pop()}`);
        throw e;
    } finally {
        await page.close();
        logger.info(`   🚪 Донор закрыт.`);
    }
};

const run = async () => {
    logger.info('🚀 ЗАПУСК СКРЕЙПЕРА (STEALTH MODE + LOGS)...');
    logger.info('----------------------------------------------');
    let CONFIG = await getDynamicConfig();
    const accounts = await getAllAccounts('index');
    let currentAccountIndex = 0;

    await StateManager.init();
    const donors = await StateManager.loadDonors();

    if (!donors.length) {
        logger.warn('⚠️ [ОШИБКА] Список доноров в config/profiles.txt пуст.');
        return;
    }
    logger.info(`🎯 Загружено доноров: ${donors.length}`);

    const setupBrowser = async () => {
        let proxy = null;
        let cookies = [];
        if (accounts.length > 0) {
            proxy = accounts[currentAccountIndex].proxy;
            cookies = accounts[currentAccountIndex].cookies;
            fingerprint = accounts[currentAccountIndex].fingerprint;
        } else {
            logger.warn('⚠️ Нет выбранных аккаунтов для парсера. Прямое соединение без кук.');
        }

        logger.info(`🌐 Запуск браузера (Фоновый режим / Headless)...`);
        logger.info(`📡 Прокси: ${proxy ? proxy.server : 'ПРЯМОЕ СОЕДИНЕНИЕ'}`);
        logger.info(`🍪 Загружено куки: ${cookies.length}`);
        if (fingerprint) {
            logger.info(`🎭 Применен уникальный отпечаток браузера: ${fingerprint.userAgent.substring(0, 50)}...`);
        }

        const configWithCreds = { ...CONFIG, proxy, cookies, fingerprint };
        const showBrowserStr = await getSetting('showBrowser');
        const showBrowser = showBrowserStr === 'true' || showBrowserStr === true;
        const isHeadless = !showBrowser;

        return await createBrowserContext(configWithCreds, isHeadless);
    };

    let { browser, context } = await setupBrowser();
    await optimizeContextForScraping(context);
    let liveViewInterval = startLiveView(context);

    let donorIdx = 0;
    while (donorIdx < donors.length) {
        const donorUrl = donors[donorIdx];
        if (StateManager.hasDonor(donorUrl)) {
            logger.info(`\n⏭️ Донор ${donorUrl} уже был обработан ранее, пропускаем.`);
            donorIdx++;
            continue;
        }

        try {
            await processDonor(context, donorUrl, CONFIG, accounts.length);
            await StateManager.addDonor(donorUrl);
            donorIdx++; // Move to next donor on success
            // Reset to full names list for next donor
            CONFIG.target.names = shuffleArray(await getList('names.txt'));
        } catch (e) {
            if (e.name === 'RotateAccountError') {
                const isRotationNeeded = accounts.length > 1;
                if (isRotationNeeded) {
                    logger.info(`🔄 ПЕРЕКЛЮЧЕНИЕ ПРОФИЛЯ: ${e.reason}`);
                } else {
                    logger.info(`🔄 ПЕРЕЗАГРУЗКА СЕССИИ: ${e.reason}`);
                }

                clearInterval(liveViewInterval);
                await browser.close();

                if (isRotationNeeded) {
                    currentAccountIndex = (currentAccountIndex + 1) % accounts.length;
                    logger.info(`🔀 Переключились на аккаунт #${currentAccountIndex + 1} из ${accounts.length}`);
                } else {
                    logger.warn(`⚠️ Только один аккаунт доступен. Ждем 30 сек перед повторной попыткой...`);
                    await wait(30000);
                }

                const setup = await setupBrowser();
                browser = setup.browser;
                context = setup.context;
                await optimizeContextForScraping(context);
                liveViewInterval = startLiveView(context);

                // Update CONFIG names with remainings and don't increment donorIdx so it retries
                CONFIG.target.names = e.remainingNames.length > 0 ? e.remainingNames : shuffleArray(await getList('names.txt'));
            } else {
                logger.error(`❌ Непредвиденная ошибка: ${e.message}`);
                donorIdx++; // Skip this donor on other errors
            }
        }
    }

    clearInterval(liveViewInterval);
    await browser.close();
    logger.info('\n✅ ========================================== ✅');
    logger.info('👋 РАБОТА ПОЛНОСТЬЮ ЗАВЕРШЕНА! Все результаты сохранены.');
    logger.info('✅ ========================================== ✅');
};

run().catch(console.error);