'use strict';

const { getDB } = require('./db');
const { getAllAccounts, getSetting } = require('./config');
const { createBrowserContext } = require('./browser');
const {
  tryAcquireInstagramActivity,
  releaseInstagramActivity,
  getInstagramActivity,
} = require('./instagram-activity');
const { emitOperationEvent } = require('./operation-events');
const { wait } = require('./utils');
const logger = require('./logger');

const THREAD_LINK_SELECTOR = 'a[href*="/direct/t/"]';
const FINAL_STATUSES = ['replied', 'liked', 'ignored', 'drain'];
const PRIMARY_FOLDER_LABELS = ['Primary', 'Основные'];
const OWN_MESSAGE_PATTERN = /^(you sent|sent|вы отправили|вы:|you:)/i;
const ACTIVITY_PATTERN =
  /^(active|online|в сети|был(?:а)? в сети|была недавно|был недавно|instagram user|пользователь instagram)/i;
const TIME_ONLY_PATTERN =
  /^(now|сейчас|today|сегодня|yesterday|вчера|\d+\s*(?:s|sec|m|min|h|d|w|с|сек|м|мин|ч|д|нед)\.?)$/i;
const TIME_SUFFIX_PATTERN =
  /\s*[·•]\s*(?:now|сейчас|today|сегодня|yesterday|вчера|\d+\s*(?:s|sec|m|min|h|d|w|с|сек|м|мин|ч|д|нед)\.?)$/i;

let checkerStatus = {
  running: false,
  current: 0,
  total: 0,
  found: 0,
  status: 'Idle',
};
let checkerStopRequested = false;

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeUsername(value) {
  return normalizeText(value).replace(/^@/, '');
}

function getTargetIdentity(target) {
  return {
    username: normalizeUsername(target.username || target.profile_username),
    name: normalizeText(target.name || target.profile_name),
  };
}

function rowMatchesTarget(lines, target) {
  const { username, name } = getTargetIdentity(target);
  const normalizedLines = lines.map(normalizeText);
  if (
    username &&
    normalizedLines.some((line) => line === username || line === `@${username}`)
  ) {
    return true;
  }
  return !!name && normalizedLines.some((line) => line === name);
}

function stripTimeSuffix(line) {
  return String(line || '').replace(TIME_SUFFIX_PATTERN, '').trim();
}

function extractPreview(lines, target) {
  const { username, name } = getTargetIdentity(target);
  const candidates = lines
    .map(stripTimeSuffix)
    .filter(Boolean)
    .filter((line) => {
      const normalized = normalizeText(line);
      if (!normalized) return false;
      if (normalized === username || normalized === `@${username}` || normalized === name) {
        return false;
      }
      if (TIME_ONLY_PATTERN.test(normalized) || ACTIVITY_PATTERN.test(normalized)) return false;
      return true;
    });
  return candidates.at(-1) || '';
}

function previewIsOwnMessage(preview, sentMessage) {
  const normalizedPreview = normalizeText(preview);
  if (!normalizedPreview) return true;
  if (OWN_MESSAGE_PATTERN.test(normalizedPreview)) return true;

  const normalizedSent = normalizeText(sentMessage);
  if (!normalizedSent) return false;
  const signatureLength = Math.min(32, normalizedSent.length, normalizedPreview.length);
  if (signatureLength < 4) return false;
  return normalizedPreview.slice(0, signatureLength) === normalizedSent.slice(0, signatureLength);
}

function classifyPreview(preview) {
  const value = normalizeText(preview);
  if (
    value.includes('liked a message') ||
    value.includes('liked your message') ||
    value.includes('нравится ваше сообщение') ||
    value.includes('понравилось сообщение')
  ) {
    return { status: 'liked', kind: 'reaction' };
  }
  return { status: 'replied', kind: 'text' };
}

function getTriggerLabel(trigger) {
  return trigger === 'timer' ? 'таймер' : 'вручную';
}

function reportCheckResult({
  operationStatus,
  trigger,
  senderCount,
  pending,
  checked,
  found,
  startedAt,
  error = '',
}) {
  const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  const details = {
    trigger,
    folder: 'Primary',
    senderCount,
    pending,
    checked,
    found,
    durationSeconds,
    error,
  };
  const stateLabel =
    operationStatus === 'completed'
      ? 'Завершён'
      : operationStatus === 'stopped'
        ? 'Остановлен'
        : 'Ошибка';
  const summary =
    `[АВТОЧЕК] ${stateLabel}. Источник: ${getTriggerLabel(trigger)}. Primary. ` +
    `Сендеров: ${senderCount}. Ожидали ответа: ${pending}. ` +
    `Проверено: ${checked}. Ответили: ${found}. Время: ${durationSeconds} сек.` +
    (error ? ` Причина: ${error}` : '');

  if (operationStatus === 'failed') logger.error(summary);
  else logger.info(summary);
  emitOperationEvent('feedback-check', operationStatus, details);
  return details;
}

async function dismissInboxDialogs(page) {
  const button = page
    .locator(
      'button:has-text("Not Now"), button:has-text("Не сейчас"), button:has-text("Save Info")'
    )
    .first();
  if (await button.isVisible().catch(() => false)) {
    await button.click().catch(() => {});
    await wait(750);
  }
}

async function readVisibleThreadRows(page, maxScrolls = 12) {
  const rows = new Map();
  let stablePasses = 0;

  for (let pass = 0; pass < maxScrolls && !checkerStopRequested; pass++) {
    const links = page.locator(THREAD_LINK_SELECTOR);
    const count = await links.count().catch(() => 0);
    const before = rows.size;

    for (let index = 0; index < count; index++) {
      const link = links.nth(index);
      if (!(await link.isVisible().catch(() => false))) continue;
      const href = (await link.getAttribute('href').catch(() => '')) || '';
      if (!href) continue;
      const text = (await link.innerText().catch(() => '')).trim();
      if (!text) continue;
      rows.set(href, {
        href,
        lines: text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      });
    }

    stablePasses = rows.size === before ? stablePasses + 1 : 0;
    if (stablePasses >= 2 || count === 0) break;

    const last = links.nth(Math.max(0, count - 1));
    await last.scrollIntoViewIfNeeded().catch(() => {});
    await page.mouse.wheel(0, 900).catch(() => {});
    await wait(600);
  }

  return Array.from(rows.values());
}

async function selectPrimaryFolder(page) {
  for (const label of PRIMARY_FOLDER_LABELS) {
    const tab = page.getByText(label, { exact: true }).first();
    if (await tab.isVisible().catch(() => false)) {
      await tab.click().catch(() => {});
      await wait(900);
      return;
    }
  }
}

async function collectPrimaryInboxRows(page) {
  await selectPrimaryFolder(page);
  return readVisibleThreadRows(page);
}

function selectTargetForRow(row, targets) {
  const matches = targets.filter((target) => rowMatchesTarget(row.lines, target));
  return matches.length === 1 ? matches[0] : null;
}

async function loadPendingTargets(database) {
  const rows = await database.all(
    `SELECT m.id, m.url, m.username, m.name, m.message_text, m.timestamp, m.account_id,
            p.username AS profile_username, p.name AS profile_name
     FROM messages_log m
     LEFT JOIN profiles p ON p.url = m.url
     WHERE m.status NOT IN (${FINAL_STATUSES.map(() => '?').join(', ')})
       AND COALESCE(m.status_manual, 0) = 0
     ORDER BY datetime(m.timestamp) DESC, m.id DESC`,
    FINAL_STATUSES
  );

  const unique = new Map();
  for (const row of rows) {
    const identity = getTargetIdentity(row);
    const key = `${row.account_id || ''}:${identity.username || identity.name}`;
    if (!identity.username && !identity.name) continue;
    if (!unique.has(key)) unique.set(key, row);
  }
  return Array.from(unique.values());
}

async function saveDetectedReply(database, target, preview) {
  const detectedAt = new Date().toISOString();
  const classification = classifyPreview(preview);
  const result = await database.run(
    `UPDATE messages_log
     SET status = ?, reply_preview = ?, reply_at = ?, reply_kind = ?, reply_source = 'inbox_preview'
     WHERE id = ?
       AND status NOT IN (${FINAL_STATUSES.map(() => '?').join(', ')})
       AND COALESCE(status_manual, 0) = 0`,
    [
      classification.status,
      preview,
      detectedAt,
      classification.kind,
      target.id,
      ...FINAL_STATUSES,
    ]
  );
  if (!result.changes) return false;
  await database.run(`UPDATE profiles SET dm_status = ? WHERE url = ?`, [
    classification.status,
    target.url,
  ]);
  return true;
}

async function checkAccount(database, account, allTargets, showBrowser) {
  const targets = allTargets.filter(
    (target) => !target.account_id || String(target.account_id) === String(account.id)
  );
  if (!targets.length) return { checked: 0, found: 0 };

  checkerStatus.status = `Открываем inbox: ${account.name}`;
  const browserConfig = {
    id: account.id,
    proxy: account.proxy,
    cookies: account.cookies,
    fingerprint: account.fingerprint,
    timeouts: { pageLoad: 60_000 },
  };
  let browser;
  let context;
  let page;

  try {
    ({ browser, context } = await createBrowserContext(browserConfig, !showBrowser));
    page = await context.newPage();
    await page.goto('https://www.instagram.com/direct/inbox/', {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await wait(3_000);
    await dismissInboxDialogs(page);

    const rows = await collectPrimaryInboxRows(page);
    let checked = 0;
    let found = 0;

    for (const row of rows) {
      if (checkerStopRequested) break;
      const target = selectTargetForRow(row, targets);
      if (!target) continue;
      checked += 1;
      checkerStatus.current += 1;
      checkerStatus.status = `Проверяем ${account.name}: ${checkerStatus.current}/${checkerStatus.total}`;

      const preview = extractPreview(row.lines, target);
      if (!preview || previewIsOwnMessage(preview, target.message_text)) continue;
      if (await saveDetectedReply(database, target, preview)) {
        found += 1;
        checkerStatus.found += 1;
        logger.info(`✨ [${account.name}] Ответ от @${target.username || target.profile_username}: ${preview}`);
      }
    }
    return { checked, found };
  } finally {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

async function checkFeedback(options = {}) {
  if (checkerStatus.running) return { started: false, reason: 'already_running' };
  const activityLease = tryAcquireInstagramActivity('feedback-checker');
  if (!activityLease) {
    return {
      started: false,
      reason: 'busy',
      activity: getInstagramActivity()?.type || 'unknown',
    };
  }

  checkerStopRequested = false;
  checkerStatus = {
    running: true,
    current: 0,
    total: 0,
    found: 0,
    status: 'Подготовка...',
  };

  let checked = 0;
  let found = 0;
  const trigger = options.trigger === 'timer' ? 'timer' : 'manual';
  const startedAt = Date.now();
  let pending = 0;
  let senderCount = 0;
  try {
    const database = await getDB();
    const [targets, senderAccounts] = await Promise.all([
      loadPendingTargets(database),
      getAllAccounts('server'),
    ]);
    pending = targets.length;
    senderCount = senderAccounts.length;
    checkerStatus.total = pending;
    logger.info(
      `[АВТОЧЕК] Старт. Источник: ${getTriggerLabel(trigger)}. Primary. ` +
      `Сендеров: ${senderCount}. Ожидают ответа: ${pending}.`
    );

    if (!targets.length) {
      checkerStatus.status = 'Нет сообщений для проверки';
      const details = reportCheckResult({
        operationStatus: 'completed',
        trigger,
        senderCount,
        pending,
        checked,
        found,
        startedAt,
      });
      return { started: true, stopped: false, ...details };
    }

    if (!senderAccounts.length) {
      checkerStatus.status = 'Нет аккаунтов-сендеров';
      const error = 'Не выбраны аккаунты с ролью «Сендер»';
      const details = reportCheckResult({
        operationStatus: 'failed',
        trigger,
        senderCount,
        pending,
        checked,
        found,
        startedAt,
        error,
      });
      return { started: true, stopped: false, ...details };
    }

    const showBrowser = (await getSetting('showBrowser')) === true;
    for (const account of senderAccounts) {
      if (checkerStopRequested) break;
      try {
        const result = await checkAccount(database, account, targets, showBrowser);
        checked += result.checked;
        found += result.found;
        logger.info(
          `[АВТОЧЕК] Сендер: ${account.name}. Проверено: ${result.checked}. ` +
          `Ответили: ${result.found}.`
        );
      } catch (error) {
        logger.error(`[FEEDBACK] ${account.name}: ${error.message}`);
      }
    }

    const stopped = checkerStopRequested;
    checkerStatus.status = stopped ? 'Остановлено' : `Готово, найдено ответов: ${found}`;
    const details = reportCheckResult({
      operationStatus: stopped ? 'stopped' : 'completed',
      trigger,
      senderCount,
      pending,
      checked,
      found,
      startedAt,
    });
    return { started: true, stopped, ...details };
  } catch (error) {
    checkerStatus.status = `Ошибка: ${error.message}`;
    reportCheckResult({
      operationStatus: 'failed',
      trigger,
      senderCount,
      pending,
      checked,
      found,
      startedAt,
      error: error.message,
    });
    throw error;
  } finally {
    checkerStatus.running = false;
    releaseInstagramActivity(activityLease);
  }
}

function getCheckerStatus() {
  return { ...checkerStatus };
}

function stopChecker() {
  checkerStopRequested = true;
  checkerStatus.status = 'Останавливаем...';
}

module.exports = {
  checkFeedback,
  getCheckerStatus,
  stopChecker,
};
