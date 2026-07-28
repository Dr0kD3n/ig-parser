'use strict';

const { getSetting } = require('./config');
const {
  checkFeedback,
  getCheckerStatus,
  stopChecker,
} = require('./feedback-checker');
const { getInstagramActivity } = require('./instagram-activity');

const TICK_MS = 30_000;
const RETRY_WHEN_BUSY_MS = 60_000;
const DEFAULT_INTERVAL_MINUTES = 60;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 24 * 60;

let timer = null;
let tickInProgress = false;
let enabled = false;
let intervalMinutes = DEFAULT_INTERVAL_MINUTES;
let nextRunAt = null;
let lastRunAt = null;
let lastResult = null;
let lastError = '';
let configKey = '';

function normalizeInterval(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MINUTES;
  return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, parsed));
}

async function loadConfig() {
  const [enabledValue, intervalValue] = await Promise.all([
    getSetting('feedbackCheckEnabled'),
    getSetting('feedbackCheckIntervalMinutes'),
  ]);
  return {
    enabled: enabledValue === true || enabledValue === 'true',
    intervalMinutes: normalizeInterval(intervalValue),
  };
}

function scheduleAfter(minutes) {
  nextRunAt = new Date(Date.now() + minutes * 60_000).toISOString();
}

async function refreshConfig() {
  const config = await loadConfig();
  const nextKey = `${config.enabled}:${config.intervalMinutes}`;
  enabled = config.enabled;
  intervalMinutes = config.intervalMinutes;

  if (nextKey !== configKey) {
    configKey = nextKey;
    nextRunAt = enabled ? new Date(Date.now() + intervalMinutes * 60_000).toISOString() : null;
  }
}

async function executeFeedbackCheck(trigger) {
  try {
    const result = await checkFeedback({ trigger });
    if (!result?.started) {
      if (result?.reason === 'busy') {
        nextRunAt = new Date(Date.now() + RETRY_WHEN_BUSY_MS).toISOString();
      } else {
        scheduleAfter(intervalMinutes);
      }
      lastResult = result || { started: false, reason: 'not_started' };
      return;
    }

    lastRunAt = new Date().toISOString();
    lastResult = result;
    lastError = '';
    scheduleAfter(intervalMinutes);
  } catch (error) {
    lastRunAt = new Date().toISOString();
    lastError = error.message;
    lastResult = { started: false, reason: 'error', error: error.message };
    scheduleAfter(intervalMinutes);
  } finally {
    tickInProgress = false;
  }
}

function runFeedbackCheckNow(trigger = 'manual') {
  if (tickInProgress || getCheckerStatus().running) {
    return { started: false, reason: 'already_running' };
  }
  const activity = getInstagramActivity();
  if (activity) {
    const result = { started: false, reason: 'busy', activity: activity.type };
    lastResult = result;
    nextRunAt = new Date(Date.now() + RETRY_WHEN_BUSY_MS).toISOString();
    return result;
  }

  tickInProgress = true;
  nextRunAt = null;
  executeFeedbackCheck(trigger).catch((error) => {
    lastError = error.message;
    tickInProgress = false;
  });
  return { started: true };
}

async function tick() {
  await refreshConfig();
  if (!enabled || !nextRunAt || Date.now() < new Date(nextRunAt).getTime()) return;
  runFeedbackCheckNow('timer');
}

function startFeedbackCheckScheduler() {
  if (timer) return;
  tick().catch((error) => {
    lastError = error.message;
    console.error('[FEEDBACK SCHEDULER] Ошибка запуска:', error.message);
  });
  timer = setInterval(() => {
    tick().catch((error) => {
      lastError = error.message;
      console.error('[FEEDBACK SCHEDULER] Ошибка tick:', error.message);
    });
  }, TICK_MS);
  timer.unref?.();
  console.log('[FEEDBACK SCHEDULER] Планировщик проверки ответов запущен');
}

function stopFeedbackCheckScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  stopChecker();
}

function stopFeedbackCheckRun() {
  stopChecker();
}

function getFeedbackCheckStatus() {
  return {
    ...getCheckerStatus(),
    starting: tickInProgress && !getCheckerStatus().running,
    enabled,
    intervalMinutes,
    nextRunAt,
    lastRunAt,
    lastResult,
    lastError,
  };
}

module.exports = {
  DEFAULT_INTERVAL_MINUTES,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
  getFeedbackCheckStatus,
  runFeedbackCheckNow,
  startFeedbackCheckScheduler,
  stopFeedbackCheckRun,
  stopFeedbackCheckScheduler,
};
