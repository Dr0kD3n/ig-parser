import { describe, it, expect, vi } from 'vitest';

const IG = require('../../backend/lib/ig-selectors');

describe('ig-selectors', () => {
  it('экспортирует ключевые группы селекторов', () => {
    expect(IG.HOME_NAV).toContain('aria-label="Home"');
    expect(IG.MESSAGE_BTN).toContain('main header section');
    expect(IG.SEND_BTN).toContain('textbox');
    expect(IG.POST_LINKS).toContain('main article');
  });

  it('findFirstVisible возвращает первый видимый элемент', async () => {
    const mkLoc = (visible) => ({
      first: () => ({
        count: vi.fn().mockResolvedValue(1),
        isVisible: vi.fn().mockResolvedValue(visible),
      }),
    });
    const page = {
      locator: vi.fn()
        .mockReturnValueOnce(mkLoc(false))
        .mockReturnValueOnce(mkLoc(true)),
    };

    const result = await IG.findFirstVisible(page, 'a, b');
    expect(result).toBeTruthy();
    expect(await result.isVisible()).toBe(true);
  });

  it('findProfileLink проверяет href на точное совпадение username', async () => {
    const link = {
      count: vi.fn().mockResolvedValue(1),
      isVisible: vi.fn().mockResolvedValue(true),
      getAttribute: vi.fn().mockResolvedValue('/TestUser/'),
    };
    const scope = {
      count: vi.fn().mockResolvedValue(1),
      locator: vi.fn().mockReturnValue({ first: () => link }),
      getByRole: vi.fn().mockReturnValue({ first: () => ({ count: vi.fn().mockResolvedValue(0) }) }),
    };
    const page = {
      locator: vi.fn().mockReturnValue({ first: () => scope }),
    };

    const found = await IG.findProfileLink(page, 'testuser');
    expect(found).toBe(link);
  });
});
