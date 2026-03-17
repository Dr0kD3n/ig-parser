import { describe, it, expect, beforeEach, afterAll } from 'vitest';
const path = require('path');
// process.env.APP_ROOT = path.resolve(__dirname, '../../');
const request = require('supertest');
const app = require('../../backend/server');
const { getDB, resetDB } = require('../../backend/lib/db');

const { getRootPath } = require('../../backend/lib/utils');

describe('API Integration Tests', () => {
  let db;

  beforeEach(async () => {
    resetDB();
    db = await getDB();
  });

  describe('Settings Persistence', () => {
    it('should save and retrieve general settings', async () => {
      const uniqueToken = 'test-token-' + Date.now();
      const testSettings = {
        showBrowser: true,
        concurrentProfiles: 5,
        humanEmulation: true,
        dolphinToken: uniqueToken,
      };

      // 1. Save settings
      console.log(`[TEST] Sending settings to /api/settings...`);
      const saveRes = await request(app).post('/api/settings').send(testSettings);

      expect(saveRes.status).toBe(200);
      expect(saveRes.body.success).toBe(true);

      // 2. Retrieve settings and verify
      console.log(`[TEST] Fetching settings...`);
      const getRes = await request(app).get('/api/settings');
      expect(getRes.status).toBe(200);
      expect(getRes.body.showBrowser).toBe(true);
      expect(getRes.body.concurrentProfiles).toBe(5);
      expect(getRes.body.humanEmulation).toBe(true);
      expect(getRes.body.dolphinToken).toBe(uniqueToken);
    });

    it('should manage keyword lists (names, cities, niches)', async () => {
      const uniqueId = Date.now().toString().slice(-4);
      const testLists = {
        names: ['Alice' + uniqueId, 'Bob'],
        cities: ['City' + uniqueId, 'London'],
        niches: ['Art', 'Tech'],
        forceEmpty: true,
      };

      // 1. Update lists
      console.log(`[TEST] Sending lists to /api/settings...`);
      const saveRes = await request(app).post('/api/settings').send(testLists);

      console.log(`[TEST] Save status: ${saveRes.status}, body: ${JSON.stringify(saveRes.body)}`);
      expect(saveRes.status).toBe(200);
      expect(saveRes.body.success).toBe(true);

      // Verify DB state directly
      const dbCities = await db.all('SELECT value FROM keywords WHERE type = "city"');
      console.log(`[TEST] Direct DB cities: ${JSON.stringify(dbCities.map((r) => r.value))}`);

      // 2. Verify lists retrieved correctly via API
      console.log(`[TEST] Fetching settings via API...`);
      const getRes = await request(app).get('/api/settings');
      console.log(`[TEST] API cities: ${JSON.stringify(getRes.body.cities)}`);

      expect(getRes.body.names).toEqual(expect.arrayContaining(['Alice' + uniqueId]));
      expect(getRes.body.cities).toEqual(expect.arrayContaining(['City' + uniqueId]));
    });
  });

  describe('Account Management', () => {
    it('should create and retrieve an account', async () => {
      const accountId = 'test_acc_' + Date.now();
      const newAccount = {
        accounts: [
          {
            id: accountId,
            name: 'Integration Test Acc',
            proxy: '1.2.3.4:8080',
            cookies: '[]',
          },
        ],
        forceEmpty: false,
      };

      // 1. Add account via settings POST
      console.log(`[TEST] Creating account ${accountId}...`);
      const addRes = await request(app).post('/api/settings').send(newAccount);

      expect(addRes.status).toBe(200);

      // 2. Verify account exists in settings GET
      console.log(`[TEST] Verifying account existence...`);
      const getRes = await request(app).get('/api/settings');
      const createdAcc = getRes.body.accounts.find((a) => a.id === accountId);

      if (!createdAcc) {
        console.log(
          `[TEST] ERROR: Account not found in API response. Accounts: ${JSON.stringify(getRes.body.accounts.map((a) => a.id))}`
        );
        // Check DB directly
        const dbAcc = await db.get('SELECT * FROM accounts WHERE id = ?', [accountId]);
        console.log(`[TEST] DB Check for ${accountId}: ${dbAcc ? 'FOUND' : 'NOT FOUND'}`);
      }

      expect(createdAcc).toBeDefined();
      expect(createdAcc.name).toBe('Integration Test Acc');

      // Cleanup
      await db.run('DELETE FROM accounts WHERE id = ?', [accountId]);
    });
  });
});
