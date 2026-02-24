const fs = require('fs/promises');
const path = require('path');
const { getProxy, getCookies, getList, normalizeUrl, getSetting } = require('./lib/config');
const { StateManager } = require('./lib/state');
const { createBrowserContext, optimizeContextForScraping, startLiveView } = require('./lib/browser');
const { wait } = require('./lib/utils');
const { saveCrashReport } = require('./lib/reporter');

const getDynamicConfig = async () => {
    // Небольшая рандомизация размера окна
    const width = 1280 + Math.floor(Math.random() * 150);
    const height = 900 + Math.floor(Math.random() * 100);

    return {
        viewport: { width, height },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        timeouts: { pageLoad: 25000, element: 10000, inputWait: 5000 },
        proxy: await getProxy('parser'),
        cookies: await getCookies('parser'),
        cities: await getList('cityKeywords.txt'),
        niches: await getList('nicheKeywords.txt')
    };
};

const getCombinedKeywords = (cities, niches) => {
    if (!niches || niches.length === 0) return cities || [];
    if (!cities || cities.length === 0) return niches || [];

    const combined = [];
    for (const city of cities) {
        for (const niche of niches) {
            combined.push(`${city} ${niche}`);
        }
    }
    return combined;
};

const run = async () => {
    console.log('🚀 ЗАПУСК ПАРСЕРА ДОНОРОВ (STEALTH MODE + LOGS)...');
    console.log('----------------------------------------------');

    const CONFIG = await getDynamicConfig();
    await StateManager.init();
    const keywords = getCombinedKeywords(CONFIG.cities, CONFIG.niches);

    if (!keywords || keywords.length === 0) {
        console.log('⚠️ [ОШИБКА] Список ключевых слов (города/ниши) пуст.');
        return;
    }
    console.log(`🎯 Загружено комбинаций ключевых слов для поиска: ${keywords.length}`);

    // Файл для сохранения найденных профилей доноров
    const profilesFile = path.resolve(__dirname, '..', 'config', 'profiles.txt');

    const savedProfiles = await StateManager.loadDonors();
    const collectedUrls = new Set(savedProfiles.map(normalizeUrl));
    console.log(`📂 В базе уже сохранено доноров: ${collectedUrls.size}`);

    console.log('🌐 Запуск браузера...');
    console.log(`📡 Прокси: ${CONFIG.proxy ? CONFIG.proxy.server : 'ПРЯМОЕ СОЕДИНЕНИЕ'}`);
    console.log(`🍪 Загружено куки: ${CONFIG.cookies.length}`);

    const showBrowserStr = await getSetting('showBrowser');
    const showBrowser = showBrowserStr === 'true' || showBrowserStr === true;
    const isHeadless = !showBrowser;

    const { browser, context } = await createBrowserContext(CONFIG, isHeadless);
    const liveViewInterval = startLiveView(context);

    // Оптимизируем загрузку, если нужно (блокируем лишние картинки)
    await optimizeContextForScraping(context);

    const page = await context.newPage();

    try {
        console.log('Открываем главную страницу Instagram...');
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: CONFIG.timeouts.pageLoad });
        await wait(3000);

        // Ищем строку поиска
        let searchInputLocator = page.locator('input[aria-label="Search input"], input[placeholder="Search"], input[placeholder="Поиск"]').first();

        // Если строка поиска скрыта, нужно кликнуть по иконке/вкладке поиска в левом меню
        if (await searchInputLocator.count() === 0) {
            console.log('🔍 Ищем вкладку поиска в меню...');

            const searchIcon = page.locator('svg[aria-label="Search"], svg[aria-label="Поисковый запрос"], svg[aria-label="Поиск"]').first();
            const searchLink = page.locator('a[href="#"]').filter({ hasText: /Search|Поиск/ }).first();

            if (await searchLink.count() > 0) {
                await searchLink.click();
            } else if (await searchIcon.count() > 0) {
                await searchIcon.click();
            }

            await wait(2000);
        }

        searchInputLocator = page.locator('input[aria-label="Search input"], input[placeholder="Search"], input[placeholder="Поиск"]').first();

        if (await searchInputLocator.count() > 0) {
            for (const keyword of keywords) {
                console.log(`\n🔎 Ищем профили по запросу: "${keyword}"`);

                await searchInputLocator.click({ clickCount: 3 });
                await page.keyboard.press('Backspace');
                await wait(500);

                await searchInputLocator.pressSequentially(keyword, { delay: Math.floor(Math.random() * (120 - 50 + 1) + 50) });

                console.log(`⏳ Ждем результаты поиска от Instagram...`);
                await wait(4000);

                // Парсим результаты из выпадающего списка
                const links = await page.evaluate(() => {
                    const results = [];
                    document.querySelectorAll('a[href]').forEach(a => {
                        const href = a.getAttribute('href');
                        // Ищем ссылки, которые ведут на конкретного пользователя (/username/)
                        if (href && href.startsWith('/') && href.split('/').length === 3) {
                            if (!href.includes('/explore/') && !href.includes('/p/') && !href.includes('/tags/')) {
                                results.push(`https://www.instagram.com${href}`);
                            }
                        }
                    });
                    return results;
                });

                // Фильтруем (оставляем только уникальные)
                const uniqueLinks = [...new Set(links)];
                let addedCount = 0;

                for (const link of uniqueLinks) {
                    const normLink = normalizeUrl(link);
                    if (!collectedUrls.has(normLink)) {
                        collectedUrls.add(normLink);
                        await StateManager.saveDonor(normLink);
                        addedCount++;
                    }
                }

                console.log(`✅ Найдено профилей: ${uniqueLinks.length} | Из них новых: ${addedCount}`);

                // Задержка между запросами
                await wait(2000 + Math.random() * 3000);
            }
        } else {
            console.error('❌ Не удалось найти поле ввода для поиска. Возможно, изменилась верстка Instagram или требуется капча/логин.');
        }

    } catch (e) {
        console.error(`\n❌ Критическая ошибка во время выполнения парсера:`);
        console.error(e.message);
        await saveCrashReport(page, e, 'parser');
    } finally {
        if (typeof liveViewInterval !== 'undefined') clearInterval(liveViewInterval);
        await page.close();
        await browser.close();
        console.log('\n✅ ========================================== ✅');
        console.log('👋 РАБОТА ПАРСЕРА ЗАВЕРШЕНА! Браузер закрыт.');
        console.log('✅ ========================================== ✅');
    }
};

run().catch(console.error);
