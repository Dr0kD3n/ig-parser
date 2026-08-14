const db = require('../lib/db');
const state = require('../lib/state');
const config = require('../lib/config');
const fingerprint = require('../lib/fingerprint');
const ctx = require('../lib/server-context');
module.exports = (app) => {
  const { getSettings, encryptSafe, decrypt } = ctx;
app.get('/api/settings', async (req, res) => {
  const settings = await getSettings();
  const names = await config.getList('names.txt');
  const cities = await config.getList('cityKeywords.txt');
  const citiesBlacklist = await config.getList('cityBlacklist.txt');
  const wordsBlacklist = await config.getList('wordBlacklist.txt');
  const niches = await config.getList('nicheKeywords.txt');
  const donors = await state.StateManager.loadDonors();
  const database = await db.getDB();
  const historyRows = await database.all(`SELECT url FROM urls WHERE type = 'history'`);
  const checkedDonors = historyRows.map((r) => r.url);

  res.json({
    accounts: (settings.accounts || []).map((a) => ({
      id: a.id,
      name: a.name,
      proxy: a.proxy,
      warmup_score: a.warmup_score,
      last_warmup: a.last_warmup,
      fingerprint: a.fingerprint,
      cookies: a.cookies,
      warmup_progress: a.warmup_progress,
      warmup_running: a.warmup_running,
    })),
    activeParserAccountIds: settings.activeParserAccountIds,
    activeServerAccountIds: settings.activeServerAccountIds,
    activeIndexAccountIds: settings.activeIndexAccountIds,
    activeProfilesAccountIds: settings.activeProfilesAccountIds,
    activeCheckerAccountIds: settings.activeCheckerAccountIds,
    names,
    cities,
    citiesBlacklist,
    wordsBlacklist,
    niches,
    donors,
    checkedDonors,
    showBrowser: settings.showBrowser,
    monochromeMode: settings.monochromeMode,
    concurrentProfiles: settings.concurrentProfiles,
    dmLimit: settings.dmLimit,
    donorFollowersMin: settings.donorFollowersMin,
    donorFollowersMax: settings.donorFollowersMax,
    targetFollowersMin: settings.targetFollowersMin,
    targetFollowersMax: settings.targetFollowersMax,
    humanEmulation: settings.humanEmulation,
    dolphinToken: settings.dolphinToken,
    donorGroups: settings.donorGroups,
    nichePresets: settings.nichePresets,
    feedbackCheckEnabled: settings.feedbackCheckEnabled,
    feedbackCheckIntervalMinutes: settings.feedbackCheckIntervalMinutes,
  });
});
app.post('/api/settings', async (req, res) => {
  console.log(`[DEBUG] POST /api/settings received. Keys: ${Object.keys(req.body)}`);
  const { accounts, names, cities, citiesBlacklist, wordsBlacklist, niches, donors, showBrowser } = req.body;
  try {
    const database = await db.getDB();
    await database.run('BEGIN TRANSACTION');
    console.log(`[DEBUG] Transaction started`);
    try {
      if (Object.hasOwn(req.body, 'accounts')) {
        const incomingIds = (accounts || []).map((a) => a.id);
        if (incomingIds.length > 0) {
          const placeholders = incomingIds.map(() => '?').join(',');
          await database.run(`DELETE FROM accounts WHERE id NOT IN (${placeholders})`, incomingIds);
        } else {
          await database.run(`DELETE FROM accounts`);
        }
        for (const a of accounts || []) {
          const getPriority = (arr, id) => {
            const idx = (arr || []).indexOf(id);
            return idx === -1 ? 0 : idx + 1;
          };

          let accountFingerprint = a.fingerprint;
          if (!accountFingerprint) {
            accountFingerprint = JSON.stringify(fingerprint.generateFingerprint());
          } else if (typeof accountFingerprint !== 'string') {
            accountFingerprint = JSON.stringify(accountFingerprint);
          }

          // Не затираем proxy/cookies/localStorage пустыми значениями из bulk-save
          let finalProxy = a.proxy || '';
          let finalCookies = a.cookies || '';
          let finalLocalStorage = a.local_storage || null;

          if (!finalProxy || !finalCookies || !finalLocalStorage) {
            const existing = await database.get(
              'SELECT proxy, cookies, local_storage FROM accounts WHERE id = ?',
              [a.id]
            );
            if (existing) {
              if (!finalProxy && existing.proxy) finalProxy = decrypt(existing.proxy);
              if (!finalCookies && existing.cookies) finalCookies = decrypt(existing.cookies);
              if (!finalLocalStorage && existing.local_storage)
                finalLocalStorage = existing.local_storage;
            }
          }

          await database.run(
            `INSERT OR REPLACE INTO accounts (id, name, proxy, cookies, active_parser, active_server, active_index, active_profiles, active_checker, fingerprint, local_storage, warmup_score, last_warmup)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              a.id,
              a.name,
              encryptSafe(finalProxy || ''),
              encryptSafe(finalCookies),
              getPriority(req.body.activeParserAccountIds, a.id),
              getPriority(req.body.activeServerAccountIds, a.id),
              getPriority(req.body.activeIndexAccountIds, a.id),
              getPriority(req.body.activeProfilesAccountIds, a.id),
              getPriority(req.body.activeCheckerAccountIds, a.id),
              accountFingerprint,
              finalLocalStorage,
              a.warmup_score || 0,
              a.last_warmup || null,
            ]
          );
        }
      }
      // Only update keywords if they are explicitly provided in the request
      const updateList = async (type, requestKey, items) => {
        if (!Object.hasOwn(req.body, requestKey)) return;
        const cleanItems = (items || []).map((i) => String(i).trim()).filter(Boolean);
        const existing = await database.get(`SELECT count(*) as c FROM keywords WHERE type = ?`, [type]);
        if (existing.c > 5 && cleanItems.length === 0 && !req.body.forceEmpty) return;

        await database.run(`DELETE FROM keywords WHERE type = ?`, [type]);
        for (const val of cleanItems) {
          await database.run(`INSERT INTO keywords (type, value) VALUES (?, ?)`, [type, val]);
        }
      };
      await updateList('name', 'names', names);
      await updateList('city', 'cities', cities);
      await updateList('city_blacklist', 'citiesBlacklist', citiesBlacklist);
      await updateList('word_blacklist', 'wordsBlacklist', wordsBlacklist);
      await updateList('niche', 'niches', niches);
      if (Object.hasOwn(req.body, 'donors')) {
        const processedDonorsInReq = (donors || []).map((d) => {
          if (typeof d === 'string') return d.trim();
          if (d && typeof d === 'object' && d.url) return { ...d, url: d.url.trim() };
          return d;
        }).filter(Boolean);

        const existingDonorsCount = (await state.StateManager.loadDonors()).length;
        if (!(existingDonorsCount > 5 && processedDonorsInReq.length === 0 && !req.body.forceEmpty)) {
          await state.StateManager.saveDonors(processedDonorsInReq);
        }
      }
      if (Object.hasOwn(req.body, 'showBrowser')) {
        await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
          'showBrowser',
          showBrowser ? 'true' : 'false',
        ]);
      }
      if (Object.hasOwn(req.body, 'monochromeMode')) {
        await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
          'monochromeMode',
          req.body.monochromeMode ? 'true' : 'false',
        ]);
      }
      if (Object.hasOwn(req.body, 'concurrentProfiles')) {
        await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
          'concurrentProfiles',
          req.body.concurrentProfiles.toString(),
        ]);
      }
      if (Object.hasOwn(req.body, 'dmLimit')) {
        await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
          'dmLimit',
          req.body.dmLimit.toString(),
        ]);
      }
      for (const key of [
        'donorFollowersMin',
        'donorFollowersMax',
        'targetFollowersMin',
        'targetFollowersMax',
      ]) {
        if (!Object.hasOwn(req.body, key)) continue;
        const value = Math.max(0, Number.parseInt(req.body[key], 10) || 0);
        await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
          key,
          String(value),
        ]);
      }
      if (Object.hasOwn(req.body, 'humanEmulation')) {
        await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
          'humanEmulation',
          req.body.humanEmulation ? 'true' : 'false',
        ]);
      }
      if (Object.hasOwn(req.body, 'dolphinToken')) {
        await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
          'dolphinToken',
          req.body.dolphinToken || '',
        ]);
      }
      if (Object.hasOwn(req.body, 'donorGroups')) {
        await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
          'donorGroups',
          JSON.stringify(req.body.donorGroups || []),
        ]);
      }
      if (Object.hasOwn(req.body, 'nichePresets')) {
        await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
          'nichePresets',
          JSON.stringify(Array.isArray(req.body.nichePresets) ? req.body.nichePresets : []),
        ]);
      }
      if (Object.hasOwn(req.body, 'feedbackCheckEnabled')) {
        await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
          'feedbackCheckEnabled',
          req.body.feedbackCheckEnabled ? 'true' : 'false',
        ]);
      }
      if (Object.hasOwn(req.body, 'feedbackCheckIntervalMinutes')) {
        const interval = Math.min(
          1440,
          Math.max(5, Number.parseInt(req.body.feedbackCheckIntervalMinutes, 10) || 60)
        );
        await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
          'feedbackCheckIntervalMinutes',
          String(interval),
        ]);
      }
      await database.run('COMMIT');
    } catch (txErr) {
      await database.run('ROLLBACK');
      throw txErr;
    }
    res.json({ success: true });
  } catch (e) {
    console.error('Ошибка сохранения настроек:', e);
    res.status(500).json({ success: false });
  }
});
};
