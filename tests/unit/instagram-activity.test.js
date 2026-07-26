import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('instagram-activity', () => {
  let activity;

  beforeEach(async () => {
    vi.resetModules();
    activity = await import('../../backend/lib/instagram-activity.js');
  });

  it('разрешает только одну Instagram-активность', () => {
    const first = activity.tryAcquireInstagramActivity('index');

    expect(first).toBeTruthy();
    expect(activity.tryAcquireInstagramActivity('mass-messenger')).toBeNull();
    expect(activity.getInstagramActivity()).toMatchObject({ type: 'index' });
  });

  it('освобождает lease только правильным владельцем', () => {
    const first = activity.tryAcquireInstagramActivity('parser');

    expect(activity.releaseInstagramActivity({ token: Symbol('other') })).toBe(false);
    expect(activity.getInstagramActivity()).toMatchObject({ type: 'parser' });
    expect(activity.releaseInstagramActivity(first)).toBe(true);
    expect(activity.getInstagramActivity()).toBeNull();
    expect(activity.tryAcquireInstagramActivity('mass-messenger')).toBeTruthy();
  });
});
