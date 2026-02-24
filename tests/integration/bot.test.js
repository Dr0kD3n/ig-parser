import { describe, it, expect, vi } from 'vitest';
const { checkLoginPage } = require('../../backend/lib/browser');

describe('Bot Logic', () => {
    it('checkLoginPage should detect login URLs', async () => {
        const mockPage = {
            url: () => 'https://www.instagram.com/accounts/login/',
            $: async () => null
        };
        const result = await checkLoginPage(mockPage);
        expect(result).toBe(true);
    });

    it('checkLoginPage should detect login inputs', async () => {
        const mockPage = {
            url: () => 'https://www.instagram.com/',
            $: async (selector) => {
                if (selector.includes('input[name="username"]')) return {};
                return null;
            }
        };
        const result = await checkLoginPage(mockPage);
        expect(result).toBe(true);
    });
});
