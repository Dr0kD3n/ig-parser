'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const fs_1 = require('fs');
const path_1 = require('path');
const config_1 = require('./lib/config');
const state_1 = require('./lib/state');
const browser_1 = require('./lib/browser');
const utils_1 = require('./lib/utils');
const logger = require('./lib/logger');
const reporter_1 = require('./lib/reporter');

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
    scroll: { maxAttempts: 15, maxRetries: 3 },
    target: {
      cityKeywords: await config_1.getList('cityKeywords.txt'),
      names: shuffledNames,
    },
  };
};
const SELECTORS = {
  HEADER: 'header',
  DIALOG: 'div[role="dialog"]',
  SEARCH_INPUT: 'div[role="dialog"] input',
  FOLLOWERS_LINK: 'a[href$="/followers/"]',
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
const scrollAndCollectUrls = async (page, config, contextState) => {
  const collectedUrls = new Set();
  let previousHeight = 0;
  let sameHeightCount = 0;
  const humanEmulation = await (0, config_1.getSetting)('humanEmulation');

  logger.info(`      🔽 Начинаем скролл списка...`);
  for (let i = 0; i < config.scroll.maxAttempts; i++) {
    if (checkSkipSignal(contextState)) return [];
    const visible = await page.evaluate(extractVisibleCandidates);
    visible.forEach((url) => collectedUrls.add(url));

    const scrollInfo = await page.evaluate(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return { found: false };

      const scrollable = Array.from(dialog.querySelectorAll('div')).find((el) => {
        const s = window.getComputedStyle(el);
        return s.overflowY === 'auto' || s.overflowY === 'scroll';
      });

      if (!scrollable) return { found: false };

      // Add a temporary ID to the scrollable element to target it safely in humanScroll
      const id = 'ig-scrollable-' + Math.random().toString(36).substr(2, 9);
      scrollable.setAttribute('data-scroll-id', id);

      return {
        found: true,
        selector: `div[data-scroll-id="${id}"]`,
        scrollHeight: scrollable.scrollHeight,
        clientHeight: scrollable.clientHeight,
      };
    });

    if (humanEmulation) {
      if (scrollInfo.found) {
        await (0, utils_1.humanScroll)(
          page,
          scrollInfo.selector,
          'down',
          400 + Math.random() * 200
        );
        if (Math.random() < 0.2) {
          await (0, utils_1.wait)(300 + Math.random() * 500);
          await (0, utils_1.humanScroll)(
            page,
            scrollInfo.selector,
            'up',
            100 + Math.random() * 100
          );
          await (0, utils_1.wait)(500);
        }
      } else {
        // Fallback to window scroll if no dialog found
        await (0, utils_1.humanScroll)(page, null, 'down', 600);
      }
    } else {
      if (scrollInfo.found) {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollTop = el.scrollHeight;
        }, scrollInfo.selector);
      } else {
        await page.mouse.wheel(0, 600);
      }
      await utils_1.wait(50);
    }

    try {
      await page.waitForSelector(SELECTORS.LOADER, { state: 'hidden', timeout: 3000 });
    } catch (e) { }
    await utils_1.wait(50);
    const newHeight = scrollInfo.found
      ? await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return el ? el.scrollHeight : false;
      }, scrollInfo.selector)
      : false;
    if (newHeight === previousHeight) {
      sameHeightCount++;
      if (sameHeightCount >= config.scroll.maxRetries) {
        logger.info(`      🛑 Достигнут конец списка (или лимит подгрузки).`);
        break;
      }
      await (0, utils_1.wait)(250);
    } else {
      sameHeightCount = 0;
    }
    previousHeight = newHeight || 0;
    if ((i + 1) % 3 === 0) {
      logger.info(
        `      🔄 Скролл ${i + 1}/${config.scroll.maxAttempts} | Собрано профилей: ${collectedUrls.size}`
      );
    }
  }
  return Array.from(collectedUrls);
};
const analyzeProfile = async (context, url, config, donor = '') => {
  if (state_1.StateManager.has(url)) return;
  await state_1.StateManager.add(url);
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
    const isTarget = config.target.cityKeywords.some((kw) =>
      searchString.includes(kw.toLowerCase())
    );

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
    const profileData = {
      name,
      username,
      bio,
      photo,
      url,
      donor,
      followers_count: extraData.fCount,
      publications_count: extraData.postCount,
      posts_count: extraData.postCount,
      isInCity: isTarget ? 1 : 0,
    };
    await state_1.StateManager.saveResult(profileData);
  } catch (e) {
    if (!e.message.includes('Timeout')) {
      logger.error(`         ❌ Ошибка анализа профиля: ${e.message.split('\n')[0]}`);
    } else {
      logger.error(`         ❌ Ошибка: Timeout при загрузке профиля.`);
    }
    await (0, reporter_1.saveCrashReport)(
      page,
      e,
      `analyze_profile_${url.split('/').filter(Boolean).pop()}`
    );
  } finally {
    await page.close();
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
      await (0, utils_1.wait)(2000);

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
          await (0, utils_1.wait)(1500);
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
        await (0, utils_1.wait)(3000);

        const donorLink = page.locator(`a[href="/${donorName}/"]`).first();
        if ((await donorLink.count()) > 0) {
          await donorLink.click();
          await (0, utils_1.wait)(2000);
          // 👤 [HUMAN] Engagement pause - "reading" the profile
          await (0, utils_1.wait)(3000 + Math.random() * 5000);
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
    logger.info(`   ✅ Страница донора загружена. Ищем кнопку подписчиков...`);
    const followersBtn = page.locator(SELECTORS.FOLLOWERS_LINK);
    await followersBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null);
    if (!(await followersBtn.isVisible())) {
      logger.warn(`   ⚠️ Кнопка подписчиков не найдена (возможно, аккаунт пуст или скрыт).`);
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

        try {
          const res = await fetch(`/api/v1/users/web_profile_info/?username=${uname}`, {
            headers: { 'X-IG-App-ID': '936619743392459' },
          });
          if (res.ok) {
            const json = await res.json();
            if (json?.data?.user) {
              if (json.data.user.profile_pic_url_hd) photo = json.data.user.profile_pic_url_hd;
              if (json.data.user.edge_followed_by?.count)
                fCount = json.data.user.edge_followed_by.count;
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

        if (fCount === 0 || pCount === 0) {
          if (header) {
            const items = Array.from(header.querySelectorAll('li'));
            for (const item of items) {
              const text = item.textContent || '';
              const clean = text.replace(/\s+/g, '').replace(/[.,]/g, '');
              const numMatch = clean.match(/^(\d+)/);
              if (!numMatch) continue;

              const val = parseInt(numMatch[1]);
              if (text.includes('posts') || text.includes('публикаций')) {
                if (pCount === 0) pCount = val;
              } else if (text.includes('followers') || text.includes('подписчиков')) {
                if (fCount === 0) fCount = val;
              }
            }
          }
        }

        return {
          username: uname,
          name,
          bio,
          photo,
          followers_count: fCount,
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
          publications_count: 0,
        };
      });

    // Save donor info
    const donorPhoto = isAnonymousPhoto(donorInfo.photo) ? '' : donorInfo.photo;
    if (isAnonymousPhoto(donorInfo.photo) && donorInfo.photo) {
      logger.warn(`   ⚠️ Обнаружена анонимная аватарка донора, не сохраняем фото.`);
    }
    await state_1.StateManager.saveDonorInfo({
      username: donorInfo.username,
      name: donorInfo.name,
      bio: donorInfo.bio,
      photo: donorPhoto,
      followers_count: donorInfo.followers_count,
      posts_count: donorInfo.publications_count,
    });
    const parsedCount = donorInfo.followers_count;
    if (parsedCount < 1000) {
      logger.info(
        `   ⏭️ Пропуск и удаление: ${donorUrl} — слишком мало подписчиков. (Парсинг: ${parsedCount} < 1000)`
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
    for (let nameIdx = 0; nameIdx < namesToSearch.length; nameIdx++) {
      const name = namesToSearch[nameIdx];
      logger.info(`\n   🔎 ПОИСК ПО ИМЕНИ: "${name}"`);
      if (checkSkipSignal(contextState)) {
        break;
      }
      await searchInput.click({ clickCount: 3 });
      await page.keyboard.press('Backspace');
      try {
        await page.waitForSelector(SELECTORS.LOADER, { state: 'hidden', timeout: 2000 });
      } catch (e) { }
      const typeDelay = Math.floor(Math.random() * (60 - 20 + 1) + 20);
      await searchInput.pressSequentially(name, { delay: typeDelay });
      logger.info(`      ⏳ Ждем выдачу результатов от Инстаграма...`);
      try {
        await page.waitForSelector(SELECTORS.LOADER, { state: 'hidden', timeout: 3000 });
      } catch (e) { }
      await (0, browser_1.takeLiveScreenshot)(page);
      await (0, utils_1.wait)(50);
      const candidates = await scrollAndCollectUrls(page, config, contextState);
      const newCandidates = candidates.filter((url) => !state_1.StateManager.has(url));
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
            logger.warn(
              `⚠️ 3 ПУСТЫХ РЕЗУЛЬТАТА ПОДРЯД. СКОРЕЕ ВСЕГО ШЕДОУБАН. ИНИЦИИРУЕМ СМЕНУ ПРОФИЛЯ...`
            );
            throw new RotateAccountError(
              'Shadowban (3 empty results)',
              namesToSearch.slice(nameIdx + 1)
            );
          } else {
            logger.warn(
              `⚠️ 3 ПУСТЫХ РЕЗУЛЬТАТА ПОДРЯД. ВОЗМОЖЕН ШЕДОУБАН. ПРОДОЛЖАЕМ (ТОЛЬКО 1 АККАУНТ ДЛЯ ЗАДАЧИ).`
            );
            emptyResultsCount = 0; // Reset to allow continuing
          }
        }
        continue;
      } else {
        emptyResultsCount = 0;
      }
      logger.info(`      🚀 Обрабатываем новые профили пачками...`);
      const concurrentProfiles = await (0, config_1.getSetting)('concurrentProfiles');
      const humanEmulation = await (0, config_1.getSetting)('humanEmulation');

      // If human emulation is ON, we only process ONE profile at a time with large delays
      const CHUNK_SIZE = humanEmulation ? 1 : concurrentProfiles ? parseInt(concurrentProfiles) : 3;

      for (let i = 0; i < newCandidates.length; i += CHUNK_SIZE) {
        if (checkSkipSignal(contextState)) {
          shouldSkipDonor = true;
          break;
        }
        const chunk = newCandidates.slice(i, i + CHUNK_SIZE);

        if (humanEmulation) {
          for (const url of chunk) {
            if (checkSkipSignal(contextState)) {
              shouldSkipDonor = true;
              break;
            }
            const donorName = donorUrl.split('/').filter(Boolean).pop() || '';
            await analyzeProfile(context, url, config, donorName);
            const delay = 5000 + Math.random() * 5000;
            logger.info(
              `👤 [HUMAN] Ожидание ${Math.round(delay / 1000)}с перед следующим профилем...`
            );
            await (0, utils_1.wait)(delay);
          }
        } else {
          const chunkPromises = chunk.map((url) => {
            const donorName = donorUrl.split('/').filter(Boolean).pop() || '';
            return analyzeProfile(context, url, config, donorName);
          });
          await Promise.all(chunkPromises);
          await randomDelay(100, 300);
        }

        if (shouldSkipDonor) break;
      }
      if (shouldSkipDonor) break;
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
    logger.info(`🌐 Запуск браузера (Фоновый режим / Headless)...`);
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
    const showBrowserStr = await (0, config_1.getSetting)('showBrowser');
    const showBrowser = showBrowserStr === 'true' || showBrowserStr === true;
    const isHeadless = !showBrowser;
    return await (0, browser_1.createBrowserContext)(configWithCreds, isHeadless);
  };
  let { browser, context } = await setupBrowser();
  await (0, browser_1.optimizeContextForScraping)(context);
  let liveViewInterval = (0, browser_1.startLiveView)(context);
  let donorIdx = 0;
  while (donorIdx < donors.length) {
    const humanEmulation = await (0, config_1.getSetting)('humanEmulation');
    const concurrentProfiles = await (0, config_1.getSetting)('concurrentProfiles');
    const DONOR_CHUNK_SIZE = humanEmulation
      ? 1
      : concurrentProfiles
        ? parseInt(concurrentProfiles)
        : 3;

    const currentDonors = [];
    for (let i = 0; i < DONOR_CHUNK_SIZE && donorIdx < donors.length; i++) {
      const d = donors[donorIdx];
      if (state_1.StateManager.hasDonor(d)) {
        logger.info(`\n⏭️ Донор ${d} уже был обработан ранее, пропускаем.`);
        donorIdx++;
        i--; // Stay in this slot
        continue;
      }
      currentDonors.push(d);
      donorIdx++;
    }

    if (currentDonors.length === 0) {
      if (donorIdx >= donors.length) break;
      continue;
    }

    try {
      if (humanEmulation) {
        await processDonor(context, currentDonors[0], CONFIG, accounts.length);
        await state_1.StateManager.addDonor(currentDonors[0]);
        // Reset to full names list for next donor
        CONFIG.target.names = (0, utils_1.shuffleArray)(await (0, config_1.getList)('names.txt'));
      } else {
        logger.info(`🚀 Запускаем параллельную обработку ${currentDonors.length} доноров...`);
        await Promise.all(
          currentDonors.map(async (donorUrl) => {
            // Clone config for each donor to avoid shared naming lists
            const donorConfig = JSON.parse(JSON.stringify(CONFIG));
            await processDonor(context, donorUrl, donorConfig, accounts.length);
            await state_1.StateManager.addDonor(donorUrl);
          })
        );
      }
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
          logger.info(
            `🔀 Переключились на аккаунт #${currentAccountIndex + 1} из ${accounts.length}`
          );
        } else {
          logger.warn(`⚠️ Только один аккаунт доступен. Ждем 30 сек перед повторной попыткой...`);
          await (0, utils_1.wait)(30000);
        }
        const setup = await setupBrowser();
        browser = setup.browser;
        context = setup.context;
        await (0, browser_1.optimizeContextForScraping)(context);
        liveViewInterval = (0, browser_1.startLiveView)(context);
        // Update CONFIG names with remainings and don't increment donorIdx so it retries
        CONFIG.target.names =
          e.remainingNames.length > 0
            ? e.remainingNames
            : (0, utils_1.shuffleArray)(await (0, config_1.getList)('names.txt'));
      } else {
        logger.error(`❌ Непредвиденная ошибка: ${e.message}`);
        donorIdx++; // Skip this donor on other errors
      }
    }

    // 👤 [HUMAN] Periodic context switching - visit home feed every ~2 donors
    if (humanEmulation && donorIdx % 2 === 0) {
      try {
        logger.info(`👤 [HUMAN] Заходим в ленту новостей для "отдыха"...`);
        const feedPage = await context.newPage();
        await feedPage.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
        await (0, utils_1.wait)(2000);
        await (0, utils_1.humanScroll)(feedPage, null, 'down', 800 + Math.random() * 1000);
        await (0, utils_1.wait)(3000 + Math.random() * 4000);
        await feedPage.close();
      } catch (e) { }
    }
  }
  clearInterval(liveViewInterval);
  await browser.close();
  logger.info('\n✅ ========================================== ✅');
  logger.info('👋 РАБОТА ПОЛНОСТЬЮ ЗАВЕРШЕНА! Все результаты сохранены.');
  logger.info('✅ ========================================== ✅');
};
run().catch(console.error);
