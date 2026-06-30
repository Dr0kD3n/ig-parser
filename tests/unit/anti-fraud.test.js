import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  extractUsername,
  getPartialSearchQuery,
  isOnHomeFeed,
  createMessengerSession,
  submitMessage,
} = require('../../backend/lib/anti-fraud');

describe('anti-fraud', () => {
  describe('extractUsername', () => {
    it('извлекает username из URL', () => {
      expect(extractUsername('https://www.instagram.com/test_user/')).toBe('test_user');
      expect(extractUsername('https://instagram.com/@hello')).toBe('hello');
    });

    it('возвращает пустую строку для URL без username', () => {
      expect(extractUsername('https://instagram.com/')).toBe('');
      expect(extractUsername('https://instagram.com/p/ABC123/')).toBe('');
    });
  });

  describe('isOnHomeFeed', () => {
    it('определяет главную ленту', () => {
      expect(isOnHomeFeed('https://www.instagram.com/')).toBe(true);
      expect(isOnHomeFeed('https://www.instagram.com')).toBe(true);
      expect(isOnHomeFeed('https://www.instagram.com/user/')).toBe(false);
    });
  });

  describe('getPartialSearchQuery', () => {
    it('для коротких имён возвращает полностью', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.99);
      expect(getPartialSearchQuery('abc')).toBe('abc');
      Math.random.mockRestore();
    });

    it('для длинных иногда возвращает частичный запрос', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const q = getPartialSearchQuery('verylongusername');
      expect(q.length).toBeGreaterThanOrEqual(3);
      expect(q.length).toBeLessThan('verylongusername'.length);
      expect('verylongusername'.startsWith(q)).toBe(true);
      Math.random.mockRestore();
    });
  });

  describe('createMessengerSession', () => {
    it('создаёт валидную сессию', () => {
      const s = createMessengerSession();
      expect(s).toMatchObject({
        allowGotoFallback: true,
        profileCount: 0,
      });
      expect(typeof s.useEnter).toBe('boolean');
    });
  });

  describe('submitMessage', () => {
    let page;
    let session;

    const mkLocator = () => ({
      first: () => ({
        count: vi.fn().mockResolvedValue(0),
        isVisible: vi.fn().mockResolvedValue(false),
      }),
      last: () => ({
        count: vi.fn().mockResolvedValue(0),
        isVisible: vi.fn().mockResolvedValue(false),
        locator: vi.fn(() => ({
          last: () => ({
            count: vi.fn().mockResolvedValue(0),
            isVisible: vi.fn().mockResolvedValue(false),
          }),
        })),
      }),
    });

    beforeEach(() => {
      session = { useEnter: true };
      page = {
        keyboard: { press: vi.fn().mockResolvedValue(undefined) },
        locator: vi.fn(() => mkLocator()),
      };
    });

    it('чередует Enter и кнопку Send', async () => {
      await submitMessage(page, 'input', session);
      expect(page.keyboard.press).toHaveBeenCalledWith('Enter');
      expect(session.useEnter).toBe(false);

      session.useEnter = false;
      await submitMessage(page, 'input', session);
      expect(page.keyboard.press).toHaveBeenCalledTimes(2);
      expect(session.useEnter).toBe(true);
    });
  });
});
