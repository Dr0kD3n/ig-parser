const db = require('../lib/db');
const ctx = require('../lib/server-context');

/** E2E-хелперы — доступны только при E2E_TEST=1 */
module.exports = (app) => {
  const { invalidateGirlsCache } = ctx;

  app.post('/api/e2e/reset', async (req, res) => {
    try {
      const database = await db.getDB();

      await database.run('DELETE FROM profiles');
      await database.run(`DELETE FROM urls WHERE type IN ('donor', 'history')`);
      await database.run('DELETE FROM donors');
      await database.run('DELETE FROM messages_log');
      await database.run('DELETE FROM checked_searches');

      const accountId = 'e2e_account';
      await database.run(`DELETE FROM accounts WHERE id != ?`, [accountId]);
      await database.run(
        `INSERT OR REPLACE INTO accounts (id, name, proxy, cookies, active_parser, active_server, active_index, active_profiles, active_checker, fingerprint, local_storage, warmup_score, last_warmup)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          accountId,
          'E2E Account',
          '',
          '',
          1,
          1,
          1,
          1,
          0,
          '{}',
          null,
          0,
          null,
        ]
      );

      await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
        'dmLimit',
        '1',
      ]);
      await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
        'donorGroups',
        JSON.stringify([
          {
            id: 'all',
            name: 'All',
            messages: ['E2E test message {{name}}'],
          },
        ]),
      ]);
      await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
        'showBrowser',
        'false',
      ]);

      invalidateGirlsCache();

      res.json({ success: true });
    } catch (e) {
      console.error('[E2E] reset failed:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get('/api/e2e/state', async (req, res) => {
    try {
      const database = await db.getDB();
      const donors = await database.all(`SELECT url FROM urls WHERE type = 'donor'`);
      const profiles = await database.all(
        `SELECT url, username, name, vote, dmSent, dmError FROM profiles ORDER BY rowid ASC`
      );

      res.json({
        donorsCount: donors.length,
        profilesCount: profiles.length,
        donors: donors.map((d) => d.url),
        profiles,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });
};
