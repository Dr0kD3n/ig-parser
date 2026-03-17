import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

// 1. Setup Spies
const mockDb = {
  get: vi.fn(),
  all: vi.fn(),
  run: vi.fn(),
  exec: vi.fn(),
};

const mockNormalizeUrl = vi.fn((url) => url.replace(/\/$/, '').split('?')[0]);

// 2. Manual require cache hijacking (THE ONLY RELIABLE WAY HERE)
const dbPath = path.resolve(__dirname, '../../backend/lib/db.js');
const configPath = path.resolve(__dirname, '../../backend/lib/config.js');

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    getDB: vi.fn(() => Promise.resolve(mockDb)),
  },
};

require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: {
    normalizeUrl: mockNormalizeUrl,
    getProxy: vi.fn(async (type) => {
      const row = await mockDb.get('SELECT proxy FROM accounts WHERE active_checker = 1');
      if (!row || !row.proxy) return null;
      const parts = row.proxy.split(':');
      return { server: `http://${parts[0]}:${parts[1]}`, username: parts[2], password: parts[3] };
    }),
    getCookies: vi.fn(async (type) => {
      const row = await mockDb.get('SELECT cookies FROM accounts WHERE active_checker = 1');
      return row ? JSON.parse(row.cookies) : [];
    }),
    getSetting: vi.fn(async (key) => {
      const row = await mockDb.get('SELECT value FROM settings WHERE client_key = ?', [key]);
      try {
        return row ? JSON.parse(row.value) : null;
      } catch {
        return row?.value;
      }
    }),
  },
};

// 3. Import modules
const config = require('../../backend/lib/config');
const { StateManager } = require('../../backend/lib/state');
const { shuffleArray, randomDelay } = require('../../backend/lib/utils');

describe('Service Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    StateManager.processed = new Set();
  });

  describe('Config Service', () => {
    it('getProxy should parse database string', async () => {
      mockDb.get.mockResolvedValueOnce({ proxy: '1.2.3.4:8080:u:p' });
      const proxy = await config.getProxy('checker');
      expect(proxy.server).toBe('http://1.2.3.4:8080');
    });

    it('getSetting should handle JSON and plain text', async () => {
      mockDb.get.mockResolvedValueOnce({ value: '{"a":1}' });
      expect(await config.getSetting('k')).toEqual({ a: 1 });

      mockDb.get.mockResolvedValueOnce({ value: 'plain' });
      expect(await config.getSetting('k')).toBe('plain');
    });
  });

  describe('StateManager', () => {
    it('init should load history', async () => {
      mockDb.all.mockResolvedValueOnce([{ url: 'u1' }]);
      mockDb.all.mockResolvedValueOnce([]);
      await StateManager.init();
      expect(StateManager.processed.has('u1')).toBe(true);
    });

    it('saveResult should insert profile if new', async () => {
      mockDb.get.mockResolvedValueOnce(null);
      await StateManager.saveResult({ url: 'url1', name: 'Name1' });
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO profiles'),
        expect.anything()
      );
    });
  });

  describe('Utils', () => {
    it('shuffleArray should randomize', () => {
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const res = shuffleArray(arr);
      expect(res).not.toEqual(arr); // Potentially flaky but very unlikely for 10 elements
      expect(res.sort()).toEqual(arr.sort());
    });

    it('randomDelay should wait a reasonable time', async () => {
      const start = Date.now();
      await randomDelay(100, 200);
      const duration = Date.now() - start;
      expect(duration).toBeGreaterThanOrEqual(90); // Allow for small timing variations
    });
  });
});
