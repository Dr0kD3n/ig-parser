'use strict';

const IG = require('./ig-selectors');
const { wait } = require('./utils');
const logger = require('./logger');

/** Кнопки «отложить / отклонить» — не трогаем DM-composer */
const DISMISS_BUTTONS = [
  'button:has-text("Not Now")',
  'button:has-text("Не сейчас")',
  'button:has-text("Allow all cookies")',
  'button:has-text("Разрешить все cookie")',
  'button:has-text("Decline optional cookies")',
  'button:has-text("Only allow essential cookies")',
  'button:has-text("Accept")',
  'button:has-text("Принять")',
  'button:has-text("OK")',
  'button:has-text("ОК")',
];

async function isDmComposerOpen(page) {
  if (!page || page.isClosed()) return false;
  if (/instagram\.com\/direct\//.test(page.url())) return true;

  const inDialog = page
    .locator(
      'div[role="dialog"]:has(div[role="textbox"][contenteditable="true"]) div[role="textbox"][contenteditable="true"]'
    )
    .first();
  return inDialog.isVisible().catch(() => false);
}

/**
 * Закрывает перекрывающие модалки Instagram (save login, cookies, notifications…)
 * @returns {number} сколько действий выполнено
 */
async function dismissBlockingModals(page, { maxRounds = 4 } = {}) {
  if (!page || page.isClosed()) return 0;

  let total = 0;

  for (let round = 0; round < maxRounds; round++) {
    if (await isDmComposerOpen(page)) return total;

    let acted = false;

    for (const sel of DISMISS_BUTTONS) {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
        await btn.click({ timeout: 2500 }).catch(() => {});
        total++;
        acted = true;
        logger.info(`🪟 [MODAL] Нажато: ${sel.split('"')[1] || sel}`);
        await wait(350 + Math.random() * 250);
      }
    }

    if (await isDmComposerOpen(page)) return total;

    const dialogVisible = await page
      .locator('div[role="dialog"]')
      .first()
      .isVisible()
      .catch(() => false);

    if (dialogVisible) {
      const closeBtn = await IG.findFirstVisible(page, IG.POST_CLOSE);
      if (closeBtn) {
        const target = await IG.resolveClickable(closeBtn);
        await target.click({ timeout: 2500 }).catch(() => {});
        total++;
        acted = true;
        logger.info('🪟 [MODAL] Закрыто через Close');
        await wait(350);
      } else {
        await page.keyboard.press('Escape').catch(() => {});
        acted = true;
        await wait(200);
      }
    }

    if (!acted) break;
  }

  return total;
}

/** Периодически проверяет модалки после открытия аккаунта */
function watchBlockingModals(page, durationMs = 90000, intervalMs = 3000) {
  const started = Date.now();

  const tick = () => {
    if (!page || page.isClosed() || Date.now() - started > durationMs) return;
    dismissBlockingModals(page, { maxRounds: 2 }).catch(() => {});
    setTimeout(tick, intervalMs);
  };

  setTimeout(tick, intervalMs);
}

module.exports = { dismissBlockingModals, watchBlockingModals, isDmComposerOpen };
