const path = require('path');
const { resolve } = path;
const reporter_1 = require('./lib/reporter');
const { AppError, BrowserError } = require('./lib/errors');
const config_1 = require('./lib/config');
const state_1 = require('./lib/state');
const browser_1 = require('./lib/browser');
const utils_1 = require('./lib/utils');
const anti_fraud_1 = require('./lib/anti-fraud');
const { info, warn, error: logError } = require('./lib/logger');
const { handleError, setupProcessHandlers } = require('./lib/error-handler');
const { getDB } = require('./lib/db');

const getDynamicConfig = async () => {
  try {
    // Небольшая рандомизация размера окна
    const width = 1920 + Math.floor(Math.random() * 150);
    const height = 900 + Math.floor(Math.random() * 100);

    const accounts = await (0, config_1.getAllAccounts)('parser');
    if (!accounts || accounts.length === 0) {
      throw new AppError(
        "Куки для парсера не найдены. Пожалуйста, включите 'Task: Parser' для авторизованного аккаунта."
      );
    }

    const activeAccount = accounts[0]; // Use prioritized account

    return {
      viewport: { width, height },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      timeouts: { pageLoad: 25000, element: 10000, inputWait: 5000 },
      account: activeAccount,
      cities: await (0, config_1.getList)('cityKeywords.txt'),
      citiesBlacklist: await (0, config_1.getList)('cityBlacklist.txt'),
      wordsBlacklist: await (0, config_1.getList)('wordBlacklist.txt'),
      niches: await (0, config_1.getList)('nicheKeywords.txt'),
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
  if (!niches || niches.length === 0) return shuffleArray([...(cities || [])]);
  if (!cities || cities.length === 0) return shuffleArray([...(niches || [])]);
  const combined = [];
  for (const city of cities) {
    for (const niche of niches) {
      combined.push({ keyword: `${city} ${niche}`, city, niche });
    }
  }
  return shuffleArray(combined);
};

const run = async () => {
  info('🚀 ЗАПУСК ПАРСЕРА ДОНОРОВ (STEALTH MODE + LOGS)...');
  info('----------------------------------------------');

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
  const savedProfiles = await state_1.StateManager.loadDonors();
  const collectedUrls = new Set(savedProfiles.map(config_1.normalizeUrl));
  info(`📂 В базе уже сохранено доноров: ${collectedUrls.size}`);
  info(`📍 Ключевых слов города: ${CONFIG.cities.length}`);
  if (CONFIG.citiesBlacklist.length > 0) {
    info(`🚫 В черном списке городов: ${CONFIG.citiesBlacklist.length}`);
  }
  if (CONFIG.wordsBlacklist.length > 0) {
    info(`🚫 В чёрном списке слов: ${CONFIG.wordsBlacklist.length}`);
  }

  info(`🌐 Запуск браузера для аккаунта: ${account.name || account.id}...`);
  info(`📡 Прокси: ${account.proxy ? account.proxy.server : 'ПРЯМОЕ СОЕДИНЕНИЕ'}`);
  info(`🍪 Загружено куки: ${account.cookies.length}`);

  let browser, context, liveViewInterval;
  try {
    const showBrowserStr = await (0, config_1.getSetting)('showBrowser');
    const showBrowser = showBrowserStr === 'true' || showBrowserStr === true;
    const isHeadless = !showBrowser;

    // Pass complete account info including id and fingerprint
    const result = await (0, browser_1.createBrowserContext)(
      {
        ...CONFIG,
        id: account.id,
        proxy: account.proxy,
        cookies: account.cookies,
        fingerprint: account.fingerprint,
      },
      isHeadless
    );

    browser = result.browser;
    context = result.context;

    liveViewInterval = (0, browser_1.startLiveView)(context);
    // Оптимизируем загрузку, если нужно (блокируем лишние картинки)
    await (0, browser_1.optimizeContextForScraping)(context);
    const page = await context.newPage();

    try {
      info('Открываем главную страницу Instagram...');
      await page.goto('https://www.instagram.com/', {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.timeouts.pageLoad,
      });
      await (0, browser_1.takeLiveScreenshot)(page);
      await (0, anti_fraud_1.waitWithActivity)(page, 3000);
      // Ищем строку поиска
      // Selectors updated to support English, Russian, French, and Spanish
      let searchInputLocator = page
        .locator(
          'input[aria-label*="Search"], input[aria-label*="Поиск"], input[aria-label*="Recherche"], input[aria-label*="Buscar"], input[placeholder*="Search"], input[placeholder*="Поиск"], input[placeholder*="Recherche"], input[placeholder*="Buscar"]'
        )
        .first();
      // Если строка поиска скрыта, нужно кликнуть по иконке/вкладке поиска в левом меню
      if ((await searchInputLocator.count()) === 0) {
        info('🔍 Ищем вкладку поиска в меню...');
        const searchIcon = page
          .locator(
            'svg[aria-label*="Search"], svg[aria-label*="Поиск"], svg[aria-label*="Recherche"], svg[aria-label*="Rechercher"], svg[aria-label*="Buscar"]'
          )
          .first();
        const searchLink = page
          .locator('a[href="#"]')
          .filter({ hasText: /Search|Поиск|Recherche|Rechercher|Buscar/ })
          .first();
        if ((await searchLink.count()) > 0) {
          await searchLink.click();
        } else if ((await searchIcon.count()) > 0) {
          await searchIcon.click();
        }
        await (0, anti_fraud_1.waitWithActivity)(page, 2000);
      }
      searchInputLocator = page
        .locator(
          'input[aria-label*="Search"], input[aria-label*="Поиск"], input[aria-label*="Recherche"], input[aria-label*="Buscar"], input[placeholder*="Search"], input[placeholder*="Поиск"], input[placeholder*="Recherche"], input[placeholder*="Buscar"]'
        )
        .first();

      if ((await searchInputLocator.count()) > 0) {
        for (const kwObj of keywords) {
          const { keyword, city, niche } = kwObj;
          try {
            console.log(`\n🔎 Ищем профили по запросу: "${keyword}"`);
            await (0, anti_fraud_1.waitWithActivity)(page, 1000);

            // More aggressive API fetch using multiple endpoints to ensure >5 results
            info(`📡 [API] Глубокий поиск профилей для: "${keyword}"`);
            const apiLinks = await page.evaluate(async (kw) => {
              try {
                const results = [];
                // 1. Topsearch (Blended)
                const topSearchUrl = `https://www.instagram.com/api/v1/web/search/topsearch/?context=blended&query=${encodeURIComponent(kw)}&rank_token=${Math.random()}`;
                // 2. Specialized User Search
                const userSearchUrl = `https://www.instagram.com/api/v1/users/search/?q=${encodeURIComponent(kw)}&count=50`;

                const fetchResults = async (url) => {
                  try {
                    const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
                    const json = await res.json();
                    if (json.users && Array.isArray(json.users)) {
                      return json.users.map(u => {
                        const user = u.user || u;
                        return user.username ? `https://www.instagram.com/${user.username}/` : null;
                      }).filter(Boolean);
                    }
                  } catch (e) { }
                  return [];
                };

                const [topResults, userResults] = await Promise.all([
                  fetchResults(topSearchUrl),
                  fetchResults(userSearchUrl)
                ]);

                return [...topResults, ...userResults];
              } catch (e) {
                return [];
              }
            }, keyword).catch(() => []);

            await (0, browser_1.takeLiveScreenshot)(page);
            await (0, anti_fraud_1.waitWithActivity)(page, 1000);

            const uniqueLinks = [...new Set(apiLinks)];
            const finalLinks = uniqueLinks.slice(0, 30); // Target up to 30
            let addedCount = 0;
            for (const link of finalLinks) {
              const normLink = (0, config_1.normalizeUrl)(link);
              // Check city blacklist if donor is already known to contain city in its handle/placeholder
              // For parser, we usually assume it's okay because we searched for it,
              // but we can add a check if we were to fetch its bio here.
              // However, parser saves donor with nices/cities passed into saveDonor.
              // We'll filter the "city" being passed in if it's in blacklist (though unlikely as it came from whitelist).
              // A better place is during the profile analysis in scraper, but let's be safe.

              const isBlacklisted = CONFIG.citiesBlacklist.length > 0 && CONFIG.citiesBlacklist.some(bl =>
                normLink.toLowerCase().includes(bl.toLowerCase()) ||
                city.toLowerCase().includes(bl.toLowerCase())
              ) || CONFIG.wordsBlacklist.length > 0 && CONFIG.wordsBlacklist.some(bl =>
                normLink.toLowerCase().includes(bl.toLowerCase()) ||
                niche.toLowerCase().includes(bl.toLowerCase())
              );

              if (isBlacklisted) {
                warn(`🚫 Профиль ${normLink} пропущен (чёрный список)`);
                continue;
              }

              if (!collectedUrls.has(normLink) && !state_1.StateManager.has(normLink)) {
                collectedUrls.add(normLink);
                await state_1.StateManager.saveDonor(normLink, niche, city);
                addedCount++;
              }
            }
            info(`✅ Всего найдено: ${uniqueLinks.length} | Взято: ${finalLinks.length} | Новых: ${addedCount}`);
            await (0, anti_fraud_1.waitWithActivity)(page, 2000 + Math.random() * 3000);
          } catch (itemErr) {
            handleError(
              new AppError(`Error processing keyword "${keyword}": ${itemErr.message}`, { keyword })
            );
            // Continue to next keyword
          }
        }
      } else {
        throw new AppError(
          'Не удалось найти поле ввода для поиска. Возможно, изменилась верстка Instagram или требуется капча/логин.'
        );
      }
    } catch (e) {
      handleError(e);
      await (0, reporter_1.saveCrashReport)(page, e, 'parser');
    } finally {
      if (typeof liveViewInterval !== 'undefined') clearInterval(liveViewInterval);
      await page.close().catch(() => { });
      await browser.close().catch(() => { });
      info('\n✅ ========================================== ✅');
      info('👋 РАБОТА ПАРСЕРА ЗАВЕРШЕНА! Браузер закрыт.');
      info('✅ ========================================== ✅');
    }
  } catch (launchErr) {
    handleError(launchErr);
  }
};
run().catch(handleError);
