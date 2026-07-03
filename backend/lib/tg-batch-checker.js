'use strict';

const { getDB } = require('./db');
const { getSetting } = require('./config');
const { checkTelegramProfile, normalizeTelegramUsername } = require('./telegram-checker');
const logger = require('./logger');

let batchStatus = {
  running: false,
  current: 0,
  total: 0,
  status: 'Idle',
  stopped: false,
};

let stopRequested = false;
let onCompleteCallback = null;

async function updateProfileTgStatus(db, profileUrl, username, tgStatus) {
  if (profileUrl) {
    await db.run(`UPDATE profiles SET tg_status = ? WHERE url = ?`, [tgStatus, profileUrl]);
    return;
  }
  const norm = normalizeTelegramUsername(username);
  if (!norm) return;
  await db.run(
    `UPDATE profiles SET tg_status = ? WHERE LOWER(TRIM(REPLACE(REPLACE(COALESCE(username, ''), '@', ''), ' ', ''))) = ?`,
    [tgStatus, norm]
  );
}

async function runConcurrentPool(items, concurrency, userAgent) {
  const db = await getDB();
  let index = 0;
  let processed = 0;

  const worker = async () => {
    while (!stopRequested) {
      const i = index++;
      if (i >= items.length) break;

      const { profileUrl, username } = items[i];
      batchStatus.status = `@${username} (${Math.min(processed + 1, items.length)}/${items.length})`;

      try {
        const tgStatus = await checkTelegramProfile(username, userAgent);
        await updateProfileTgStatus(db, profileUrl, username, tgStatus);
        logger.info(`[TG BATCH] @${username} → ${tgStatus}`);
      } catch (e) {
        logger.error(`[TG BATCH] @${username}: ${e.message}`);
      } finally {
        processed++;
        batchStatus.current = processed;
      }
    }
  };

  const workers = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
}

async function startTgBatchCheck(items, userAgent, onComplete) {
  if (batchStatus.running) {
    return { ...batchStatus, alreadyRunning: true };
  }

  if (!items?.length) {
    return { running: false, status: 'No profiles', current: 0, total: 0 };
  }

  stopRequested = false;
  onCompleteCallback = onComplete;

  const concurrentStr = await getSetting('concurrentProfiles');
  const concurrency = Math.min(15, Math.max(1, parseInt(concurrentStr, 10) || 5));

  batchStatus = {
    running: true,
    current: 0,
    total: items.length,
    status: `Запуск (${concurrency} потоков)...`,
    stopped: false,
  };

  logger.info(`[TG BATCH] Старт: ${items.length} профилей, потоков: ${concurrency}`);

  setImmediate(async () => {
    try {
      await runConcurrentPool(items, concurrency, userAgent);
      batchStatus.status = stopRequested ? 'Stopped' : 'Done';
      batchStatus.stopped = stopRequested;
    } catch (e) {
      logger.error(`[TG BATCH] Fatal: ${e.message}`);
      batchStatus.status = `Error: ${e.message}`;
    } finally {
      batchStatus.running = false;
      try {
        onCompleteCallback?.();
      } catch (e) {
        logger.error(`[TG BATCH] onComplete: ${e.message}`);
      }
    }
  });

  return { ...batchStatus };
}

function stopTgBatchCheck() {
  if (!batchStatus.running) return { ...batchStatus };
  stopRequested = true;
  batchStatus.status = 'Stopping...';
  logger.info('[TG BATCH] Запрошена остановка');
  return { ...batchStatus };
}

function getTgBatchStatus() {
  return { ...batchStatus };
}

module.exports = {
  startTgBatchCheck,
  stopTgBatchCheck,
  getTgBatchStatus,
};
