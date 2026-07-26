import { describe, expect, it } from 'vitest';

const { createSendRateGovernor } = require('../../backend/lib/send-rate-governor');

describe('send-rate-governor', () => {
  it('сбрасывает серию риск-ошибок после подтверждённой доставки', () => {
    const governor = createSendRateGovernor();

    expect(governor.record({ reason: 'not_verified' })).toMatchObject({
      delayMs: 30_000,
      stop: false,
      consecutiveRiskFailures: 1,
    });
    expect(governor.record({ success: true, delivered: true })).toEqual({
      delayMs: 0,
      stop: false,
    });
    expect(governor.record({ reason: 'send_failed_ui' })).toMatchObject({
      delayMs: 30_000,
      stop: false,
      consecutiveRiskFailures: 1,
    });
  });

  it('останавливает рассылку после трёх риск-ошибок подряд', () => {
    const governor = createSendRateGovernor();

    governor.record({ reason: 'delivery_failed' });
    expect(governor.record({ reason: 'not_verified' })).toMatchObject({
      delayMs: 60_000,
      stop: false,
    });
    expect(governor.record({ reason: 'text_still_in_input' })).toMatchObject({
      delayMs: 120_000,
      stop: true,
      consecutiveRiskFailures: 3,
    });
  });

  it('не считает историю и закрытую вкладку антифрод-ошибками', () => {
    const governor = createSendRateGovernor();

    governor.record({ reason: 'not_verified' });
    expect(governor.record({ reason: 'history' })).toEqual({ delayMs: 0, stop: false });
    expect(governor.record({ reason: 'page_closed' })).toEqual({ delayMs: 0, stop: false });
    expect(governor.record({ reason: 'not_verified' })).toMatchObject({
      delayMs: 30_000,
      consecutiveRiskFailures: 1,
    });
  });
});
