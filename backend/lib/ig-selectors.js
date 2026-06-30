'use strict';

/**
 * Селекторы Instagram + хелперы клика по правильному элементу (не по голому svg)
 */

const SEARCH_INPUT = [
  'input[aria-label="Search input"]',
  'input[placeholder="Search"]',
  'input[placeholder="Поиск"]',
  'input[aria-label="Search"]',
  'input[aria-label="Поиск"]',
  'div[role="dialog"] input[type="text"]',
].join(', ');

const SEARCH_NAV = [
  'a:has(svg[aria-label="Search"])',
  'a:has(svg[aria-label="Поиск"])',
  'a:has(svg[aria-label="Поисковый запрос"])',
  'div[role="link"]:has(svg[aria-label="Search"])',
  'div[role="button"]:has(svg[aria-label="Search"])',
  'div[role="link"]:has(svg[aria-label="Поиск"])',
].join(', ');

const HOME_NAV = [
  'nav a:has(svg[aria-label="Home"])',
  'nav a:has(svg[aria-label="Главная"])',
  'a[href="/"]:has(svg[aria-label="Home"])',
  'a[href="/"]:has(svg[aria-label="Главная"])',
  'div[role="navigation"] a[href="/"]',
  'a[href="/"]:has(svg[aria-label="Instagram"])',
].join(', ');

const NOTIFICATIONS_NAV = [
  'a:has(svg[aria-label="Notifications"])',
  'a:has(svg[aria-label="Уведомления"])',
  'div[role="link"]:has(svg[aria-label="Notifications"])',
  'div[role="link"]:has(svg[aria-label="Уведомления"])',
].join(', ');

const MESSAGE_BTN = [
  'main header section button:has-text("Message")',
  'main header section button:has-text("Сообщение")',
  'main header section button:has-text("Send message")',
  'main header section button:has-text("Написать")',
  'main header section button:has-text("Отправить сообщение")',
  'main header section div[role="button"]:has-text("Message")',
  'main header section div[role="button"]:has-text("Сообщение")',
  'main header section div[role="button"]:has-text("Написать")',
  'main header section a:has-text("Message")',
  'main header section a:has-text("Сообщение")',
].join(', ');

const OPTIONS_BTN = [
  'main header svg[aria-label="Options"]',
  'main header svg[aria-label="Параметры"]',
  'main header svg[aria-label="More options"]',
  'main header button:has(svg[aria-label="Options"])',
  'main header button:has(svg[aria-label="Параметры"])',
  'main header div[role="button"]:has(svg[aria-label="Options"])',
].join(', ');

const MENU_MESSAGE_BTN = [
  'div[role="dialog"] button:has-text("Send message")',
  'div[role="dialog"] button:has-text("Отправить сообщение")',
  'div[role="dialog"] button:has-text("Написать")',
  'div[role="dialog"] button:has-text("Message")',
  'div[role="dialog"] button:has-text("Сообщение")',
  'div[role="dialog"] [role="button"]:has-text("Send message")',
  'div[role="dialog"] [role="button"]:has-text("Message")',
].join(', ');

const CHAT_INPUT =
  'div[role="textbox"][contenteditable="true"], div[aria-label="Message"], div[aria-label="Напишите сообщение..."], div[aria-label="Напишите сообщение"], [aria-label="Message"], [aria-label="Напишите сообщение..."]';

const NOT_NOW_BTN = 'button:has-text("Not Now"), button:has-text("Не сейчас")';

const SEND_BTN = [
  'div:has(> div[role="textbox"][contenteditable="true"]) div[role="button"]:has(svg[aria-label="Send"])',
  'div:has(> div[role="textbox"][contenteditable="true"]) div[role="button"]:has(svg[aria-label="Отправить"])',
  'form div[role="button"]:has(svg[aria-label="Send"])',
  'form div[role="button"]:has(svg[aria-label="Отправить"])',
  '[aria-label*="Conversation"] div[role="button"]:has(svg[aria-label="Send"])',
  '[aria-label*="Диалог"] div[role="button"]:has(svg[aria-label="Отправить"])',
  'section main div[role="button"]:has(svg[aria-label="Send"])',
  'section main div[role="button"]:has(svg[aria-label="Отправить"])',
].join(', ');

const POST_LINKS = 'main article a[href*="/p/"], main article a[href*="/reel/"]';

const POST_CLOSE = [
  'div[role="dialog"] div[role="button"]:has(svg[aria-label="Close"])',
  'div[role="dialog"] div[role="button"]:has(svg[aria-label="Закрыть"])',
  'div[role="presentation"] div[role="button"]:has(svg[aria-label="Close"])',
  'div[role="presentation"] div[role="button"]:has(svg[aria-label="Закрыть"])',
  'svg[aria-label="Close"]',
  'svg[aria-label="Закрыть"]',
].join(', ');

const SEARCH_RESULTS_SCOPE = [
  'div[role="dialog"]',
  '[role="listbox"]',
  'div:has(> div input[aria-label="Search input"])',
  'div:has(> div input[placeholder="Search"])',
];

/** Первый видимый локатор из списка селекторов (строка или массив) */
async function findFirstVisible(page, selectors, scope = null) {
  const root = scope || page;
  const list = Array.isArray(selectors) ? selectors : selectors.split(',').map((s) => s.trim());
  for (const sel of list) {
    if (!sel) continue;
    const loc = root.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      return loc;
    }
  }
  return null;
}

/** Кликабельный предок svg/иконки */
async function resolveClickable(locator) {
  const clickable = locator.locator(
    'xpath=ancestor::a[1] | ancestor::button[1] | ancestor::div[@role="button"][1] | ancestor::div[@role="link"][1]'
  ).first();
  if ((await clickable.count()) > 0) return clickable;
  return locator;
}

/** Клик по первому видимому селектору (с разрешением иконки → родитель) */
async function clickFirst(page, selectors, humanClick, clickOpts, scope = null) {
  const el = await findFirstVisible(page, selectors, scope);
  if (!el) return false;
  const target = await resolveClickable(el);
  await humanClick(page, target, clickOpts);
  return true;
}

/** Ссылка на профиль в результатах поиска */
async function findProfileLink(page, username) {
  const uname = username.toLowerCase();
  const hrefPatterns = [
    `a[href="/${username}/"]`,
    `a[href="/${username.toLowerCase()}/"]`,
    `a[href="/${username}/"]:not([href*="/p/"]):not([href*="/reel/"])`,
  ];

  for (const scopeSel of SEARCH_RESULTS_SCOPE) {
    const scope = page.locator(scopeSel).first();
    if ((await scope.count()) === 0) continue;

    for (const hrefSel of hrefPatterns) {
      const link = scope.locator(hrefSel).first();
      if ((await link.count()) > 0 && (await link.isVisible().catch(() => false))) {
        const href = (await link.getAttribute('href').catch(() => '')) || '';
        const match = href.match(/^\/([^/]+)\/?$/);
        if (match && match[1].toLowerCase() === uname) return link;
      }
    }

    const roleLink = scope.getByRole('link', { name: username, exact: true }).first();
    if ((await roleLink.count()) > 0 && (await roleLink.isVisible().catch(() => false))) {
      return roleLink;
    }
  }

  // Глобальный fallback — только точный href
  for (const hrefSel of hrefPatterns) {
    const link = page.locator(hrefSel).first();
    if ((await link.count()) > 0 && (await link.isVisible().catch(() => false))) {
      const href = (await link.getAttribute('href').catch(() => '')) || '';
      const match = href.match(/^\/([^/]+)\/?$/);
      if (match && match[1].toLowerCase() === uname) return link;
    }
  }

  return null;
}

/** Кнопка Send в области чата (не иконка «Отправить» в меню) */
async function findSendButton(page) {
  const scoped = await findFirstVisible(page, SEND_BTN);
  if (scoped) return scoped;

  const input = page.locator('div[role="textbox"][contenteditable="true"]').last();
  if ((await input.count()) === 0) return null;

  const nearBtn = input
    .locator('xpath=ancestor::div[position()<=5]')
    .locator('div[role="button"]:has(svg[aria-label="Send"]), div[role="button"]:has(svg[aria-label="Отправить"])')
    .last();
  if ((await nearBtn.count()) > 0 && (await nearBtn.isVisible().catch(() => false))) {
    return nearBtn;
  }
  return null;
}

module.exports = {
  SEARCH_INPUT,
  SEARCH_NAV,
  HOME_NAV,
  NOTIFICATIONS_NAV,
  MESSAGE_BTN,
  OPTIONS_BTN,
  MENU_MESSAGE_BTN,
  CHAT_INPUT,
  NOT_NOW_BTN,
  SEND_BTN,
  POST_LINKS,
  POST_CLOSE,
  findFirstVisible,
  resolveClickable,
  clickFirst,
  findProfileLink,
  findSendButton,
};
