"use strict";
const path_1 = require("path");
Object.defineProperty(exports, "__esModule", { value: true });

const config_1 = require("./lib/config");
const state_1 = require("./lib/state");
const browser_1 = require("./lib/browser");
const utils_1 = require("./lib/utils");
const reporter_1 = require("./lib/reporter");
const getDynamicConfig = async () => {
    // Небольшая рандомизация размера окна
    const width = 1280 + Math.floor(Math.random() * 150);
    const height = 900 + Math.floor(Math.random() * 100);
    return {
        viewport: { width, height },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        timeouts: { pageLoad: 25000, element: 10000, inputWait: 5000 },
        proxy: await (0, config_1.getProxy)('parser'),
        cookies: await (0, config_1.getCookies)('parser'),
        cities: await (0, config_1.getList)('cityKeywords.txt'),
        niches: await (0, config_1.getList)('nicheKeywords.txt')
    };
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
    const CONFIG = await getDynamicConfig();
    await state_1.StateManager.init();
    const keywords = getCombinedKeywords(CONFIG.cities, CONFIG.niches);
    if (!keywords || keywords.length === 0) {
        console.log('⚠️ [ОШИБКА] Список ключевых слов (города/ниши) пуст.');
        return;
    }
    console.log(`🎯 Загружено комбинаций ключевых слов для поиска: ${keywords.length}`);
    // Файл для сохранения найденных профилей доноров
    const profilesFile = path_1.resolve((0, utils_1.getRootPath)(), 'config', 'profiles.txt');
    const savedProfiles = await state_1.StateManager.loadDonors();
    const collectedUrls = new Set(savedProfiles.map(config_1.normalizeUrl));
    console.log(`📂 В базе уже сохранено доноров: ${collectedUrls.size}`);
    console.log('🌐 Запуск браузера...');
    console.log(`📡 Прокси: ${CONFIG.proxy ? CONFIG.proxy.server : 'ПРЯМОЕ СОЕДИНЕНИЕ'}`);
    console.log(`🍪 Загружено куки: ${CONFIG.cookies.length}`);

    if (!CONFIG.cookies || CONFIG.cookies.length === 0) {
        const errMsg = '❌ [ОШИБКА] Куки для парсера не найдены. Пожалуйста, включите \'Task: Parser\' для авторизованного аккаунта.';
        console.error(errMsg);
        return;
    }
    const showBrowserStr = await (0, config_1.getSetting)('showBrowser');
    const showBrowser = showBrowserStr === 'true' || showBrowserStr === true;
    const isHeadless = !showBrowser;
    const { browser, context } = await (0, browser_1.createBrowserContext)(CONFIG, isHeadless);
    const liveViewInterval = (0, browser_1.startLiveView)(context);
    // Оптимизируем загрузку, если нужно (блокируем лишние картинки)
    await (0, browser_1.optimizeContextForScraping)(context);
    const page = await context.newPage();
    try {
        console.log('Открываем главную страницу Instagram...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: CONFIG.timeouts.pageLoad });
        await (0, browser_1.takeLiveScreenshot)(page);
        await (0, utils_1.wait)(3000);
        // Ищем строку поиска
        // Ищем строку поиска
        // Selectors updated to support English, Russian, French, and Spanish
        let searchInputLocator = page.locator('input[aria-label*="Search"], input[aria-label*="Поиск"], input[aria-label*="Recherche"], input[aria-label*="Buscar"], input[placeholder*="Search"], input[placeholder*="Поиск"], input[placeholder*="Recherche"], input[placeholder*="Buscar"]').first();
        // Если строка поиска скрыта, нужно кликнуть по иконке/вкладке поиска в левом меню
        if (await searchInputLocator.count() === 0) {
            console.log('🔍 Ищем вкладку поиска в меню...');
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
                console.log(`\n🔎 Ищем профили по запросу: "${keyword}"`);
                await searchInputLocator.click({ clickCount: 3 });
                await page.keyboard.press('Backspace');
                await (0, utils_1.wait)(500);
                await searchInputLocator.pressSequentially(keyword, { delay: Math.floor(Math.random() * (120 - 50 + 1) + 50) });
                console.log(`⏳ Ждем результаты поиска от Instagram...`);
                await (0, browser_1.takeLiveScreenshot)(page);
                await (0, utils_1.wait)(4000);
                await (0, browser_1.takeLiveScreenshot)(page);
                // Парсим результаты из выпадающего списка
                const searchResultsData = await page.evaluate(() => {
                    const results = [];
                    // Ищем поле поиска, чтобы оттолкнуться от него
                    const searchInput = document.querySelector('input[aria-label*="Search"], input[aria-label*="Поиск"], input[aria-label*="Recherche"], input[aria-label*="Buscar"], input[placeholder*="Search"], input[placeholder*="Поиск"], input[placeholder*="Recherche"], input[placeholder*="Buscar"]');
                    if (!searchInput) return { links: [], container: 'NOT_FOUND' };

                    // Возможные селекторы контейнера результатов
                    const containerSelectors = [
                        'div[role="none"] div[role="none"]',
                        'div.x1iyjqo2',
                        'div.x1n2onr6.x1ja2u2z',
                        'div[role="dialog"]',
                        'div[style*="position: absolute"]'
                    ];

                    let resultsContainer = null;
                    let foundSelector = 'NONE';

                    for (const sel of containerSelectors) {
                        const el = document.querySelector(sel);
                        if (el && el.querySelectorAll('a[href]').length > 0) {
                            // Проверяем, что контейнер находится рядом с поиском (обычно ниже или в портале)
                            resultsContainer = el;
                            foundSelector = sel;
                            break;
                        }
                    }

                    const searchLinks = resultsContainer
                        ? resultsContainer.querySelectorAll('a[href]')
                        : document.querySelectorAll('div[role="dialog"] a[href], div[style*="position: absolute"] a[href]');

                    searchLinks.forEach(a => {
                        const href = a.getAttribute('href');
                        // Ищем ссылки, которые ведут на конкретного пользователя (/username/)
                        if (href && href.startsWith('/') && href.split('/').length === 3) {
                            if (!href.includes('/explore/') && !href.includes('/p/') && !href.includes('/tags/')) {
                                // Исключаем ссылки из боковой панели "Suggested"
                                const isSuggested = a.closest('aside') || a.closest('div[aria-label="Suggested"]');
                                // Дополнительная проверка на классы, которые часто бывают у "Suggested" в сайдбаре, но не в поиске
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

                // Фильтруем (оставляем только уникальные)
                const uniqueLinks = [...new Set(links)];
                // Ограничиваем до первых 5 результатов
                const finalLinks = uniqueLinks.slice(0, 5);
                // Фильтруем (оставляем только уникальные)
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
                // Задержка между запросами
                await (0, utils_1.wait)(2000 + Math.random() * 3000);
            }
        }
        else {
            console.error('❌ Не удалось найти поле ввода для поиска. Возможно, изменилась верстка Instagram или требуется капча/логин.');
        }
    }
    catch (e) {
        console.error(`\n❌ Критическая ошибка во время выполнения парсера:`);
        console.error(e.message);
        await (0, reporter_1.saveCrashReport)(page, e, 'parser');
    }
    finally {
        if (typeof liveViewInterval !== 'undefined')
            clearInterval(liveViewInterval);
        await page.close();
        await browser.close();
        console.log('\n✅ ========================================== ✅');
        console.log('👋 РАБОТА ПАРСЕРА ЗАВЕРШЕНА! Браузер закрыт.');
        console.log('✅ ========================================== ✅');
    }
};
run().catch(console.error);
