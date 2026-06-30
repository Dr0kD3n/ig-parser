'use strict';

const {
  wait,
  humanType,
  humanTypeChars,
  humanClick,
  humanHover,
  humanScroll,
  humanMouseLeave,
  humanSelection,
  daydream,
} = require('./utils');
const { takeLiveScreenshot } = require('./browser');
const logger = require('./logger');
const IG = require('./ig-selectors');

const CLICK_OPTS = { preferEdge: true };

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
    await wait(400 + Math.random() * 600);
    return true;
  }

  await closeOverlays(page);

  const clicked = await IG.clickFirst(page, IG.HOME_NAV, humanClick, CLICK_OPTS);
  if (clicked) {
    await wait(1500 + Math.random() * 1500);
    if (isOnHomeFeed(page.url())) return true;
  }

  if (session.allowGotoFallback) {
    logger.warn(`⚠️ [ANTIFRAUD] Клик на главную не сработал — единственный goto сессии`);
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    session.allowGotoFallback = false;
    await wait(1500 + Math.random() * 1000);
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
    await wait(1000 + Math.random() * 1000);
    searchInput = await IG.findFirstVisible(page, IG.SEARCH_INPUT);
    if (searchInput) return searchInput;
  }

  return page.locator(IG.SEARCH_INPUT).first();
}

/** Очищает поле поиска */
async function clearSearchField(page) {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+A`).catch(() => {});
  await wait(80 + Math.random() * 120);
  await page.keyboard.press('Backspace');
  await wait(150 + Math.random() * 250);
}

/** Допечатывает остаток строки без повторного клика/очистки */
async function humanTypeRemainder(page, text, timeouts) {
  await humanTypeChars(page, text, timeouts);
}

/** Закрывает модалки/поиск/DM через Escape */
async function closeOverlays(page) {
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await wait(250 + Math.random() * 250);
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
  await wait(300 + Math.random() * 500);
  await clearSearchField(page);

  const query = getPartialSearchQuery(username);
  await humanType(page, searchInput, query, config.timeouts, { skipFocus: true });

  if (query !== username) {
    await wait(800 + Math.random() * 1200);
    await humanTypeRemainder(page, username.slice(query.length), config.timeouts);
  }

  await wait(2000 + Math.random() * 2500);

  const profileLink = await findProfileLink(page, username);
  if (profileLink) {
    await humanClick(page, profileLink, CLICK_OPTS);
    await wait(2000 + Math.random() * 3000);
    await page.waitForSelector('header', { timeout: 15000 }).catch(() => {});
    await closeOverlays(page);
    return true;
  }

  logger.warn(`⚠️ [ANTIFRAUD] @${username} не найден в выдаче`);
  await closeOverlays(page);
  return false;
}

/**
 * Случайные микро-действия между профилями
 */
async function performMicroActions(page) {
  const roll = Math.random();
  try {
    if (roll < 0.18) {
      logger.info(`👤 [ANTIFRAUD] Микро: мышь ушла с экрана`);
      await humanMouseLeave(page);
    } else if (roll < 0.32) {
      logger.info(`👤 [ANTIFRAUD] Микро: выделение текста`);
      await humanSelection(page);
    } else if (roll < 0.44) {
      const clicked = await IG.clickFirst(page, IG.NOTIFICATIONS_NAV, humanClick, CLICK_OPTS);
      if (clicked) {
        logger.info(`👤 [ANTIFRAUD] Микро: уведомления`);
        await wait(1200 + Math.random() * 2000);
        await page.keyboard.press('Escape').catch(() => {});
        await wait(500 + Math.random() * 800);
      }
    } else if (roll < 0.52) {
      await humanScroll(page, null, 'down', 120 + Math.random() * 200);
      await wait(600 + Math.random() * 1000);
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
    const hoverCount = Math.min(postCount, 2 + Math.floor(Math.random() * 2));
    for (let i = 0; i < hoverCount; i++) {
      if (Math.random() < 0.65) {
        await humanHover(page, posts[i]);
        await wait(400 + Math.random() * 900);
      }
    }
  }

  if (postCount > 0 && Math.random() < 0.35) {
    const idx = Math.floor(Math.random() * Math.min(postCount, 9));
    logger.info(`👤 [ANTIFRAUD] Смотрим пост #${idx + 1}...`);
    await humanClick(page, posts[idx], CLICK_OPTS);
    await wait(2500 + Math.random() * 4500);

    if (Math.random() < 0.5) {
      await humanScroll(page, null, 'down', 180 + Math.random() * 320);
      await wait(800 + Math.random() * 1800);
    }

    const closeBtn = await IG.findFirstVisible(page, IG.POST_CLOSE);
    if (closeBtn) {
      const target = await IG.resolveClickable(closeBtn);
      await humanClick(page, target, CLICK_OPTS);
    } else {
      await page.keyboard.press('Escape');
    }
    await wait(1200 + Math.random() * 1800);
  }

  await daydream(0.04);
  await wait(2000 + Math.random() * 4000);
}

/**
 * Возврат на главную кликом + свайпы ленты
 */
async function swipeHomeFeed(page, session = {}) {
  logger.info(`👤 [ANTIFRAUD] Главная + свайпы ленты...`);
  await clickGoHome(page, session);
  await wait(1200 + Math.random() * 2000);

  const swipeCount = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < swipeCount; i++) {
    await humanScroll(page, null, 'down', 350 + Math.random() * 550);
    await wait(1200 + Math.random() * 2800);
    if (Math.random() < 0.3) {
      await humanScroll(page, null, 'up', 80 + Math.random() * 180);
      await wait(600 + Math.random() * 1000);
    }
  }
}

/**
 * Отправка сообщения — Enter или кнопка Send (чередование через session.useEnter)
 */
async function submitMessage(page, inputSelector, session) {
  const useEnter = session.useEnter;
  session.useEnter = !session.useEnter;

  if (useEnter) {
    logger.info(`📤 [ANTIFRAUD] Отправка: Enter`);
    await page.keyboard.press('Enter');
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
      const areaText = normalize(area.innerText || '');
      if (areaText.includes(target)) return { found: true, inputEmpty: true };
    }

    const rows = document.querySelectorAll('[role="row"], div[id^="mid."]');
    for (const row of rows) {
      const rowText = normalize(row.innerText || '');
      if (rowText.includes(target)) return { found: true, inputEmpty: true };
    }

    const input = document.querySelector('div[role="textbox"][contenteditable="true"]');
    const inputEmpty = !normalize(input?.innerText || input?.textContent || '');
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
  const attempts = 3;
  for (let i = 0; i < attempts; i++) {
    await wait(i === 0 ? 2500 + Math.random() * 1500 : 1500 + Math.random() * 1000);
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
  submitMessage,
  verifyMessageDelivered,
  verifyMessageDeliveredOnce,
  createMessengerSession,
  isOnHomeFeed,
  findProfileLink,
  CLICK_OPTS,
};
