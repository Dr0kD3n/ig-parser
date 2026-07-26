'use strict';

const {
  wait,
  waitAfterEvent,
  humanType,
  humanTypeChars,
  humanClick,
  humanHover,
  humanScroll,
  humanScrollToTop,
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

/** Закрывает только inbox-виджет снизу справа (не DM-диалог с composer) */
async function closeFloatingInbox(page) {
  if (!page || page.isClosed()) return;

  const activeInput = await IG.findActiveChatInput(page);
  if (activeInput) return;

  const inboxOpen = await page.locator(IG.FLOATING_INBOX).first().isVisible().catch(() => false);
  if (!inboxOpen) return;

  logger.info('🚪 [ANTIFRAUD] Закрываем inbox-виджет Messenger...');

  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await waitAfterEvent();
    await T.pause(200, 350);
    const stillOpen = await page.locator(IG.FLOATING_INBOX).first().isVisible().catch(() => false);
    if (!stillOpen) return;
  }
}

/** Закрывает модалку Direct/чата, если она осталась от предыдущего профиля */
async function closeDirectModal(page, session = {}) {
  if (!page || page.isClosed()) return;

  await closeFloatingInbox(page);

  const chatVisible = !!(await IG.findActiveChatInput(page));
  const onDirect = /instagram\.com\/direct\//.test(page.url());
  if (!chatVisible && !onDirect) return;

  logger.info('🚪 [ANTIFRAUD] Закрываем открытый диалог Direct...');

  for (let attempt = 0; attempt < 4; attempt++) {
    const closeBtn = await IG.findFirstVisible(page, IG.POST_CLOSE);
    if (closeBtn) {
      const target = await IG.resolveClickable(closeBtn);
      await humanClick(page, target, CLICK_OPTS).catch(() => {});
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await waitAfterEvent();
    await T.pause(250, 450);

    const stillVisible = !!(await IG.findActiveChatInput(page));
    if (!stillVisible && !/instagram\.com\/direct\//.test(page.url())) return;
  }

  if (/instagram\.com\/direct\//.test(page.url())) {
    await clickGoHome(page, session).catch(() => {});
    await T.pause(400, 700);
  }

  await closeOverlays(page);
}

/** Проверяет, что открытый чат принадлежит целевому username */
async function isChatForUsername(page, username, session = {}) {
  const uname = String(username || '').replace('@', '').trim().toLowerCase();
  if (!uname) return false;

  const activeInput = await IG.findActiveChatInput(page);
  if (!activeInput) return false;

  if (session.lastOpenedDM === uname) return true;

  const profileInDialog = page.locator(
    `div[role="dialog"] a[href="/${uname}/"], div[role="dialog"] a[href="/${uname.toLowerCase()}/"]`
  ).first();
  if (await profileInDialog.isVisible().catch(() => false)) return true;

  const url = page.url().toLowerCase().replace(/\?.*$/, '');
  const onProfile = new RegExp(`instagram\\.com/${uname}/?$`, 'i').test(url);
  if (onProfile) return true;

  if (url.includes('/direct/t/')) {
    const scopes = [
      page.locator('section main header').first(),
      page.locator('div[role="dialog"] header').first(),
      page.locator('header').first(),
    ];
    for (const scope of scopes) {
      if ((await scope.count()) === 0) continue;
      const text = ((await scope.innerText().catch(() => '')) || '').toLowerCase();
      if (text.includes(uname)) return true;
    }
  }

  return false;
}

/** Закрывает чужой/зависший диалог перед работой с новым профилем */
async function ensureCorrectChatOrClosed(page, username, session = {}) {
  const activeInput = await IG.findActiveChatInput(page);
  if (!activeInput) {
    await closeFloatingInbox(page);
    return true;
  }

  if (await isChatForUsername(page, username, session)) return true;

  logger.warn(`⚠️ [ANTIFRAUD] Открыт чужой диалог (@${username}) — закрываем`);
  await closeDirectModal(page, session);
  return !(await IG.findActiveChatInput(page));
}

/** Закрывает модалки/поиск/DM через Escape */
async function closeOverlays(page) {
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await waitAfterEvent();
    await T.pause(120, 200);
  }
}

/** DM-composer открыт — не путать со сторис */
async function isDmComposerOpen(page) {
  if (!page || page.isClosed()) return false;
  if (/instagram\.com\/direct\//.test(page.url())) return true;

  const inDialog = page
    .locator(
      'div[role="dialog"]:has(div[role="textbox"][contenteditable="true"]) div[role="textbox"][contenteditable="true"]'
    )
    .first();
  if (await inDialog.isVisible().catch(() => false)) return true;

  const inPresentation = page
    .locator(
      'div[role="presentation"]:has(div[role="textbox"][contenteditable="true"]) div[role="textbox"][contenteditable="true"]'
    )
    .first();
  return inPresentation.isVisible().catch(() => false);
}

/** Ждёт появления поля ввода DM после клика Message */
async function waitForChatComposer(page, timeout = 15000) {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (page.isClosed()) return null;

    const notNow = page.locator(IG.NOT_NOW_BTN).first();
    if (await notNow.isVisible().catch(() => false)) {
      await humanClick(page, notNow, CLICK_OPTS).catch(() => {});
      await wait(600);
    }

    const input = await IG.findActiveChatInput(page);
    if (input && (await input.isVisible().catch(() => false))) return input;

    await wait(350 + Math.random() * 250);
  }

  return null;
}

/** Закрывает случайно открытый просмотр сторис, не закрывая DM-диалог */
async function closeStoryIfOpen(page) {
  if (!page || page.isClosed()) return false;
  if (await isDmComposerOpen(page)) return false;

  const storyOpen =
    page.url().includes('/stories/') ||
    (await page
      .locator(
        [
          'div[role="dialog"]:has(svg[aria-label="Close"]):not(:has(div[role="textbox"][contenteditable="true"]))',
          'div[role="dialog"]:has(svg[aria-label="Закрыть"]):not(:has(div[role="textbox"][contenteditable="true"]))',
        ].join(', ')
      )
      .first()
      .isVisible()
      .catch(() => false));

  if (!storyOpen) return false;

  logger.warn(`⚠️ [ANTIFRAUD] Открылась сторис — закрываем и продолжаем рассылку`);

  for (let i = 0; i < 3; i++) {
    const closeBtn = await IG.findFirstVisible(page, IG.POST_CLOSE);
    if (closeBtn) {
      const target = await IG.resolveClickable(closeBtn);
      await humanClick(page, target, CLICK_OPTS).catch(() => {});
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }

    await waitAfterEvent();
    await T.pause(350, 650);
    if (!page.url().includes('/stories/')) return true;
  }

  if (page.url().includes('/stories/')) {
    await page.goBack({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
    await T.pause(500, 900);
  }

  return true;
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
 * Открывает чат через Direct inbox. При несовместимой верстке отключается
 * до конца сессии, после чего sender использует проверенный профильный flow.
 */
async function openDirectInboxThread(page, username, config, session = {}) {
  const uname = String(username || '').replace('@', '').trim();
  session.usedDirectInbox = false;
  if (!uname || session.directInboxAvailable === false) return false;

  try {
    if (!/instagram\.com\/direct\/inbox\/?/.test(page.url())) {
      const openedInbox = await IG.clickFirst(page, IG.DIRECT_NAV, humanClick, CLICK_OPTS);
      if (!openedInbox) {
        session.directInboxAvailable = false;
        return false;
      }
      await T.pause(700, 1100);
    }

    const newMessage = await IG.findFirstVisible(page, IG.DIRECT_NEW_MESSAGE);
    if (!newMessage) {
      session.directInboxAvailable = false;
      return false;
    }
    await humanClick(page, await IG.resolveClickable(newMessage), CLICK_OPTS);
    await T.pause(350, 650);

    const recipientInput = await IG.findFirstVisible(page, IG.DIRECT_RECIPIENT_INPUT);
    if (!recipientInput) {
      session.directInboxAvailable = false;
      return false;
    }
    await humanClick(page, recipientInput, CLICK_OPTS);
    await humanType(page, recipientInput, uname, config.timeouts, { skipFocus: true });
    await T.pause(700, 1200);

    const dialog = page.locator('div[role="dialog"]').last();
    const exactUsername = dialog.getByText(uname, { exact: true }).last();
    const atUsername = dialog.getByText(`@${uname}`, { exact: true }).last();
    const result = await exactUsername.isVisible().catch(() => false)
      ? exactUsername
      : await atUsername.isVisible().catch(() => false)
        ? atUsername
        : null;
    if (!result) {
      await closeOverlays(page);
      return false;
    }

    await humanClick(page, await IG.resolveClickable(result), CLICK_OPTS);
    await T.pause(250, 500);

    const next = await IG.findFirstVisible(page, IG.DIRECT_NEXT_BTN);
    if (!next) {
      await closeOverlays(page);
      return false;
    }
    const previousUrl = page.url();
    await humanClick(page, await IG.resolveClickable(next), CLICK_OPTS);

    const composer = await waitForChatComposer(page, 10000);
    if (!composer) {
      await closeOverlays(page);
      return false;
    }

    const threadChanged =
      page.url() !== previousUrl && /instagram\.com\/direct\/t\//.test(page.url());
    const correctChat = await isChatForUsername(page, uname, {
      ...session,
      lastOpenedDM: null,
    });
    if (!threadChanged || !correctChat) {
      logger.warn(`⚠️ [DIRECT] Не удалось подтвердить чат @${uname}; используем профильный flow`);
      await closeDirectModal(page, session);
      return false;
    }

    session.lastOpenedDM = uname.toLowerCase();
    session.usedDirectInbox = true;
    logger.info(`✅ [DIRECT] Чат @${uname} открыт через inbox`);
    return true;
  } catch (e) {
    logger.warn(`⚠️ [DIRECT] Inbox flow недоступен: ${e.message}`);
    session.directInboxAvailable = false;
    await closeOverlays(page).catch(() => {});
    return false;
  }
}

/** Возвращает sender в inbox без перехода через профиль и главную ленту. */
async function returnToDirectInbox(page, session = {}) {
  if (!session.usedDirectInbox || !page || page.isClosed()) return false;
  session.lastOpenedDM = null;

  if (/instagram\.com\/direct\/inbox\/?/.test(page.url())) return true;
  const opened = await IG.clickFirst(page, IG.DIRECT_NAV, humanClick, CLICK_OPTS);
  if (!opened) return false;
  await T.pause(500, 900);
  return true;
}

/**
 * Одно случайное «живое» действие на странице (скролл, курсор, hover, клик по блоку)
 */
async function performIdleAction(page, options = {}) {
  if (!page || page.isClosed()) return;
  const { noScroll = false, noClick = false } = options;
  const roll = Math.random();
  try {
    if (!noScroll && roll < 0.32) {
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
      const blocks = page.locator('main article, main img, article a');
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
    } else if (roll < 0.96 && !noClick) {
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
    } else if (!noScroll) {
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
  const idleOpts = { noScroll: options.noScroll, noClick: options.noClick };
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
    await performIdleAction(page, idleOpts);
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

  await closeStoryIfOpen(page);
  await shortPause(0.02);
  await humanScrollToTop(page);
  await T.pause(200, 450);
}

/**
 * Открывает DM с профиля: кнопка Message или через меню Options
 */
async function openProfileDM(page, username, session = {}) {
  await closeFloatingInbox(page);
  await humanScrollToTop(page);
  await T.pause(250, 500);

  const uname = String(username || '').replace('@', '').trim().toLowerCase();

  const msgBtn = await IG.findProfileMessageButton(page);
  if (msgBtn) {
    await humanClick(page, msgBtn, CLICK_OPTS);
    session.lastOpenedDM = uname;
    logger.info(`✅ [ANTIFRAUD] Клик по кнопке Message в header профиля`);
    return true;
  }

  const optionsEl = await IG.findFirstVisible(page, IG.OPTIONS_BTN);
  if (!optionsEl) return false;

  const optionsTarget = await IG.resolveClickable(optionsEl);
  await humanClick(page, optionsTarget, CLICK_OPTS);
  await wait(800);

  const menuBtn = await IG.findFirstVisible(page, IG.MENU_MESSAGE_BTN);
  if (menuBtn && (await menuBtn.isVisible())) {
    await humanClick(page, menuBtn, CLICK_OPTS);
    session.lastOpenedDM = uname;
    logger.info(`✅ [ANTIFRAUD] Кнопка Message в меню Options`);
    return true;
  }

  return false;
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
async function submitMessage(page, inputSelectorOrLocator, session) {
  const useEnter = session.useEnter;
  session.useEnter = !session.useEnter;
  const input =
    typeof inputSelectorOrLocator === 'string'
      ? page.locator(inputSelectorOrLocator).first()
      : inputSelectorOrLocator;

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
  const inputLocator = await IG.findActiveChatInput(page);
  const inputText = normalizeText(
    inputLocator ? await inputLocator.innerText().catch(() => '') : ''
  );

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
    logger.info(`🔄 [DELIVERY] Поле очистилось, ждём подтверждение bubble`);
    return { delivered: false, reason: 'not_verified', final: false };
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

const HISTORY_BLACKLIST = [
  'Instagram', 'Active now', 'Followed by', ' followers', ' posts',
  'This is the beginning', 'Not for you', 'You followed',
  'Отправить', 'Send', 'Type a message', 'Напишите', 'View profile',
  'Search', 'Joined', 'Follow', 'Following', 'Message', 'Сообщение',
  'Block', 'Report', 'Restrict', 'Смотреть профиль', 'View Profile',
  'Начало переписки', 'начало вашей переписки',
];

/** Контейнер активного DM — dialog, presentation или /direct/ main */
async function getActiveChatScope(page) {
  const tb = 'div[role="textbox"][contenteditable="true"]';
  const candidates = [
    page.locator(`div[role="dialog"]:has(${tb})`).last(),
    page.locator(`div[role="presentation"]:has(${tb})`).last(),
    page.locator('section main').filter({ has: page.locator(tb) }),
  ];

  for (const locator of candidates) {
    if ((await locator.count().catch(() => 0)) === 0) continue;
    const el = locator.first();
    if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}

/**
 * Проверяет, есть ли в чате сообщения до отправки.
 * @returns {{ hasHistory: boolean, source?: string, preview?: string, count?: number }}
 */
async function detectChatHistory(page, username) {
  const uname = String(username || '').replace('@', '').trim();

  const apiHistory = await page.evaluate(async (targetUname) => {
    try {
      const res = await fetch('/api/v1/direct_v2/visual_threads/', {
        headers: { 'X-IG-App-ID': '936619743392459' },
      });
      if (!res.ok) return null;

      const json = await res.json();
      const threads = json.threads || [];
      const thread = threads.find(
        (t) => t.users && t.users.some((u) => String(u.username || '').toLowerCase() === targetUname.toLowerCase())
      );
      if (!thread) return null;

      const item = thread.last_permanent_item;
      if (!item) return null;

      const itemType = String(item.item_type || '').toLowerCase();
      if (itemType === 'placeholder' || itemType === 'profile') return null;

      const text = String(item.text || '').trim();
      if (text && /^(view profile|смотреть профиль)$/i.test(text)) return null;

      return {
        hasHistory: true,
        lastMsg: text || `[${item.item_type || 'message'}]`,
      };
    } catch (_e) {
      return null;
    }
  }, uname);

  if (apiHistory?.hasHistory) {
    return {
      hasHistory: true,
      source: 'api',
      preview: apiHistory.lastMsg,
      count: 1,
    };
  }

  const scope = await getActiveChatScope(page);
  if (!scope) {
    return { hasHistory: false };
  }

  const domResult = await scope.evaluate((chatRoot, blacklist) => {
    const isBlacklisted = (text) => blacklist.some((b) => text.includes(b));

    const selectors = [
      'div[role="none"]',
      'div[id^="mid."]',
      '[role="row"]',
      '[aria-label*="Double tap"]',
      '[aria-label*="двойное нажатие"]',
      '[aria-label*="нравится"]',
    ];

    const roots = [
      chatRoot.querySelector('[role="group"]'),
      chatRoot.querySelector('[aria-label*="Conversation"]'),
      chatRoot.querySelector('[aria-label*="Диалог"]'),
      chatRoot.querySelector('[aria-label*="Dialog"]'),
      chatRoot,
    ].filter(Boolean);

    const seen = new Set();
    let count = 0;
    const texts = [];

    for (const root of roots) {
      for (const sel of selectors) {
        root.querySelectorAll(sel).forEach((node) => {
          if (seen.has(node)) return;
          seen.add(node);

          const text = (node.innerText || node.textContent || '').trim();
          if (!text || text.length <= 1) return;
          if (isBlacklisted(text)) return;

          count++;
          if (texts.length < 5) {
            texts.push(text.slice(0, 100).replace(/\n/g, ' '));
          }
        });
      }
      if (count > 0) break;
    }

    return { count, texts };
  }, HISTORY_BLACKLIST);

  if (domResult.count > 0) {
    return {
      hasHistory: true,
      source: 'dom',
      preview: domResult.texts.join(' | '),
      count: domResult.count,
    };
  }

  return { hasHistory: false };
}

/** Инициализация сессии одной вкладки */
function createMessengerSession() {
  return {
    useEnter: Math.random() < 0.5,
    allowGotoFallback: true,
    profileCount: 0,
    lastOpenedDM: null,
    directInboxAvailable: true,
    usedDirectInbox: false,
  };
}

module.exports = {
  extractUsername,
  getPartialSearchQuery,
  navigateViaSearch,
  openDirectInboxThread,
  returnToDirectInbox,
  browseProfileBeforeDM,
  swipeHomeFeed,
  clickGoHome,
  closeOverlays,
  closeDirectModal,
  closeFloatingInbox,
  closeStoryIfOpen,
  isDmComposerOpen,
  waitForChatComposer,
  isChatForUsername,
  ensureCorrectChatOrClosed,
  openProfileDM,
  performMicroActions,
  performIdleAction,
  waitWithActivity,
  waitForWithActivity,
  submitMessage,
  verifyMessageDelivered,
  verifyMessageDeliveredOnce,
  detectChatHistory,
  getActiveChatScope,
  createMessengerSession,
  isOnHomeFeed,
  findProfileLink,
  CLICK_OPTS,
  PROFILE_GAP,
};
