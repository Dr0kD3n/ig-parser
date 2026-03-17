import { describe, it, expect, vi } from 'vitest';
const { checkLoginPage } = require('../../backend/lib/browser');

describe('Bot Logic', () => {
  it('checkLoginPage should detect login form markers', async () => {
    const mockPage = {
      url: () => 'https://www.instagram.com/accounts/login/',
      evaluate: async (fn) => {
        const document = {
          querySelector: (sel) => (sel === 'form#loginForm' ? {} : null),
        };
        return ['input[name="username"]', 'input[name="password"]', 'form#loginForm'].some(
          (sel) => !!document.querySelector(sel)
        );
      },
    };
    const result = await checkLoginPage(mockPage);
    expect(result).toBe(true);
  });

  it('checkLoginPage should detect login inputs', async () => {
    const mockPage = {
      url: () => 'https://www.instagram.com/',
      evaluate: async (fn) => {
        const document = {
          querySelector: (sel) => (sel === 'input[name="username"]' ? {} : null),
        };
        return ['input[name="username"]', 'input[name="password"]', 'form#loginForm'].some(
          (sel) => !!document.querySelector(sel)
        );
      },
    };
    const result = await checkLoginPage(mockPage);
    expect(result).toBe(true);
  });
});
