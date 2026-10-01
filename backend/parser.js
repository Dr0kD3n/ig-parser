const reporter_1 = require('./lib/reporter');
const { AppError } = require('./lib/errors');
const config_1 = require('./lib/config');
const state_1 = require('./lib/state');
const browser_1 = require('./lib/browser');
const utils_1 = require('./lib/utils');
const { info, warn } = require('./lib/logger');
const { handleError } = require('./lib/error-handler');
const { evaluateDonor, rankDonorCandidates, splitAliases } = require('./lib/donor-relevance');

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
      const cityQuery = splitAliases(city)[0] || city;
      const nicheQuery = splitAliases(niche)[0] || niche;
      combined.push({ keyword: `${cityQuery} ${nicheQuery}`, city, niche });
    }
  }
  return shuffleArray(combined);
};

const getUsernameFromUrl = (url) => {
  try {
    return new URL(url).pathname.split('/').filter(Boolean)[0] || '';
  } catch {
    return '';
  }
};

const fetchDonorProfile = async (page, username) => {
  return page.evaluate(async (uname) => {
    const headers = {
      'X-IG-App-ID': '936619743392459',
      'X-Requested-With': 'XMLHttpRequest',
    };
    const normalizeUser = (user) => {
      if (!user) return null;
      let businessAddress = {};
      try {
        businessAddress = typeof user.business_address_json === 'string'
          ? JSON.parse(user.business_address_json)
          : user.business_address_json || {};
      } catch {
        // Invalid business address must not discard otherwise usable profile data.
      }
      const posts = user.edge_owner_to_timeline_media?.edges || [];
      return {
        username: user.username || uname,
        fullName: user.full_name || '',
        biography: user.biography || '',
        category: user.category_name || user.category || '',
        userId: String(user.pk || user.pk_id || user.id || ''),
        cityName: user.city_name || businessAddress.city_name || '',
        address: [
          user.address_street,
          businessAddress.street_address,
          businessAddress.zip_code,
          businessAddress.city_name,
          businessAddress.region_name,
        ].filter(Boolean).join(' '),
        postCaptions: posts
          .map((edge) => edge.node?.edge_media_to_caption?.edges?.[0]?.node?.text || '')
          .filter(Boolean),
        postLocations: posts
          .map((edge) => edge.node?.location?.name || '')
          .filter(Boolean),
      };
    };
    try {
      const response = await fetch(
        `/api/v1/users/web_profile_info/?username=${encodeURIComponent(uname)}`,
        { headers }
      );
      if (!response.ok) {
        return { profile: null, source: '', error: `web:${response.status}` };
      }
      const json = await response.json();
      const profile = normalizeUser(json.data?.user);
      return profile
        ? { profile, source: 'web', error: '' }
        : { profile: null, source: '', error: 'web:empty' };
    } catch {
      return { profile: null, source: '', error: 'web:network' };
    }
  }, username);
};

const SEARCH_EXCLUDED_PATHS = [
  'accounts',
  'about',
  'direct',
  'explore',
  'legal',
  'p',
  'reel',
  'reels',
  'settings',
  'stories',
  'web',
];

const collectSearchPanelCandidates = async (searchInput) => {
  return searchInput.evaluate((input, excludedPaths) => {
    const excluded = new Set(excludedPaths);
    const parseProfileLink = (anchor) => {
      try {
        const url = new URL(anchor.href, window.location.origin);
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length !== 1) return null;
        const username = parts[0];
        if (excluded.has(username.toLowerCase()) || !/^[a-z0-9._]{1,30}$/i.test(username)) {
          return null;
        }
        const lines = String(anchor.innerText || '')
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        const fullName = lines
          .filter((line) => line.toLowerCase() !== username.toLowerCase())
          .join(' ');
        return { username, fullName, userId: '' };
      } catch {
        return null;
      }
    };
    const profileLinks = (root) => [...root.querySelectorAll('a[href]')]
      .map((anchor) => ({ anchor, candidate: parseProfileLink(anchor) }))
      .filter((item) => item.candidate);

    let container = null;
    let ancestor = input.parentElement;
    while (ancestor && ancestor !== document.body) {
      if (profileLinks(ancestor).length > 0) {
        container = ancestor;
        break;
      }
      ancestor = ancestor.parentElement;
    }

    if (!container) {
      const fallbacks = [
        ...document.querySelectorAll(
          'div[role="dialog"], div[style*="position: fixed"], div[style*="position: absolute"]'
        ),
      ];
      container = fallbacks
        .map((element) => ({ element, count: profileLinks(element).length }))
        .filter((item) => item.count > 0)
        .sort((a, b) => b.count - a.count)[0]?.element || null;
    }

    if (!container) return { candidates: [], canScroll: false, container: 'panel-not-found' };

    const candidates = profileLinks(container).map((item) => item.candidate);
    const scrollTargets = [container, ...container.querySelectorAll('div')]
      .filter((element) => element.scrollHeight - element.clientHeight > 80)
      .map((element) => ({
        element,
        resultCount: profileLinks(element).length,
        overflow: element.scrollHeight - element.clientHeight,
      }))
      .filter((item) => item.resultCount > 0)
      .sort((a, b) => b.resultCount - a.resultCount || b.overflow - a.overflow);
    const scrollTarget = scrollTargets[0]?.element;
    let canScroll = false;
    if (scrollTarget) {
      const before = scrollTarget.scrollTop;
      const distance = Math.max(400, scrollTarget.clientHeight * 0.8);
      scrollTarget.scrollTop = Math.min(
        scrollTarget.scrollTop + distance,
        scrollTarget.scrollHeight - scrollTarget.clientHeight
      );
      scrollTarget.dispatchEvent(new Event('scroll', { bubbles: true }));
      canScroll = scrollTarget.scrollTop > before ||
        scrollTarget.scrollTop + scrollTarget.clientHeight < scrollTarget.scrollHeight - 5;
    }

    return {
      candidates,
      canScroll,
      container: container.getAttribute('role') || container.tagName.toLowerCase(),
    };
  }, SEARCH_EXCLUDED_PATHS);
};

const searchProfilesInInstagramUi = async (page, searchInput, keyword) => {
  await (0, utils_1.humanClick)(page, searchInput, { clickCount: 1 });
  await searchInput.fill('');
  await (0, utils_1.wait)(250);
  await searchInput.pressSequentially(keyword, {
    delay: Math.floor(Math.random() * 50) + 55,
  });
  info(`⌨️ [UI] Запрос введен в поиск Instagram: "${keyword}"`);
  await (0, browser_1.takeLiveScreenshot)(page);
  await (0, utils_1.wait)(3000);

  const candidates = new Map();
  let panel = 'unknown';
  let stalledRounds = 0;
  for (let round = 0; round < 8 && candidates.size < 50; round++) {
    const result = await collectSearchPanelCandidates(searchInput);
    panel = result.container;
    const before = candidates.size;
    for (const candidate of result.candidates) {
      candidates.set(candidate.username.toLowerCase(), candidate);
    }
    stalledRounds = candidates.size === before ? stalledRounds + 1 : 0;
    if ((!result.canScroll && round > 0) || stalledRounds >= 2) break;
    await (0, utils_1.wait)(900 + Math.random() * 500);
  }

  info(`🔎 [UI] Панель: ${panel} | Собрано профилей: ${candidates.size}`);
  return [...candidates.values()];
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
  const profileCache = new Map();
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
    const isHeadless = !(await (0, config_1.isShowBrowserEnabled)());

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
      await (0, utils_1.wait)(3000);
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
        await (0, utils_1.wait)(2000);
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
            await (0, utils_1.wait)(1000);

            const uiCandidates = await searchProfilesInInstagramUi(
              page,
              searchInputLocator,
              keyword
            );

            await (0, browser_1.takeLiveScreenshot)(page);
            await (0, utils_1.wait)(500);

            const uniqueCandidates = [...new Map(
              uiCandidates.map((candidate) => [candidate.username.toLowerCase(), candidate])
            ).values()];
            const rankedCandidates = rankDonorCandidates(uniqueCandidates, {
              city,
              cities: CONFIG.cities,
              niche,
              cityBlacklist: CONFIG.citiesBlacklist,
              wordsBlacklist: CONFIG.wordsBlacklist,
            });
            // Данные поисковой панели используем первыми. Глубоко проверяем только лучшие 10.
            const finalCandidates = rankedCandidates.slice(0, 10);
            const donorsToSave = [];
            let cacheHits = 0;
            for (const candidate of finalCandidates) {
              const link = `https://www.instagram.com/${candidate.username}/`;
              const normLink = (0, config_1.normalizeUrl)(link);
              if (collectedUrls.has(normLink)) continue;

              const searchRelevance = evaluateDonor(candidate, {
                city,
                cities: CONFIG.cities,
                niche,
                cityBlacklist: CONFIG.citiesBlacklist,
                wordsBlacklist: CONFIG.wordsBlacklist,
              });
              if (searchRelevance.accepted) {
                collectedUrls.add(normLink);
                donorsToSave.push({ url: normLink, niche, city, keyword });
                info(
                  `⚡ @${candidate.username} добавлен из выдачи: город подтверждён через ${searchRelevance.evidence}`
                );
                if (donorsToSave.length >= 10) break;
                continue;
              }

              const username = getUsernameFromUrl(normLink);
              const cacheKey = username.toLowerCase();
              const cached = profileCache.has(cacheKey);
              let profileResult = profileCache.get(cacheKey);
              if (!cached) {
                await (0, utils_1.wait)(1800 + Math.random() * 2200);
                profileResult = await fetchDonorProfile(page, username);
              }
              if (profileResult?.profile && !cached) profileCache.set(cacheKey, profileResult);
              if (cached) {
                cacheHits++;
              }
              let profile = profileResult?.profile;
              if (!profile) {
                const searchFallback = evaluateDonor(candidate, {
                  city,
                  cities: CONFIG.cities,
                  niche,
                  cityBlacklist: CONFIG.citiesBlacklist,
                  wordsBlacklist: CONFIG.wordsBlacklist,
                });
                if (!searchFallback.accepted) {
                  warn(`⚠️ Профиль ${normLink} пропущен: ${profileResult?.error || 'данные недоступны'}`);
                  continue;
                }
                profile = candidate;
                info(`⚡ @${username} подтверждён по username/full_name; profile API: ${profileResult?.error || 'недоступен'}`);
              }

              const relevance = evaluateDonor(profile, {
                city,
                cities: CONFIG.cities,
                niche,
                cityBlacklist: CONFIG.citiesBlacklist,
                wordsBlacklist: CONFIG.wordsBlacklist,
              });
              if (!relevance.accepted) {
                info(`⏭️ @${username} отклонён: ${relevance.reason}`);
                continue;
              }

              info(`✅ @${username} принят: город подтверждён через ${relevance.evidence}`);
              collectedUrls.add(normLink);
              donorsToSave.push({ url: normLink, niche, city, keyword });
              if (donorsToSave.length >= 10) break;
            }
            await state_1.StateManager.saveDiscoveredDonors(donorsToSave);
            info(`✅ Найдено: ${uniqueCandidates.length} | После ранжирования: ${finalCandidates.length} | Кеш: ${cacheHits} | Новых: ${donorsToSave.length}`);
            await (0, utils_1.wait)(5000 + Math.random() * 4000);
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
