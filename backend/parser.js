const path = require('path');
const { resolve } = path;
const { handleError, setupProcessHandlers } = require('./lib/error-handler');
const { AppError, BrowserError } = require('./lib/errors');
const config_1 = require("./lib/config");
const state_1 = require("./lib/state");
const browser_1 = require("./lib/browser");
const utils_1 = require("./lib/utils");
const reporter_1 = require("./lib/reporter");

const getDynamicConfig = async () => {
    try {
        // Небольшая рандомизация размера окна
        const width = 1280 + Math.floor(Math.random() * 150);
        const height = 900 + Math.floor(Math.random() * 100);

        const accounts = await (0, config_1.getAllAccounts)('parser');
        if (!accounts || accounts.length === 0) {
            throw new AppError('Куки для парсера не найдены. Пожалуйста, включите \'Task: Parser\' для авторизованного аккаунта.');
        }

        const activeAccount = accounts[0]; // Use prioritized account

        return {
            viewport: { width, height },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
            timeouts: { pageLoad: 25000, element: 10000, inputWait: 5000 },
            account: activeAccount,
            cities: await (0, config_1.getList)('cityKeywords.txt'),
            niches: await (0, config_1.getList)('nicheKeywords.txt')
        };
    } catch (e) {
        throw new AppError(`Failed to load parser config: ${e.message}`);
    }
};

const shuffleArray = (array) => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

const getCombinedKeywords = (cities, niches) => {
    if (!niches || niches.length === 0)
        return shuffleArray([...(cities || [])]);
    if (!cities || cities.length === 0)
        return shuffleArray([...(niches || [])]);
    const combined = [];
    for (const city of cities) {
        for (const niche of niches) {
            combined.push(`${city} ${niche}`);
        }
    }
    return shuffleArray(combined);
};

const run = async () => {
    console.log('🚀 ЗАПУСК ПАРСЕРА ДОНОРОВ (STEALTH MODE + LOGS)...');
    console.log('----------------------------------------------');

    let CONFIG;
    try {
        CONFIG = await getDynamicConfig();
        await state_1.StateManager.init();
    } catch (err) {
        handleError(err);
        return;
    }

    const { account } = CONFIG;
    const keywords = getCombinedKeywords(CONFIG.cities, CONFIG.niches);
    if (!keywords || keywords.length === 0) {
        handleError(new AppError('Список ключевых слов (города/ниши) пуст.'));
        return;
    }
    console.log(`🎯 Загружено комбинаций ключевых слов для поиска: ${keywords.length}`);
    // Файл для сохранения найденных профилей доноров
    const profilesFile = resolve((0, utils_1.getRootPath)(), 'config', 'profiles.txt');
    const savedProfiles = await state_1.StateManager.loadDonors();
    const collectedUrls = new Set(savedProfiles.map(config_1.normalizeUrl));
    console.log(`📂 В базе уже сохранено доноров: ${collectedUrls.size}`);

    console.log(`🌐 Запуск браузера для аккаунта: ${account.name || account.id}...`);
    console.log(`📡 Прокси: ${account.proxy ? account.proxy.server : 'ПРЯМОЕ СОЕДИНЕНИЕ'}`);
    console.log(`🍪 Загружено куки: ${account.cookies.length}`);

    let browser, context, liveViewInterval;
    try {
        const showBrowserStr = await (0, config_1.getSetting)('showBrowser');
        const showBrowser = showBrowserStr === 'true' || showBrowserStr === true;
        const isHeadless = !showBrowser;

        // Pass complete account info including id and fingerprint
        const result = await (0, browser_1.createBrowserContext)({
            ...CONFIG,
            id: account.id,
            proxy: account.proxy,
            cookies: account.cookies,
            fingerprint: account.fingerprint
        }, isHeadless);

        browser = result.browser;
        context = result.context;

        liveViewInterval = (0, browser_1.startLiveView)(context);
        // Оптимизируем загрузку, если нужно (блокируем лишние картинки)
        await (0, browser_1.optimizeContextForScraping)(context);
        const page = await context.newPage();

        try {
            console.log('Открываем главную страницу Instagram...');
            await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: CONFIG.timeouts.pageLoad });
            await (0, browser_1.takeLiveScreenshot)(page);
            await (0, utils_1.wait)(3000);
            // Ищем строку поиска
            // Selectors updated to support English, Russian, French, and Spanish
            let searchInputLocator = page.locator('input[aria-label*="Search"], input[aria-label*="Поиск"], input[aria-label*="Recherche"], input[aria-label*="Buscar"], input[placeholder*="Search"], input[placeholder*="Поиск"], input[placeholder*="Recherche"], input[placeholder*="Buscar"]').first();
            // Если строка поиска скрыта, нужно кликнуть по иконке/вкладке поиска в левом меню
            if (await searchInputLocator.count() === 0) {
                console.log('🔍 Ищем вкладку поиска в меню...');
                const searchIcon = page.locator('svg[aria-label*="Search"], svg[aria-label*="Поиск"], svg[aria-label*="Recherche"], svg[aria-label*="Rechercher"], svg[aria-label*="Buscar"]').first();
                const searchLink = page.locator('a[href="#"]').filter({ hasText: /Search|Поиск|Recherche|Rechercher|Buscar/ }).first();
                if (await searchLink.count() > 0) {
                    await searchLink.click();
                }
                else if (await searchIcon.count() > 0) {
                    await searchIcon.click();
                }
                await (0, utils_1.wait)(2000);
            }
            searchInputLocator = page.locator('input[aria-label*="Search"], input[aria-label*="Поиск"], input[aria-label*="Recherche"], input[aria-label*="Buscar"], input[placeholder*="Search"], input[placeholder*="Поиск"], input[placeholder*="Recherche"], input[placeholder*="Buscar"]').first();

            if (await searchInputLocator.count() > 0) {
                for (const keyword of keywords) {
                    try {
                        console.log(`\n🔎 Ищем профили по запросу: "${keyword}"`);
                        await (0, utils_1.humanClick)(page, searchInputLocator, { clickCount: 3 });
                        await page.keyboard.press('Backspace');
                        await (0, utils_1.wait)(500);
                        await searchInputLocator.pressSequentially(keyword, { delay: Math.floor(Math.random() * (120 - 50 + 1) + 50) });
                        console.log(`⏳ Ждем результаты поиска от Instagram...`);
                        await (0, browser_1.takeLiveScreenshot)(page);
                        await (0, utils_1.wait)(4000);
                        await (0, browser_1.takeLiveScreenshot)(page);

                        // ... eval search results ...
                        const searchResultsData = await page.evaluate(() => {
                            const results = [];
                            const searchInput = document.querySelector('input[aria-label*="Search"], input[aria-label*="Поиск"], input[aria-label*="Recherche"], input[aria-label*="Buscar"], input[placeholder*="Search"], input[placeholder*="Поиск"], input[placeholder*="Recherche"], input[placeholder*="Buscar"]');
                            if (!searchInput) return { links: [], container: 'NOT_FOUND' };

                            const containerSelectors = ['div[role="none"] div[role="none"]', 'div.x1iyjqo2', 'div.x1n2onr6.x1ja2u2z', 'div[role="dialog"]', 'div[style*="position: absolute"]'];
                            let resultsContainer = null;
                            let foundSelector = 'NONE';

                            for (const sel of containerSelectors) {
                                const el = document.querySelector(sel);
                                if (el && el.querySelectorAll('a[href]').length > 0) {
                                    resultsContainer = el;
                                    foundSelector = sel;
                                    break;
                                }
                            }

                            const searchLinks = resultsContainer ? resultsContainer.querySelectorAll('a[href]') : document.querySelectorAll('div[role="dialog"] a[href], div[style*="position: absolute"] a[href]');
                            searchLinks.forEach(a => {
                                const href = a.getAttribute('href');
                                if (href && href.startsWith('/') && href.split('/').length === 3) {
                                    if (!href.includes('/explore/') && !href.includes('/p/') && !href.includes('/tags/')) {
                                        const isSuggested = a.closest('aside') || a.closest('div[aria-label="Suggested"]');
                                        const hasSuggestedClasses = a.closest('div.x9f619.x1n2onr6.x1ja2u2z') && !resultsContainer;
                                        if (!isSuggested && !hasSuggestedClasses) {
                                            results.push(`https://www.instagram.com${href}`);
                                        }
                                    }
                                }
                            });
                            return { links: results, container: foundSelector };
                        });

                        const { links, container } = searchResultsData;
                        console.log(`📡 [DEBUG] Контейнер результатов: ${container} | Найдено ссылок: ${links.length}`);

                        const uniqueLinks = [...new Set(links)];
                        const finalLinks = uniqueLinks.slice(0, 5);
                        let addedCount = 0;
                        for (const link of finalLinks) {
                            const normLink = (0, config_1.normalizeUrl)(link);
                            if (!collectedUrls.has(normLink)) {
                                collectedUrls.add(normLink);
                                await state_1.StateManager.saveDonor(normLink);
                                addedCount++;
                            }
                        }
                        console.log(`✅ Найдено профилей: ${finalLinks.length} | Из них новых: ${addedCount}`);
                        await (0, utils_1.wait)(2000 + Math.random() * 3000);
                    } catch (itemErr) {
                        handleError(new AppError(`Error processing keyword "${keyword}": ${itemErr.message}`, { keyword }));
                        // Continue to next keyword
                    }
                }
            }
            else {
                throw new AppError('Не удалось найти поле ввода для поиска. Возможно, изменилась верстка Instagram или требуется капча/логин.');
            }
        }
        catch (e) {
            handleError(e);
            await (0, reporter_1.saveCrashReport)(page, e, 'parser');
        }
        finally {
            if (typeof liveViewInterval !== 'undefined') clearInterval(liveViewInterval);
            await page.close().catch(() => { });
            await browser.close().catch(() => { });
            console.log('\n✅ ========================================== ✅');
            console.log('👋 РАБОТА ПАРСЕРА ЗАВЕРШЕНА! Браузер закрыт.');
            console.log('✅ ========================================== ✅');
        }
    } catch (launchErr) {
        handleError(launchErr);
    }
};
run().catch(handleError);
