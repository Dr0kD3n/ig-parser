'use strict';

const RISK_REASONS = new Set([
  'delivery_failed',
  'send_failed_ui',
  'text_still_in_input',
  'not_verified',
  'wrong_chat',
  'no_textbox',
]);

const NEUTRAL_REASONS = new Set([
  'history',
  'chat_exists',
  'no_button',
  'page_closed',
]);

function createSendRateGovernor(options = {}) {
  const stopAfter = Number(options.stopAfter) || 3;
  let consecutiveRiskFailures = 0;

  return {
    record(result = {}) {
      if (result.success && result.delivered) {
        consecutiveRiskFailures = 0;
        return { delayMs: 0, stop: false };
      }

      const reason = String(result.reason || 'error');
      if (NEUTRAL_REASONS.has(reason)) {
        consecutiveRiskFailures = 0;
        return { delayMs: 0, stop: false };
      }

      if (!RISK_REASONS.has(reason)) {
        consecutiveRiskFailures = 0;
        return { delayMs: 0, stop: false };
      }

      consecutiveRiskFailures++;
      const delayMs = Math.min(10 * 60_000, 30_000 * (2 ** (consecutiveRiskFailures - 1)));
      return {
        delayMs,
        stop: consecutiveRiskFailures >= stopAfter,
        reason,
        consecutiveRiskFailures,
      };
    },

    reset() {
      consecutiveRiskFailures = 0;
    },
  };
}

module.exports = { createSendRateGovernor };
