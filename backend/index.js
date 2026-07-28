'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const fs_1 = require('fs');
const path_1 = require('path');
const config_1 = require('./lib/config');
const state_1 = require('./lib/state');
const browser_1 = require('./lib/browser');
const utils_1 = require('./lib/utils');
const anti_fraud_1 = require('./lib/anti-fraud');
const logger = require('./lib/logger');
const reporter_1 = require('./lib/reporter');
const { cacheProfilePhotoFromPage } = require('./lib/photo-cache');

const normalizeFollowerLimit = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
};

const normalizeConcurrency = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Math.min(20, Math.max(1, Number.isFinite(parsed) ? parsed : 1));
};

const normalizeFollowerRange = (minValue, maxValue, defaultMin = 0) => {
  const min = normalizeFollowerLimit(minValue, defaultMin);
  const rawMax = normalizeFollowerLimit(maxValue);
  return { min, max: rawMax > 0 && rawMax < min ? min : rawMax };
};

const isFollowerCountAllowed = (count, min, max) => {
  const followers = normalizeFollowerLimit(count);
  return followers >= min && (max === 0 || followers <= max);
};

const followerRangeLabel = (min, max) => `${min}–${max === 0 ? '∞' : max}`;

const isAnonymousPhoto = (url) => {
  if (!url) return true;
  // Base64 of 'anonymous_profile_pic' in ig_cache_key
  if (url.includes('YW5vbnltb3VzX3Byb2ZpbGVfcGlj')) return true;
  // Common default/anonymous avatar patterns
  if (/\/\d+_\d+_\d+_n\.(jpg|png)/.test(url) === false && url.includes('anonymous')) return true;
  return false;
};
class RotateAccountError extends Error {
  reason;
  remainingNames;
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
  const rawNames = await config_1.getList('names.txt');
  const shuffledNames = utils_1.shuffleArray(rawNames);
  const [
    donorMinSetting,
    donorMaxSetting,
    targetMinSetting,
    targetMaxSetting,
    concurrencySetting,
  ] = await Promise.all([
    config_1.getSetting('donorFollowersMin'),
    config_1.getSetting('donorFollowersMax'),
    config_1.getSetting('targetFollowersMin'),
    config_1.getSetting('targetFollowersMax'),
    config_1.getSetting('concurrentProfiles'),
  ]);
  const donorFollowers = normalizeFollowerRange(donorMinSetting, donorMaxSetting, 1000);
  const targetFollowers = normalizeFollowerRange(targetMinSetting, targetMaxSetting);
  return {
    viewport: { width, height },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    timeouts: {
      pageLoad: 25000,
      element: 15000,
      inputWait: 15000,
      typingDelayMin: 50,
      typingDelayMax: 150,
    },
    scroll: { maxAttempts: 8, maxRetries: 3 },
    target: {
      cityKeywords: await config_1.getList('cityKeywords.txt'),
      cityBlacklist: await config_1.getList('cityBlacklist.txt'),
      wordsBlacklist: await config_1.getList('wordBlacklist.txt'),
      names: shuffledNames,
      donorFollowersMin: donorFollowers.min,
      donorFollowersMax: donorFollowers.max,
      targetFollowersMin: targetFollowers.min,
      targetFollowersMax: targetFollowers.max,
      concurrency: normalizeConcurrency(concurrencySetting),
    },
  };
};
const SELECTORS = {
  HEADER: 'header',
  DIALOG: 'div[role="dialog"]',
  SEARCH_INPUT: 'div[role="dialog"] input',
  // User provided stable selector for followers link
  FOLLOWERS_LINK: 'main header section a[href*="/followers/"], main header section div:nth-child(2) a',
  // Fallback for followers link
  FOLLOWERS_LINK_FALLBACK: 'a[href*="/followers/"]',
  // Strict Full XPath as per user request
  FOLLOWERS_LINK_STRICT: 'xpath=/html/body/div[1]/div/div/div[2]/div/div/div[1]/div[2]/div[2]/section/main/div/div/header/div/section[2]/div[1]/div[3]/div[2]/a',
  // User provided stable selector for scrollable modal body
  DIALOG_SCROLLABLE:
    'body > div.x1n2onr6.xzkaem6 > div:nth-child(2) > div > div > div.x9f619.x1n2onr6.x1ja2u2z > div > div.x1uvtmcs.x4k7w5x.x1h91t0o.x1beo9mf.xaigb6o.x12ejxvf.x3igimt.xarpa2k.xedcshv.x1lytzrv.x1t2pt76.x7ja8zs.x1n2onr6.x1qrby5j.x1jfb8zj > div > div > div > div > div.x7r02ix.x15fl9t6.x1yw9sn2.x1evh3fb.x4giqqa.xb88tzc.xw2csxc.x1odjw0f.x5fp0pe > div > div > div.x6nl9eh.x1a5l9x9.x7vuprf.x1mg3h75.x1lliihq.x1iyjqo2.xs83m0k.xz65tgg.x1rife3k.x1n2onr6',
  LOADER:
    'div[role="dialog"] [role="progressbar"], div[role="dialog"] svg[aria-label="Loading..."], div[role="dialog"] svg[aria-label="Загрузка..."]',
};
// let currentDonorSkipped = false;
const checkSkipSignal = (contextState) => {
  if (contextState?.skipped) return true;
  const flagPath = path_1.join(utils_1.getRootPath(), 'data', 'skip_donor.flag');
  if (fs_1.existsSync(flagPath)) {
    try {
      fs_1.unlinkSync(flagPath);
      if (contextState) contextState.skipped = true;
      logger.info('⏭️ [СИГНАЛ] Получен сигнал пропуска. Завершаем работу с донором...');
      return true;
    } catch (e) { }
  }
  return false;
};
const randomDelay = (min = 100, max = 300) => utils_1.wait(min + Math.random() * (max - min));
const getInstagramPage = async (context) => {
  const page = context.pages().find((p) => p.url().includes('instagram.com')) || await context.newPage();
  if (!page.url().includes('instagram.com')) {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => { });
  }
  return page;
};
const fetchProfileInfo = async (page, username) => {
  return page.evaluate(async (uname) => {
    try {
      const res = await fetch(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(uname)}`, {
        headers: { 'X-IG-App-ID': '936619743392459' },
      });
      if (!res.ok) return null;

      const json = await res.json();
      const u = json.data?.user;
      if (!u) return null;

      return {
        name: u.full_name || uname,
        bio: u.biography || '',
        photo: u.profile_pic_url_hd || u.profile_pic_url || '',
        fCount: u.edge_followed_by?.count || 0,
        pCount: u.edge_owner_to_timeline_media?.count || 0,
        isPrivate: u.is_private,
      };
    } catch (e) {
      return null;
    }
  }, username);
};
const extractVisibleCandidates = () => {
  const dialog = document.querySelector('div[role="dialog"]');
  if (!dialog) return [];
  const results = [];
  const canvases = dialog.querySelectorAll('canvas');
  canvases.forEach((canvas) => {
    const storyBtn = canvas.closest('div[role="button"]');
    if (!storyBtn || storyBtn.getAttribute('aria-disabled') === 'true') return;
    let parent = storyBtn.parentElement;
    for (let i = 0; i < 6; i++) {
      if (!parent) break;
      const link = parent.querySelector('a[href^="/"]:not([role="button"])');
      if (link && link.textContent.trim().length > 0) {
        const href = link.getAttribute('href');
        if (href && !href.includes('followers')) results.push(`https://www.instagram.com${href}`);
        break;
      }
      parent = parent.parentElement;
    }
  });
  return results;
};
const scrollAndCollectUrls = async (
  page,
  config,
  contextState,
  searchQuery = '',
  initialResponse = null
) => {
  const collectedUrls = new Set();
  const humanEmulation = await (0, config_1.getSetting)('humanEmulation');
  let hasMore = true;
  let lastResponseTime = Date.now();
  let resolveResponse;
  let responseCount = 0;

  // Берём кандидатов из уже выполненного Instagram-запроса.
  // DOM остаётся fallback для изменений формата ответа.
  const onResponse = async (response) => {
    const url = response.url();
    if (url.includes('/api/v1/friendships/') && (url.includes('/followers') || url.includes('friendships_type=followers'))) {
      if (searchQuery) {
        try {
          const urlObj = new URL(url);
          const q = urlObj.searchParams.get('query') || '';
          if (q && q.toLowerCase() !== searchQuery.toLowerCase()) return;
        } catch (e) { }
      }
      try {
        const json = await response.json();
        if (json.status === 'ok') {
          responseCount++;
          hasMore = json.has_more === true || json.has_next_page === true || !!json.next_max_id;
          lastResponseTime = Date.now();
          const users = Array.isArray(json.users) ? json.users : [];
          for (const item of users) {
            const user = item?.user || item;
            const username = String(user?.username || '').trim();
            if (username) {
              collectedUrls.add(`https://www.instagram.com/${username}/`);
            }
          }
          if (resolveResponse) resolveResponse();
        }
      } catch (e) { }
    }
  };

  page.on('response', onResponse);

  try {
    if (initialResponse) {
      await onResponse(initialResponse);
    }

    const modal = page.locator('div[role="dialog"]').first();
    const modalBox = await modal.boundingBox().catch(() => null);
    if (modalBox) {
      await (0, utils_1.humanMouseMove)(page, modalBox.x + modalBox.width / 2, modalBox.y + modalBox.height / 2);
    }

    // 0. Initial wait: Catch results triggered by typing/filling without scrolling
    await Promise.race([
      new Promise(resolve => { resolveResponse = resolve; }),
      humanEmulation
        ? (0, anti_fraud_1.waitWithActivity)(page, 1500)
        : (0, utils_1.wait)(1500),
    ]);
    resolveResponse = null;

    // DOM fallback для ответа неизвестного формата.
    (await page.evaluate(extractVisibleCandidates)).forEach(url => collectedUrls.add(url));

    // If first response already said hasMore=false, exit immediately
    if (!hasMore) {
      logger.info(`      🛑 Конец списка (сразу из первого ответа). Собрано: ${collectedUrls.size}`);
      return Array.from(collectedUrls);
    }

    let noChangeCount = 0;
    let lastCollectedSize = collectedUrls.size;

    for (let i = 0; i < config.scroll.maxAttempts; i++) {
      if (checkSkipSignal(contextState)) break;

      if (!hasMore) {
        logger.info(`      🛑 Достигнут конец списка (hasMore=false).`);
        break;
      }

      // Check if loader is present - if not and still no results, maybe we are at the end
      const loaderVisible = await page.locator(SELECTORS.LOADER).first().isVisible().catch(() => false);
      if (i > 0 && !loaderVisible && responseCount > 0 && !hasMore) break;

      // 1. Smooth scroll emulation (wheel)
      await (0, utils_1.humanScroll)(page, null, 'down', 600 + Math.random() * 400).catch(() => { });

      // 2. Wait for next batch efficiently
      const timeout = humanEmulation ? 5000 : 3000;
      await Promise.race([
        new Promise(resolve => { resolveResponse = resolve; }),
        page.waitForResponse(r => r.url().includes('/friendships/') && r.status() === 200, { timeout: timeout }).catch(() => { }),
        humanEmulation
          ? (0, anti_fraud_1.waitWithActivity)(page, timeout)
          : (0, utils_1.wait)(timeout),
      ]);
      resolveResponse = null;

      // 3. DOM fallback после сетевого ответа
      const visibleStories = await page.evaluate(extractVisibleCandidates);
      visibleStories.forEach(url => collectedUrls.add(url));

      if (collectedUrls.size > lastCollectedSize) {
        logger.info(`      📥 Собрано профилей: ${collectedUrls.size}`);
        lastCollectedSize = collectedUrls.size;
        noChangeCount = 0;
      } else {
        noChangeCount++;
      }

      // Exit if 3 scrolls didn't find anything new AND no loader
      if (noChangeCount >= 3) {
        const isStillLoading = await page.locator(SELECTORS.LOADER).first().isVisible().catch(() => false);
        if (!isStillLoading) {
          logger.info(`      🛑 Список не меняется, завершаем.`);
          break;
        }
      }

      // Exit if we found enough profiles for this search (limit to 25 to save time)
      if (collectedUrls.size >= 25) {
        logger.info(`      🛑 Лимит сбора для одного поиска достигнут.`);
        break;
      }

      if (Date.now() - lastResponseTime > 30000) {
        logger.warn(`      ⚠️ Сбор прерван по таймауту ожидания сети.`);
        break;
      }
    }
  } finally {
    page.off('response', onResponse);
  }

  return Array.from(collectedUrls);
};
const matchesWordsBlacklist = (searchString, wordsBlacklist = []) =>
  wordsBlacklist.length > 0 &&
  wordsBlacklist.some((kw) => searchString.includes(String(kw).trim().toLowerCase()));

const analyzeProfile = async (context, url, config, donor = '') => {
  if (state_1.StateManager.has(url)) return;
  const usernameFromUrl = url.split('/').filter(Boolean).pop() || '';
  if (state_1.StateManager.hasUsername(usernameFromUrl)) {
    await state_1.StateManager.mergeDonorHint(usernameFromUrl, donor, url);
    return;
  }
  const page = await context.newPage();
  logger.info(`      👀 Открываем профиль: ${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeouts.pageLoad });
    await browser_1.takeLiveScreenshot(page);
    await page.waitForSelector('header', { timeout: 10000 });
    await browser_1.takeLiveScreenshot(page);

    const humanEmulation = await (0, config_1.getSetting)('humanEmulation');
    if (humanEmulation) {
      // Micro-interaction: hover over first few posts
      const posts = page.locator('article img').all();
      const postsCount = await posts.then((p) => p.length);
      for (let i = 0; i < Math.min(postsCount, 2); i++) {
        if (Math.random() < 0.5) {
          await (0, utils_1.humanHover)(page, (await posts)[i]);
        }
      }
      await (0, utils_1.daydream)(0.03); // 3% chance to "daydream"
    }

    await utils_1.wait(150);
    const username = url.split('/').filter(Boolean).pop() || '';
    const extracted = await page.evaluate(() => {
      let bioClean = '';
      let fullSearchText = '';
      const header = document.querySelector('header');
      if (header) {
        fullSearchText = header.innerText || '';
        const ulList = header.querySelector('ul');
        if (ulList && ulList.nextElementSibling) {
          bioClean = ulList.nextElementSibling.textContent || '';
        } else {
          const autoSpans = Array.from(header.querySelectorAll('span[dir="auto"]'));
          const spanTexts = autoSpans.map((s) => s.textContent.trim()).filter(Boolean);
          if (spanTexts.length > 0) {
            bioClean = spanTexts.join(' | ');
          }
        }
        const highlightsBlock = header.nextElementSibling;
        if (highlightsBlock) {
          fullSearchText += ' ' + (highlightsBlock.textContent || '');
        }
      }
      return {
        fullSearchText: fullSearchText.replace(/\d+/g, ' '),
        bioClean: bioClean.replace(/\n/g, ' ').trim(),
      };
    });
    const searchString = `${extracted.fullSearchText} ${username}`.toLowerCase();
    const cityKeywords = config.target.cityKeywords || [];
    const cityBlacklist = config.target.cityBlacklist || [];
    const wordsBlacklist = config.target.wordsBlacklist || [];

    if (matchesWordsBlacklist(searchString, wordsBlacklist)) {
      logger.info(`         🚫 Профиль исключён (чёрный список слов): ${username}`);
      await state_1.StateManager.add(url);
      return;
    }

    const matchesWhitelist = cityKeywords.length === 0 || cityKeywords.some((kw) =>
      searchString.includes(kw.toLowerCase())
    );
    const matchesBlacklist = cityBlacklist.length > 0 && cityBlacklist.some((kw) =>
      searchString.includes(kw.toLowerCase())
    );

    const isTarget = matchesWhitelist && !matchesBlacklist;

    if (isTarget) {
      logger.info(`         ✅ Целевой профиль!`);
    } else {
      logger.info(`         📍 Профиль без ключевых слов, но сохраняем. [isInCity=0]`);
    }

    if (isTarget && humanEmulation) {
      // Social Signal: 30% chance to watch story for target profiles
      if (Math.random() < 0.3) {
        logger.info(`         👤 [HUMAN] Целевой профиль. Пробуем посмотреть сторис...`);
        await (0, browser_1.watchStory)(page);
      } else {
        logger.info(`         👤 [HUMAN] Просмотр сторис по рандому пропущен.`);
      }
    }

    logger.info(`         🛠️ Парсим данные (ищем фото)...`);
    const name = await page
      .locator('header h2, header h1, header span[dir="auto"]')
      .first()
      .innerText()
      .catch(() => username);
    const extraData = await page
      .evaluate(async (uname) => {
        let pUrl = '';
        let fCount = 0;
        let postCount = 0;
        try {
          const res = await fetch(`/api/v1/users/web_profile_info/?username=${uname}`, {
            headers: { 'X-IG-App-ID': '936619743392459' },
          });
          if (res.ok) {
            const json = await res.json();
            if (json?.data?.user) {
              if (json.data.user.profile_pic_url_hd) pUrl = json.data.user.profile_pic_url_hd;
              if (json.data.user.edge_followed_by?.count !== undefined)
                fCount = json.data.user.edge_followed_by.count;
              if (json.data.user.edge_owner_to_timeline_media?.count !== undefined)
                postCount = json.data.user.edge_owner_to_timeline_media.count;
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
        // Try to get followers and posts from header if API failed
        if (fCount === 0 || postCount === 0) {
          const spans = Array.from(document.querySelectorAll('header span'));
          spans.forEach((s) => {
            const txt = s.textContent || '';
            const clean = txt.replace(/\s+/g, '').replace(/[.,]/g, '');
            if (fCount === 0 && (txt.includes('followers') || txt.includes('подписчиков'))) {
              const m = clean.match(/^(\d+)/);
              if (m) fCount = parseInt(m[1]);
            }
            if (postCount === 0 && (txt.includes('posts') || txt.includes('публикаций'))) {
              const m = clean.match(/^(\d+)/);
              if (m) postCount = parseInt(m[1]);
            }
          });

          if (fCount === 0) {
            const link = document.querySelector('a[href$="/followers/"]');
            if (link) {
              const span = link.querySelector('span[title]');
              const rawValue = span ? span.getAttribute('title') : link.textContent;
              if (rawValue) {
                const clean = rawValue.replace(/\s+/g, '').replace(/[.,]/g, '');
                const match = clean.match(/^(\d+)/);
                if (match) fCount = parseInt(match[1]);
              }
            }
          }
        }
        return { pUrl, fCount, postCount };
      }, username)
      .catch(() => ({ pUrl: '', fCount: 0, postCount: 0 }));

    const bio = extracted.bioClean;
    const photo = isAnonymousPhoto(extraData.pUrl) ? '' : extraData.pUrl;
    if (isAnonymousPhoto(extraData.pUrl) && extraData.pUrl) {
      logger.warn(`         ⚠️ Обнаружена анонимная аватарка, не сохраняем фото.`);
    }
    const targetFollowersMin = config.target.targetFollowersMin;
    const targetFollowersMax = config.target.targetFollowersMax;
    if (!isFollowerCountAllowed(extraData.fCount, targetFollowersMin, targetFollowersMax)) {
      const range = followerRangeLabel(targetFollowersMin, targetFollowersMax);
      logger.info(
        `         ⏭️ Профиль исключён: ${extraData.fCount} подписчиков, диапазон ${range}`
      );
      await state_1.StateManager.add(url);
      return;
    }
    const profileData = {
      name,
      username,
      bio,
      photo,
      photo_status: photo ? 'pending' : 'missing',
      deferPhotoCache: !!photo,
      url,
      donor,
      followers_count: extraData.fCount,
      publications_count: extraData.postCount,
      posts_count: extraData.postCount,
      isInCity: isTarget ? 1 : 0,
    };
    await state_1.StateManager.saveResult(profileData);
    await state_1.StateManager.add(url);
  } catch (e) {
    if (!e.message.includes('Timeout')) {
      logger.error(`         ❌ Ошибка анализа профиля: ${e.message.split('\n')[0]}`);
    } else {
      logger.error(`         ❌ Ошибка: Timeout при загрузке профиля.`);
    }
  } finally {
    await page.close();
  }
};

/**
 * [HYBRID OPTIMIZATION] Быстрый анализ профиля через API внутри контекста браузера
 */
const analyzeProfileFastInternal = async (context, url, config, donor = '', apiPage = null) => {
  if (state_1.StateManager.has(url)) return;
  const usernameFromUrl = url.split('/').filter(Boolean).pop() || '';
  if (state_1.StateManager.hasUsername(usernameFromUrl)) {
    await state_1.StateManager.mergeDonorHint(usernameFromUrl, donor, url);
    return;
  }

  const username = url.split('/').filter(Boolean).pop() || '';
  logger.info(`      ⚡ Быстрый анализ (API): ${username}`);

  try {
    const page = apiPage || await getInstagramPage(context);
    const data = await fetchProfileInfo(page, username);

    if (!data) {
      logger.warn(`         ⚠️ API не вернул данные, открываем профиль как fallback.`);
      return analyzeProfile(context, url, config, donor);
    }

    const searchString = `${data.name} ${data.bio} ${username}`.toLowerCase();
    const cityKeywords = config.target.cityKeywords || [];
    const cityBlacklist = config.target.cityBlacklist || [];
    const wordsBlacklist = config.target.wordsBlacklist || [];

    if (matchesWordsBlacklist(searchString, wordsBlacklist)) {
      logger.info(`         🚫 Профиль исключён (чёрный список слов): ${username}`);
      await state_1.StateManager.add(url);
      return;
    }

    const matchesWhitelist = cityKeywords.length === 0 || cityKeywords.some((kw) =>
      searchString.includes(kw.toLowerCase())
    );
    const matchesBlacklist = cityBlacklist.length > 0 && cityBlacklist.some((kw) =>
      searchString.includes(kw.toLowerCase())
    );

    const isTarget = matchesWhitelist && !matchesBlacklist;
    const photo = isAnonymousPhoto(data.photo) ? '' : data.photo;
    const targetFollowersMin = config.target.targetFollowersMin;
    const targetFollowersMax = config.target.targetFollowersMax;
    if (!isFollowerCountAllowed(data.fCount, targetFollowersMin, targetFollowersMax)) {
      const range = followerRangeLabel(targetFollowersMin, targetFollowersMax);
      logger.info(`         ⏭️ Профиль исключён: ${data.fCount} подписчиков, диапазон ${range}`);
      await state_1.StateManager.add(url);
      return;
    }

    await state_1.StateManager.saveResult({
      name: data.name,
      username,
      bio: data.bio,
      photo,
      photo_status: photo ? 'pending' : 'missing',
      deferPhotoCache: !!photo,
      url,
      donor,
      followers_count: data.fCount,
      posts_count: data.pCount,
      isInCity: isTarget ? 1 : 0
    });
    await state_1.StateManager.add(url);

    if (isTarget) logger.info(`         ✅ Целевой!`);
  } catch (e) {
    logger.error(`         ❌ Ошибка API анализа: ${e.message}`);
  }
};
const profileAnalysisInFlight = new Map();
const analyzeProfileFast = async (context, url, config, donor = '', apiPage = null) => {
  const username = url.split('/').filter(Boolean).pop()?.toLowerCase() || url;
  const running = profileAnalysisInFlight.get(username);
  if (running) {
    await running;
    await state_1.StateManager.mergeDonorHint(username, donor, url);
    return;
  }

  const task = analyzeProfileFastInternal(context, url, config, donor, apiPage);
  profileAnalysisInFlight.set(username, task);
  try {
    return await task;
  } finally {
    profileAnalysisInFlight.delete(username);
  }
};
const processDonor = async (context, donorUrl, config, totalAccounts = 0) => {
  const contextState = { skipped: false };
  logger.info(`\n==============================================`);
  logger.info(`📂 ОТКРЫВАЕМ ДОНОРА: ${donorUrl}`);
  logger.info(`==============================================`);
  // currentDonorSkipped = false;
  const page = await context.newPage();
  let shouldSkipDonor = false;
  try {
    const humanEmulation = await (0, config_1.getSetting)('humanEmulation');

    if (humanEmulation) {
      logger.info(`👤 [HUMAN] Переходим на главную для поиска донора...`);
      await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
      await (0, browser_1.takeLiveScreenshot)(page);
      await (0, anti_fraud_1.waitWithActivity)(page, 2000);

      // Look for search input
      let searchInput = page
        .locator(
          'input[aria-label="Search input"], input[placeholder="Search"], input[placeholder="Поиск"]'
        )
        .first();
      if ((await searchInput.count()) === 0) {
        const searchIcon = page
          .locator(
            'svg[aria-label="Search"], svg[aria-label="Поисковый запрос"], svg[aria-label="Поиск"]'
          )
          .first();
        if ((await searchIcon.count()) > 0) {
          await searchIcon.click();
          await (0, anti_fraud_1.waitWithActivity)(page, 1500);
          searchInput = page
            .locator(
              'input[aria-label="Search input"], input[placeholder="Search"], input[placeholder="Поиск"]'
            )
            .first();
        }
      }

      if ((await searchInput.count()) > 0) {
        const donorName = donorUrl.split('/').filter(Boolean).pop();
        logger.info(`👤 [HUMAN] Вводим имя донора в поиск: ${donorName}`);
        await (0, utils_1.humanMouseMove)(page, 100, 100);
        await (0, utils_1.humanType)(page, searchInput, donorName, config.timeouts);
        await (0, anti_fraud_1.waitWithActivity)(page, 3000);

        const donorLink = page.locator(`a[href="/${donorName}/"]`).first();
        if ((await donorLink.count()) > 0) {
          await donorLink.click();
          await (0, anti_fraud_1.waitWithActivity)(page, 2000);
          await (0, anti_fraud_1.waitWithActivity)(page, 3000 + Math.random() * 5000);
        } else {
          logger.warn(`⚠️ [HUMAN] Ссылка на донора не найдена в результатах. Переходим напрямую.`);
          await page.goto(donorUrl, { waitUntil: 'domcontentloaded' });
        }
      } else {
        await page.goto(donorUrl, { waitUntil: 'domcontentloaded' });
      }
    } else {
      await page.goto(donorUrl, { waitUntil: 'domcontentloaded' });
    }

    await (0, browser_1.takeLiveScreenshot)(page);
    // 1. Проверка на страницу логина
    if (await (0, browser_1.checkLoginPage)(page)) {
      throw new RotateAccountError('Session expired (login page)', config.target.names);
    }
    // 2. Проверка на приватный аккаунт
    const isPrivate = await page.evaluate(() => {
      const privateText = [
        'Это закрытый аккаунт',
        'This account is private',
        'This Account is Private',
      ];
      return privateText.some((text) => document.body.innerText.includes(text));
    });
    if (isPrivate) {
      logger.info(`   🔒 Пропуск: ${donorUrl} — закрытый аккаунт.`);
      return;
    }
    // 3. Проверка на Action Blocked
    const isBlocked = await page.evaluate(() => {
      const blockText = [
        'попробуйте еще раз позже',
        'try again later',
        'Action Blocked',
        'Действие заблокировано',
      ];
      return blockText.some((text) => document.body.innerText.includes(text));
    });
    if (isBlocked) {
      throw new RotateAccountError('Action Blocked / Shadowban detected', config.target.names);
    }
    logger.info(`   ✅ Страница донора загружена. Ищем кнопку подписчиков (strict mode)...`);
    await (0, utils_1.humanMouseMove)(page, 100, 100);
        
    let followersBtn = page.locator(SELECTORS.FOLLOWERS_LINK_STRICT);
    await followersBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);

    if (!(await followersBtn.isVisible())) {
      // 1. Try by href (standard)
      followersBtn = page.locator('header a:has([title])').first();

      // 2. Try by language-agnostic pattern: Number + any word in the header links
      if (!(await followersBtn.isVisible())) {
        const headerLinks = page.locator('header a, header [role="link"]');
        const count = await headerLinks.count();
        let matchCount = 0;

        for (let i = 0; i < count; i++) {
          const link = headerLinks.nth(i);
          const text = await link.innerText();
          // Matches "123 word", "1.2K word", "1,200 word" in any language
          if (/^[0-9,.KBM\s]+[^\s0-9]/i.test(text.trim())) {
            matchCount++;
            if (matchCount === 2) { // Нам нужно второе совпадение
              followersBtn = link;
              break;
            }
          }
        }
      }

      // 3. Last resort: Common language terms
      if (!(await followersBtn.isVisible())) {
        followersBtn = page.locator('a').filter({ hasText: /followers|подписчиков|abonnés|seguidores|follower/i }).first();
      }
    }

    if (!(await followersBtn.isVisible())) {
      logger.warn(`   ⚠️ Кнопка подписчиков не найдена ни одним способом.`);
      return;
    }

    // 4. Проверка количества подписчиков и сбор инфо о доноре
    const donorInfo = await page
      .evaluate(async (uname) => {
        const name =
          document.querySelector('header h2, header h1, header span[dir="auto"]')?.textContent ||
          uname;

        // Improved Bio collection
        let bio = '';
        const header = document.querySelector('header');
        if (header) {
          const ulList = header.querySelector('ul');
          if (ulList && ulList.nextElementSibling) {
            bio = ulList.nextElementSibling.textContent || '';
          } else {
            const autoSpans = Array.from(header.querySelectorAll('span[dir="auto"]'));
            const spanTexts = autoSpans.map((s) => s.textContent.trim()).filter(Boolean);
            if (spanTexts.length > 0) {
              bio = spanTexts.join(' | ');
            }
          }
        }

        let photo = '';
        let fCount = 0;
        let pCount = 0;
        let followersResolved = false;
        const parseMetric = (value) => {
          const raw = String(value || '').toLowerCase().replace(/\u00a0/g, ' ').trim();
          const match = raw.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(k|m|тыс\.?|млн\.?)?/i);
          if (!match) return null;

          const suffix = (match[2] || '').replace('.', '');
          if (suffix) {
            const base = Number(match[1].replace(/\s/g, '').replace(',', '.'));
            const multiplier = suffix === 'k' || suffix === 'тыс' ? 1000 : 1000000;
            return Number.isFinite(base) ? Math.round(base * multiplier) : null;
          }

          const digits = match[1].replace(/\D/g, '');
          return digits ? Number.parseInt(digits, 10) : null;
        };
        const parseLabeledMetric = (value, labels) => {
          const escapedLabels = labels.join('|');
          const expression = new RegExp(
            `(\\d[\\d\\s.,]*\\s*(?:k|m|тыс\\.?|млн\\.)?)\\s*(?:${escapedLabels})`,
            'i'
          );
          const match = String(value || '').match(expression);
          return match ? parseMetric(match[1]) : null;
        };

        try {
          const res = await fetch(`/api/v1/users/web_profile_info/?username=${uname}`, {
            headers: { 'X-IG-App-ID': '936619743392459' },
          });
          if (res.ok) {
            const json = await res.json();
            if (json?.data?.user) {
              if (json.data.user.profile_pic_url_hd) photo = json.data.user.profile_pic_url_hd;
              if (json.data.user.edge_followed_by?.count !== undefined) {
                fCount = json.data.user.edge_followed_by.count;
                followersResolved = true;
              }
              if (json.data.user.edge_owner_to_timeline_media?.count)
                pCount = json.data.user.edge_owner_to_timeline_media.count;
            }
          }
        } catch (e) { }

        if (!photo) {
          const html = document.documentElement.innerHTML;
          const matches = [...html.matchAll(/"profile_pic_url_hd":"([^"]+)"/g)];
          if (matches.length > 0) {
            const rawUrl = matches[matches.length - 1][1];
            try {
              photo = JSON.parse('"' + rawUrl + '"');
            } catch (e) {
              photo = rawUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
            }
          }
        }
        if (!photo && header) {
          const img = header.querySelector('img');
          if (img) photo = img.getAttribute('src') || img.src || '';
        }

        if (!followersResolved || pCount === 0) {
          if (header) {
            const followersLink = header.querySelector('a[href*="/followers/"]');
            const followerSources = [
              followersLink?.querySelector('[title]')?.getAttribute('title'),
              followersLink?.getAttribute('title'),
              followersLink?.getAttribute('aria-label'),
              followersLink?.textContent,
            ];
            for (const source of followerSources) {
              const parsed = parseMetric(source);
              if (parsed !== null) {
                fCount = parsed;
                followersResolved = true;
                break;
              }
            }

            const items = Array.from(header.querySelectorAll('li'));
            for (const item of items) {
              const text = item.textContent || '';
              const val = parseMetric(text);
              if (val === null) continue;
              if (text.includes('posts') || text.includes('публикаций')) {
                if (pCount === 0) pCount = val;
              } else if (text.includes('followers') || text.includes('подписчиков')) {
                if (!followersResolved) {
                  fCount = val;
                  followersResolved = true;
                }
              }
            }
          }
        }

        if (!followersResolved) {
          const pageDescription =
            document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
            document.querySelector('meta[name="description"]')?.getAttribute('content') ||
            header?.textContent ||
            '';
          const parsed = parseLabeledMetric(pageDescription, [
            'followers',
            'подписчик(?:ов|а|и)?',
            'abonnés',
            'seguidores',
          ]);
          if (parsed !== null) {
            fCount = parsed;
            followersResolved = true;
          }
        }

        return {
          username: uname,
          name,
          bio,
          photo,
          followers_count: fCount,
          followers_resolved: followersResolved,
          publications_count: pCount,
        };
      }, donorUrl.split('/').filter(Boolean).pop())
      .catch((e) => {
        console.error('Error in donor evaluation:', e);
        return {
          username: donorUrl.split('/').filter(Boolean).pop(),
          name: '',
          bio: '',
          photo: '',
          followers_count: 0,
          followers_resolved: false,
          publications_count: 0,
        };
      });

    // Save donor info
    const donorPhoto = isAnonymousPhoto(donorInfo.photo) ? '' : donorInfo.photo;
    if (isAnonymousPhoto(donorInfo.photo) && donorInfo.photo) {
      logger.warn(`   ⚠️ Обнаружена анонимная аватарка донора, не сохраняем фото.`);
    }
    const donorPhotoCache = donorPhoto
      ? await cacheProfilePhotoFromPage(page, donorPhoto).catch((e) => ({
        success: false,
        status: 'failed',
        error: e.message,
      }))
      : { success: false, status: 'missing' };
    if (donorPhoto && !donorPhotoCache.success) {
      logger.warn(`   ⚠️ Фото донора найдено, но локально не сохранено: ${donorPhotoCache.error || donorPhotoCache.status}`);
    }
    await state_1.StateManager.saveDonorInfo({
      username: donorInfo.username,
      name: donorInfo.name,
      bio: donorInfo.bio,
      photo: donorPhoto,
      photo_local: donorPhotoCache.localPath || '',
      photo_cached_at: donorPhotoCache.cachedAt || null,
      photo_status: donorPhotoCache.status || 'missing',
      followers_count: donorInfo.followers_count,
      posts_count: donorInfo.publications_count,
    });

    // [NEW] Проверка донора на соответствие городам (WhiteList и BlackList)
    const cityKeywords = config.target.cityKeywords || [];
    const cityBlacklist = config.target.cityBlacklist || [];

    const donorSearchString = `${donorInfo.name} ${donorInfo.bio} ${donorInfo.username}`.toLowerCase();

    const matchesWhitelist = cityKeywords.length === 0 || cityKeywords.some(kw => donorSearchString.includes(kw.toLowerCase()));
    const matchesBlacklist = cityBlacklist.length > 0 && cityBlacklist.some(kw =>
      donorSearchString.includes(String(kw).trim().toLowerCase())
    );

    if (!matchesWhitelist || matchesBlacklist) {
      if (!matchesWhitelist) {
        logger.info(`   📍 Донор не содержит обязательных ключевых слов города (WhiteList). Пропускаем...`);
      } else {
        logger.info(`   📍 Донор содержит запрещенные ключевые слова города (${cityBlacklist}). Пропускаем...`);
      }
      await state_1.StateManager.addDonor(donorUrl);
      return;
    }

    const parsedCount = donorInfo.followers_count;
    const donorFollowersMin = config.target.donorFollowersMin;
    const donorFollowersMax = config.target.donorFollowersMax;
    if (!donorInfo.followers_resolved) {
      logger.warn(
        `   ⚠️ Не удалось определить подписчиков ${donorUrl}. Донор оставлен в очереди для повторной проверки.`
      );
      return { retry: true };
    }
    if (!isFollowerCountAllowed(parsedCount, donorFollowersMin, donorFollowersMax)) {
      const range = followerRangeLabel(donorFollowersMin, donorFollowersMax);
      logger.info(
        `   ⏭️ Пропуск и удаление: ${donorUrl} — ${parsedCount} подписчиков, диапазон ${range}`
      );
      await state_1.StateManager.addDonor(donorUrl);
      return;
    }
    await followersBtn.click();
    await browser_1.takeLiveScreenshot(page);
    await page.waitForSelector('div[role="dialog"]', { timeout: 10000 });
    logger.info(`   ✅ Список подписчиков открыт.`);
    const searchInput = page.locator(SELECTORS.SEARCH_INPUT).first();
    await searchInput.waitFor({ state: 'visible', timeout: config.timeouts.inputWait });
    let emptyResultsCount = 0;
    let namesToSearch = config.target.names;
    let checkedCount = 0;
    for (let nameIdx = 0; nameIdx < namesToSearch.length; nameIdx++) {
      const name = namesToSearch[nameIdx];

      if (state_1.StateManager.isChecked(donorUrl, name)) {
        checkedCount++;
        continue;
      }

      logger.info(`\n   🔎 ПОИСК ПО ИМЕНИ: "${name}"`);
      if (checkSkipSignal(contextState)) {
        break;
      }
      await searchInput.click({ clickCount: 3 });
      await (0, utils_1.waitAfterEvent)();
      await page.keyboard.press('Backspace');
      await (0, utils_1.waitAfterEvent)();
      try {
        await page.waitForSelector(SELECTORS.LOADER, { state: 'hidden', timeout: 5000 });
      } catch (e) { }
      const initialResponsePromise = page.waitForResponse((response) => {
        const url = response.url();
        if (
          !url.includes('/api/v1/friendships/') ||
          !(url.includes('/followers') || url.includes('friendships_type=followers')) ||
          response.status() !== 200
        ) return false;
        try {
          const query = new URL(url).searchParams.get('query') || '';
          return query.toLowerCase() === name.toLowerCase();
        } catch (_e) {
          return false;
        }
      }, { timeout: 8000 }).catch(() => null);
      await (0, utils_1.humanType)(page, searchInput, name, config.timeouts);

      logger.info(`      ⏳ Ждем выдачу результатов от Инстаграма...`);
      try {
        await page.waitForSelector(SELECTORS.LOADER, { state: 'hidden', timeout: 5000 });
      } catch (e) { }
      await (0, browser_1.takeLiveScreenshot)(page);
      const initialResponse = await initialResponsePromise;
      const candidates = await scrollAndCollectUrls(
        page,
        config,
        contextState,
        name,
        initialResponse
      );
      const newCandidates = candidates.filter((candidateUrl) => !state_1.StateManager.has(candidateUrl));
      const skippedCount = candidates.length - newCandidates.length;
      logger.info(`      📊 ИТОГИ СБОРА ССЫЛОК:`);
      logger.info(`         • Всего найдено (со сторис): ${candidates.length}`);
      logger.info(`         • Пропущено (уже в истории): ${skippedCount}`);
      logger.info(`         • Идем проверять: ${newCandidates.length}`);

      if (newCandidates.length > 0) {
        logger.info(`      🚀 Обрабатываем новые профили пачками...`);
        const humanEmulation = await (0, config_1.getSetting)('humanEmulation');

        const CHUNK_SIZE = config.target.concurrency;

        for (let i = 0; i < newCandidates.length; i += CHUNK_SIZE) {
          if (checkSkipSignal(contextState)) {
            shouldSkipDonor = true;
            break;
          }
          const chunk = newCandidates.slice(i, i + CHUNK_SIZE);

          const donorName = donorUrl.split('/').filter(Boolean).pop() || '';
          const profileResults = await Promise.allSettled(
            chunk.map((url) => analyzeProfileFast(context, url, config, donorName, page))
          );
          for (const result of profileResults) {
            if (result.status === 'rejected') {
              logger.warn(`         ⚠️ Ошибка параллельной проверки: ${result.reason?.message || result.reason}`);
            }
          }

          if (humanEmulation) {
            const delay = 2000 + Math.random() * 2000;
            logger.info(`👤 [HUMAN] Пауза ${Math.round(delay / 1000)}с после пачки профилей...`);
            await (0, anti_fraud_1.waitWithActivity)(page, delay);
          } else {
            await randomDelay(100, 300);
          }

          if (shouldSkipDonor) break;
        }
      }

      emptyResultsCount = newCandidates.length === 0 ? emptyResultsCount + 1 : 0;

      if (newCandidates.length === 0 && emptyResultsCount >= 3) {
        if (totalAccounts > 1) {
          logger.warn(`⚠️ 3 ПУСТЫХ РЕЗУЛЬТАТА ПОДРЯД. СКОРЕЕ ВСЕГО ШЕДОУБАН. ИНИЦИИРУЕМ СМЕНУ ПРОФИЛЯ...`);
          throw new RotateAccountError('Shadowban (3 empty results)', namesToSearch.slice(nameIdx));
        } else {
          logger.warn(`⚠️ 3 ПУСТЫХ РЕЗУЛЬТАТА ПОДРЯД. ВОЗМОЖЕН ШЕДОУБАН. ПРОДОЛЖАЕМ (ТОЛЬКО 1 АККАУНТ ДЛЯ ЗАДАЧИ).`);
          emptyResultsCount = 0;
        }
      }
      await state_1.StateManager.markChecked(donorUrl, name);

      if (shouldSkipDonor) break;
    }

    if (checkedCount === namesToSearch.length) {
      logger.info(`   ⏭️ Все имена для донора ${donorUrl} уже были проверены ранее.`);
      await state_1.StateManager.addDonor(donorUrl);
    }

  } catch (e) {
    if (e.name === 'RotateAccountError') {
      throw e;
    }
    logger.error(`   ❌ КРИТИЧЕСКАЯ ОШИБКА ДОНОРА: ${e.message}`);
    await (0, reporter_1.saveCrashReport)(
      page,
      e,
      `donor_${donorUrl.split('/').filter(Boolean).pop()}`
    );
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
  const accounts = await (0, config_1.getAllAccounts)('index');
  let currentAccountIndex = 0;
  await state_1.StateManager.init();
  const donors = await state_1.StateManager.loadDonors();
  if (!donors.length) {
    logger.warn('⚠️ [ОШИБКА] Список доноров в config/profiles.txt пуст.');
    return;
  }
  logger.info(`🎯 Загружено доноров: ${donors.length}`);
  const setupBrowser = async () => {
    let proxy = null;
    let cookies = [];
    let fingerprint = null;
    if (accounts.length > 0) {
      proxy = accounts[currentAccountIndex].proxy;
      cookies = accounts[currentAccountIndex].cookies;
      fingerprint = accounts[currentAccountIndex].fingerprint;

      if (!cookies || cookies.length === 0) {
        const errMsg = `❌ [АККАУНТ] У аккаунта "${accounts[currentAccountIndex].name}" нет куки. Пожалуйста, авторизуйте его сначала.`;
        logger.error(errMsg);
        throw new Error(errMsg);
      }
    } else {
      logger.warn('⚠️ Нет выбранных аккаунтов для парсера. Прямое соединение без кук.');
    }
    const showBrowser = await (0, config_1.isShowBrowserEnabled)();
    logger.info(`🌐 Запуск браузера (${showBrowser ? 'видимый' : 'headless'})...`);
    logger.info(`📡 Прокси: ${proxy ? proxy.server : 'ПРЯМОЕ СОЕДИНЕНИЕ'}`);
    logger.info(`🍪 Загружено куки: ${cookies.length}`);
    if (fingerprint) {
      logger.info(
        `🎭 Применен уникальный отпечаток браузера: ${fingerprint.userAgent.substring(0, 50)}...`
      );
    }
    const configWithCreds = {
      ...CONFIG,
      id: accounts[currentAccountIndex]?.id,
      proxy,
      cookies,
      fingerprint,
    };
    const isHeadless = !(await (0, config_1.isShowBrowserEnabled)());
    return await (0, browser_1.createBrowserContext)(configWithCreds, isHeadless);
  };
  let { browser, context } = await setupBrowser();
  await (0, browser_1.optimizeContextForScraping)(context);
  let liveViewInterval = (0, browser_1.startLiveView)(context);
  const searchNames = await (0, config_1.getList)('names.txt');
  const donorQueue = [];
  for (const donor of donors) {
    if (state_1.StateManager.hasDonor(donor)) continue;
    const donorUrl = typeof donor === 'object' ? donor.url : donor;
    const allChecked = searchNames.every((name) =>
      state_1.StateManager.isChecked(donorUrl, name)
    );
    if (allChecked) {
      await state_1.StateManager.addDonor(donorUrl);
      continue;
    }
    donorQueue.push({ donor, names: null });
  }

  const donorConcurrency = CONFIG.target.concurrency;
  logger.info(
    `🚀 Worker pool: ${Math.min(donorConcurrency, donorQueue.length)} доноров × до ${donorConcurrency} профилей`
  );
  while (donorQueue.length > 0) {
    let rotationError = null;
    const workerCount = Math.min(donorConcurrency, donorQueue.length);
    const runDonorWorker = async (workerId) => {
      while (donorQueue.length > 0 && !rotationError) {
        const task = donorQueue.shift();
        const donorUrl = typeof task.donor === 'object' ? task.donor.url : task.donor;
        if (state_1.StateManager.hasDonor(donorUrl)) continue;

        const donorConfig = JSON.parse(JSON.stringify(CONFIG));
        donorConfig.target.names =
          task.names?.length > 0 ? task.names : (0, utils_1.shuffleArray)(searchNames);
        logger.info(`🧵 Worker ${workerId}: открыт ${donorUrl}. В очереди: ${donorQueue.length}`);

        try {
          const result = await processDonor(
            context,
            donorUrl,
            donorConfig,
            accounts.length
          );
          if (!result?.retry) await state_1.StateManager.addDonor(donorUrl);
        } catch (error) {
          if (error.name === 'RotateAccountError') {
            task.names = error.remainingNames;
            donorQueue.unshift(task);
            rotationError ||= error;
            return;
          }
          if (
            /Target page, context or browser has been closed|Page closed|Target closed/i.test(
              error.message || ''
            )
          ) {
            logger.warn(`   ⚠️ Окно закрылось на доноре ${donorUrl}. Повторим при следующем запуске.`);
          } else {
            logger.error(`   ❌ Ошибка обработки донора ${donorUrl}: ${error.message}`);
          }
        }
      }
    };

    await Promise.all(
      Array.from({ length: workerCount }, (_, index) => runDonorWorker(index + 1))
    );
    if (!rotationError) break;

    const isRotationNeeded = accounts.length > 1;
    logger.info(
      isRotationNeeded
        ? `🔄 ПЕРЕКЛЮЧЕНИЕ ПРОФИЛЯ: ${rotationError.reason}`
        : `🔄 ПЕРЕЗАГРУЗКА СЕССИИ: ${rotationError.reason}`
    );
    clearInterval(liveViewInterval);
    await browser.close();
    if (isRotationNeeded) {
      currentAccountIndex = (currentAccountIndex + 1) % accounts.length;
      logger.info(`🔀 Переключились на аккаунт #${currentAccountIndex + 1} из ${accounts.length}`);
    } else {
      logger.warn(`⚠️ Только один аккаунт доступен. Ждем 30 сек перед повторной попыткой...`);
      await (0, utils_1.wait)(30000);
    }
    const setup = await setupBrowser();
    browser = setup.browser;
    context = setup.context;
    await (0, browser_1.optimizeContextForScraping)(context);
    liveViewInterval = (0, browser_1.startLiveView)(context);
  }
  clearInterval(liveViewInterval);
  await browser.close();
  logger.info('\n✅ ========================================== ✅');
  logger.info('👋 РАБОТА ПОЛНОСТЬЮ ЗАВЕРШЕНА! Все результаты сохранены.');
  logger.info('✅ ========================================== ✅');
};
run().catch(console.error);
