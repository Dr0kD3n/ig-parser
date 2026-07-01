'use strict';

const {
  wait,
  waitAfterEvent,
  humanType,
  humanTypeChars,
  humanClick,
  humanHover,
  humanScroll,
  humanMouseLeave,
  humanSelection,
  humanMove,
} = require('./utils');
const { takeLiveScreenshot } = require('./browser');
const logger = require('./logger');
const IG = require('./ig-selectors');

const CLICK_OPTS = { preferEdge: true };

/** Тайминги антифрода (мс): min, max для random */
const T = {
  pause: (min, max = min) => wait(min + Math.random() * (max - min)),
};

/** Пауза между профилями в рассылке */
const PROFILE_GAP = {
  normal: [3000, 6000],
  human: [5000, 10000],
};

/** Короткая «задумчивость» вместо 15–40с из daydream() */
async function shortPause(chance = 0.02) {
  if (Math.random() < chance) {
    await T.pause(1500, 3500);
  }
}

/** Извлекает username из URL профиля */
function extractUsername(url) {
  const match = String(url).match(/instagram\.com\/([^/?#]+)/i);
  if (!match) return '';
  const name = match[1].replace('@', '').trim();
  const skip = new Set(['p', 'reel', 'reels', 'stories', 'direct', 'explore', 'accounts']);
  return skip.has(name.toLowerCase()) ? '' : name;
}

const normalizeText = (t) =>
  (t || '').toLowerCase().replace(/[^\w\sа-яё]/gi, '').trim();

/** Проверка — мы на главной ленте */
function isOnHomeFeed(url) {
  try {
    const u = new URL(url);
    return u.hostname.includes('instagram.com') && (u.pathname === '/' || u.pathname === '');
  } catch {
    return false;
  }
}

/**
 * Переход на главную кликом (без goto), fallback только при первом запуске сессии
 */
async function clickGoHome(page, session = {}) {
  if (isOnHomeFeed(page.url())) {
    await T.pause(150, 350);
    return true;
  }

  await closeOverlays(page);

  const clicked = await IG.clickFirst(page, IG.HOME_NAV, humanClick, CLICK_OPTS);
  if (clicked) {
    await T.pause(500, 900);
    if (isOnHomeFeed(page.url())) return true;
  }

  if (session.allowGotoFallback) {
    logger.warn(`⚠️ [ANTIFRAUD] Клик на главную не сработал — единственный goto сессии`);
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    session.allowGotoFallback = false;
    await T.pause(600, 1000);
    return true;
  }

  logger.warn(`⚠️ [ANTIFRAUD] Не удалось вернуться на главную кликом`);
  return false;
}

/** Открывает поле поиска */
async function openSearchInput(page) {
  let searchInput = await IG.findFirstVisible(page, IG.SEARCH_INPUT);
  if (searchInput) return searchInput;

  const navClicked = await IG.clickFirst(page, IG.SEARCH_NAV, humanClick, CLICK_OPTS);
  if (navClicked) {
    await T.pause(350, 650);
    searchInput = await IG.findFirstVisible(page, IG.SEARCH_INPUT);
    if (searchInput) return searchInput;
  }

  return page.locator(IG.SEARCH_INPUT).first();
}

/** Очищает поле поиска */
async function clearSearchField(page) {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+A`).catch(() => {});
  await waitAfterEvent();
  await wait(80 + Math.random() * 120);
  await page.keyboard.press('Backspace');
  await waitAfterEvent();
  await T.pause(80, 150);
}

/** Допечатывает остаток строки без повторного клика/очистки */
async function humanTypeRemainder(page, text, timeouts) {
  await humanTypeChars(page, text, timeouts);
}

/** Закрывает модалки/поиск/DM через Escape */
async function closeOverlays(page) {
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await waitAfterEvent();
    await T.pause(120, 200);
  }
}

/** Ищет ссылку на профиль в результатах поиска (без учёта регистра) */
async function findProfileLink(page, username) {
  return IG.findProfileLink(page, username);
}

/** Частичный запрос для поиска — имитация человека */
function getPartialSearchQuery(username) {
  if (username.length <= 4 || Math.random() < 0.35) return username;
  const minLen = Math.max(3, Math.floor(username.length * 0.45));
  const maxLen = Math.max(minLen, username.length - 1);
  const len = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
  return username.slice(0, len);
}

/**
 * Навигация к профилю через поиск (клики, без goto)
 */
async function navigateViaSearch(page, url, config, session = {}) {
  const username = extractUsername(url);
  if (!username) {
    logger.warn(`⚠️ [ANTIFRAUD] Не удалось извлечь username из ${url}`);
    return false;
  }

  logger.info(`🔍 [ANTIFRAUD] Ищем @${username} через поиск...`);
  await clickGoHome(page, session);
  await takeLiveScreenshot(page);

  const searchInput = await openSearchInput(page);
  if ((await searchInput.count()) === 0) {
    logger.warn(`⚠️ [ANTIFRAUD] Поиск недоступен для @${username}`);
    return false;
  }

  await humanClick(page, searchInput, CLICK_OPTS);
  await T.pause(150, 300);
  await clearSearchField(page);

  const query = getPartialSearchQuery(username);
  await humanType(page, searchInput, query, config.timeouts, { skipFocus: true });

  if (query !== username) {
    await T.pause(350, 650);
    await humanTypeRemainder(page, username.slice(query.length), config.timeouts);
  }

  await T.pause(700, 1200);

  const profileLink = await findProfileLink(page, username);
  if (profileLink) {
    await humanClick(page, profileLink, CLICK_OPTS);
    await T.pause(700, 1200);
    await page.waitForSelector('header', { timeout: 15000 }).catch(() => {});
    await closeOverlays(page);
    return true;
  }

  logger.warn(`⚠️ [ANTIFRAUD] @${username} не найден в выдаче`);
  await closeOverlays(page);
  return false;
}

/**
 * Одно случайное «живое» действие на странице (скролл, курсор, hover, клик по блоку)
 */
async function performIdleAction(page) {
  if (!page || page.isClosed()) return;
  const roll = Math.random();
  try {
    if (roll < 0.32) {
      const dir = Math.random() < 0.82 ? 'down' : 'up';
      await humanScroll(page, null, dir, 120 + Math.random() * 380);
      await T.pause(120, 280);
    } else if (roll < 0.58) {
      const vp = page.viewportSize();
      if (vp) {
        const x = 30 + Math.random() * Math.max(40, vp.width - 60);
        const y = 30 + Math.random() * Math.max(40, vp.height - 60);
        await humanMove(page, x, y);
        await T.pause(80, 180);
        if (Math.random() < 0.35) {
          await humanMove(page, x + (Math.random() - 0.5) * 90, y + (Math.random() - 0.5) * 70);
        }
      }
    } else if (roll < 0.78) {
      const blocks = page.locator('main article, main img, main div[role="button"], article a');
      const count = await blocks.count().catch(() => 0);
      if (count > 0) {
        const idx = Math.floor(Math.random() * Math.min(count, 14));
        const el = blocks.nth(idx);
        if (await el.isVisible().catch(() => false)) {
          await humanHover(page, el);
          await T.pause(150, 350);
        }
      }
    } else if (roll < 0.9) {
      await humanSelection(page);
    } else if (roll < 0.96) {
      const articles = page.locator('main article, article');
      const count = await articles.count().catch(() => 0);
      if (count > 0) {
        const el = articles.nth(Math.floor(Math.random() * Math.min(count, 6)));
        if (await el.isVisible().catch(() => false)) {
          await humanClick(page, el, CLICK_OPTS);
          await T.pause(250, 500);
          await page.keyboard.press('Escape').catch(() => {});
          await waitAfterEvent();
          await T.pause(150, 300);
        }
      }
    } else {
      await humanScroll(page, null, 'down', 200 + Math.random() * 300);
      await T.pause(200, 400);
      await humanScroll(page, null, 'up', 60 + Math.random() * 120);
    }
  } catch (e) {
    logger.warn(`⚠️ [IDLE] performIdleAction: ${e.message}`);
  }
}

/**
 * Пауза с периодической активностью вместо пустого wait()
 */
async function waitWithActivity(page, ms, options = {}) {
  const threshold = options.threshold ?? 400;
  if (!page || page.isClosed() || ms < threshold) {
    return wait(ms);
  }

  const minChunk = options.minChunk ?? 280;
  const maxChunk = options.maxChunk ?? 750;
  const deadline = Date.now() + ms;

  while (Date.now() < deadline) {
    if (page.isClosed()) {
      await wait(Math.max(0, deadline - Date.now()));
      return;
    }
    await performIdleAction(page);
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await wait(Math.min(remaining, minChunk + Math.random() * (maxChunk - minChunk)));
  }
}

/**
 * Ожидание Playwright-promise с фоновой активностью (waitForSelector и т.п.)
 */
async function waitForWithActivity(page, promise) {
  if (!page || page.isClosed()) return promise;

  let settled = false;
  promise.finally(() => {
    settled = true;
  });

  const activity = (async () => {
    while (!settled && !page.isClosed()) {
      await performIdleAction(page).catch(() => {});
      await wait(320 + Math.random() * 380);
    }
  })();

  return Promise.all([activity, promise]).then(([, result]) => result);
}

/**
 * Случайные микро-действия между профилями
 */
async function performMicroActions(page) {
  await performIdleAction(page);
  const roll = Math.random();
  try {
    if (roll < 0.12) {
      logger.info(`👤 [ANTIFRAUD] Микро: мышь ушла с экрана`);
      await humanMouseLeave(page);
    } else if (roll < 0.24) {
      logger.info(`👤 [ANTIFRAUD] Микро: выделение текста`);
      await humanSelection(page);
    } else if (roll < 0.36) {
      const clicked = await IG.clickFirst(page, IG.NOTIFICATIONS_NAV, humanClick, CLICK_OPTS);
      if (clicked) {
        logger.info(`👤 [ANTIFRAUD] Микро: уведомления`);
        await T.pause(500, 900);
        await page.keyboard.press('Escape').catch(() => {});
        await waitAfterEvent();
        await T.pause(200, 400);
      }
    } else if (roll < 0.42) {
      await humanScroll(page, null, 'down', 120 + Math.random() * 200);
      await T.pause(250, 500);
    }
  } catch (e) {
    logger.warn(`⚠️ [ANTIFRAUD] performMicroActions: ${e.message}`);
  }
}

/**
 * Просмотр профиля перед DM: hover постов, иногда открыть случайный пост
 */
async function browseProfileBeforeDM(page) {
  const posts = await page.locator(IG.POST_LINKS).all();
  const postCount = posts.length;

  if (postCount > 0) {
    const hoverCount = Math.min(postCount, 1 + Math.floor(Math.random() * 2));
    for (let i = 0; i < hoverCount; i++) {
      if (Math.random() < 0.5) {
        await humanHover(page, posts[i]);
        await T.pause(150, 400);
      }
    }
  }

  if (postCount > 0 && Math.random() < 0.25) {
    const idx = Math.floor(Math.random() * Math.min(postCount, 9));
    logger.info(`👤 [ANTIFRAUD] Смотрим пост #${idx + 1}...`);
    await humanClick(page, posts[idx], CLICK_OPTS);
    await T.pause(900, 1800);

    if (Math.random() < 0.5) {
      await humanScroll(page, null, 'down', 180 + Math.random() * 320);
      await T.pause(350, 700);
    }

    const closeBtn = await IG.findFirstVisible(page, IG.POST_CLOSE);
    if (closeBtn) {
      const target = await IG.resolveClickable(closeBtn);
      await humanClick(page, target, CLICK_OPTS);
    } else {
      await page.keyboard.press('Escape');
      await waitAfterEvent();
    }
    await T.pause(400, 800);
  }

  await shortPause(0.02);
  await T.pause(400, 900);
}

/**
 * Возврат на главную кликом + свайпы ленты
 */
async function swipeHomeFeed(page, session = {}) {
  logger.info(`👤 [ANTIFRAUD] Главная + свайпы ленты...`);
  await clickGoHome(page, session);
  await T.pause(400, 800);

  const swipeCount = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < swipeCount; i++) {
    await humanScroll(page, null, 'down', 350 + Math.random() * 550);
    await T.pause(450, 900);
    if (Math.random() < 0.25) {
      await humanScroll(page, null, 'up', 80 + Math.random() * 180);
      await T.pause(250, 500);
    }
  }
}

/**
 * Отправка сообщения — Enter или кнопка Send (чередование через session.useEnter)
 */
async function submitMessage(page, inputSelector, session) {
  const useEnter = session.useEnter;
  session.useEnter = !session.useEnter;
  const input = page.locator(inputSelector).first();

  if ((await input.count()) > 0) {
    await input.click({ timeout: 3000 }).catch(() => {});
    await waitAfterEvent();
  }

  if (useEnter) {
    logger.info(`📤 [ANTIFRAUD] Отправка: Enter`);
    await page.keyboard.press('Enter');
    await waitAfterEvent();
    return;
  }

  let clicked = false;
  const sendBtn = await IG.findSendButton(page);
  if (sendBtn) {
    logger.info(`📤 [ANTIFRAUD] Отправка: кнопка Send`);
    const target = await IG.resolveClickable(sendBtn);
    await humanClick(page, target, CLICK_OPTS);
    clicked = true;
  }

  if (!clicked) {
    logger.info(`📤 [ANTIFRAUD] Кнопка Send не найдена — fallback Enter`);
    await page.keyboard.press('Enter');
    await waitAfterEvent();
  }
}

/**
 * Одна попытка проверки доставки
 */
async function verifyMessageDeliveredOnce(page, message) {
  const failureTexts = [
    "Couldn't send",
    'Не удалось отправить',
    'Something went wrong',
    'Try Again',
    'Повторить',
    'Message failed',
    'Not sent',
    'Не отправлено',
    "can't message",
    'не можете отправить',
  ];

  for (const text of failureTexts) {
    const el = page.getByText(text, { exact: false }).first();
    if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
      logger.warn(`❌ [DELIVERY] Ошибка UI: "${text}"`);
      return { delivered: false, reason: 'send_failed_ui', final: true };
    }
  }

  const target = normalizeText(message);
  const inputLocator = page.locator(IG.CHAT_INPUT).first();
  const inputText = normalizeText(await inputLocator.innerText().catch(() => ''));

  if (inputText && target && (inputText.includes(target) || target.includes(inputText))) {
    logger.warn(`❌ [DELIVERY] Текст остался в поле ввода`);
    return { delivered: false, reason: 'text_still_in_input', final: true };
  }

  const chatCheck = await page.evaluate((targetText) => {
    const normalize = (t) =>
      (t || '').toLowerCase().replace(/[^\w\sа-яё]/gi, '').trim();
    const target = normalize(targetText);
    if (!target) return { found: false, inputEmpty: true };

    const chatAreas = document.querySelectorAll(
      '[role="group"], [aria-label*="Conversation"], [aria-label*="Диалог"], [aria-label*="Dialog"]'
    );

    for (const area of chatAreas) {
      const areaText = normalize(area.textContent || '');
      if (areaText.includes(target)) return { found: true, inputEmpty: true };
    }

    const rows = document.querySelectorAll('[role="row"], div[id^="mid."]');
    for (const row of rows) {
      const rowText = normalize(row.textContent || '');
      if (rowText.includes(target)) return { found: true, inputEmpty: true };
    }

    const input = document.querySelector('div[role="textbox"][contenteditable="true"]');
    const inputEmpty = !normalize(input?.textContent || '');
    return { found: false, inputEmpty };
  }, message);

  if (chatCheck.found) {
    logger.info(`✅ [DELIVERY] Сообщение найдено в чате`);
    return { delivered: true, confidence: 'bubble', final: true };
  }

  if (chatCheck.inputEmpty) {
    logger.info(`✅ [DELIVERY] Поле пустое — вероятно отправлено`);
    return { delivered: true, confidence: 'input_cleared', final: true };
  }

  return { delivered: false, reason: 'not_verified', final: false };
}

/**
 * Проверка доставки DM после отправки (с повторами)
 */
async function verifyMessageDelivered(page, message) {
  const attempts = 2;
  for (let i = 0; i < attempts; i++) {
    await T.pause(i === 0 ? 900 : 600, i === 0 ? 1400 : 1000);
    const result = await verifyMessageDeliveredOnce(page, message);
    if (result.delivered || result.final) return result;
    logger.info(`🔄 [DELIVERY] Повтор проверки ${i + 2}/${attempts}...`);
  }

  logger.warn(`❌ [DELIVERY] Не подтверждена доставка`);
  return { delivered: false, reason: 'not_verified' };
}

/** Инициализация сессии одной вкладки */
function createMessengerSession() {
  return {
    useEnter: Math.random() < 0.5,
    allowGotoFallback: true,
    profileCount: 0,
  };
}

module.exports = {
  extractUsername,
  getPartialSearchQuery,
  navigateViaSearch,
  browseProfileBeforeDM,
  swipeHomeFeed,
  clickGoHome,
  closeOverlays,
  performMicroActions,
  performIdleAction,
  waitWithActivity,
  waitForWithActivity,
  submitMessage,
  verifyMessageDelivered,
  verifyMessageDeliveredOnce,
  createMessengerSession,
  isOnHomeFeed,
  findProfileLink,
  CLICK_OPTS,
  PROFILE_GAP,
};
