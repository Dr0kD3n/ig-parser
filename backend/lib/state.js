'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.PATHS = exports.StateManager = void 0;
const db_1 = require('./db');
const config_1 = require('./config');
const { cacheProfilePhoto } = require('./photo-cache');
const {
  normalizeUsername,
  findProfileByUsername,
  mergeProfileRecords,
  mergeDonors,
} = require('./profile-dedup');
exports.StateManager = {
  processed: new Set(),
  processedDonors: new Set(),
  checkedSearches: new Set(), // Map "donorUrl|searchTerm"
  knownUsernames: new Set(),
  resultsCache: [], // Used for fast memory lookups if needed elsewhere
  async init() {
    const db = await db_1.getDB();
    // В urls с type 'history' лежат как processed_profiles, так и processed_donors.
    // Мы разделим логику сейчас, или загрузим все в processed history.
    // Для простоты, все URLs обработанные скриптами можно считать историей.
    const historyRows = await db.all(`SELECT url FROM urls WHERE type = 'history'`);
    this.processed = new Set(historyRows.map((r) => r.url));
    console.log(`🗄️ [ИСТОРИЯ] Загружено проверенных профилей/доноров: ${this.processed.size}`);
    // processDonors tracks which donors have been fully scanned during the current session
    // or loaded from history (type='history').
    this.processedDonors = new Set(historyRows.map((r) => r.url));

    // Load checked searches
    const checkedRows = await db.all(`SELECT donor_url, search_term FROM checked_searches`);
    this.checkedSearches = new Set(checkedRows.map(r => `${config_1.normalizeUrl(r.donor_url)}|${r.search_term}`));
    console.log(`🗄️ [ИСТОРИЯ] Загружено проверенных имен у доноров: ${this.checkedSearches.size}`);

    const profiles = await db.all(`SELECT * FROM profiles`);
    this.resultsCache = profiles;
    this.knownUsernames = new Set(
      profiles.map((p) => normalizeUsername(p.username)).filter(Boolean)
    );
    console.log(`🗄️ [ДЕДУП] Уникальных username в базе: ${this.knownUsernames.size}`);
  },
  hasUsername(username) {
    return this.knownUsernames.has(normalizeUsername(username));
  },
  /** Добавить донора к уже известному username без повторного скрапа */
  async mergeDonorHint(username, donor, url) {
    if (!donor) return;
    const db = await (0, db_1.getDB)();
    const existing = await findProfileByUsername(db, username);
    if (!existing) return;
    const mergedDonor = mergeDonors(existing.donor, donor);
    if (mergedDonor === existing.donor) {
      if (url) await this.add(url);
      return;
    }
    await db.run(`UPDATE profiles SET donor = ?, timestamp = ? WHERE url = ?`, [
      mergedDonor,
      new Date().toISOString(),
      existing.url,
    ]);
    if (url) await this.add(url);
    console.log(`   🔗 [MERGE] @${username} — донор «${donor}» добавлен (${existing.url})`);
  },
  isChecked(donorUrl, searchTerm) {
    return this.checkedSearches.has(`${config_1.normalizeUrl(donorUrl)}|${searchTerm}`);
  },
  async markChecked(donorUrl, searchTerm) {
    const normUrl = config_1.normalizeUrl(donorUrl);
    const key = `${normUrl}|${searchTerm}`;
    if (this.checkedSearches.has(key)) return;
    this.checkedSearches.add(key);
    const db = await (0, db_1.getDB)();
    try {
      await db.run(`INSERT OR IGNORE INTO checked_searches (donor_url, search_term) VALUES (?, ?)`, [normUrl, searchTerm]);
    } catch (e) { }
  },
  has(url) {
    return this.processed.has(config_1.normalizeUrl(url));
  },
  async add(url) {
    const normUrl = config_1.normalizeUrl(url);
    if (this.processed.has(normUrl)) return;
    this.processed.add(normUrl);
    const db = await (0, db_1.getDB)();
    try {
      await db.run(`INSERT INTO urls (type, url) VALUES (?, ?)`, ['history', normUrl]);
    } catch (e) {
      // Already exists constraint
    }
  },
  hasDonor(url) {
    const urlStr = typeof url === 'object' && url !== null ? url.url : url;
    return this.processedDonors.has((0, config_1.normalizeUrl)(urlStr));
  },
  async addDonor(url) {
    const urlStr = typeof url === 'object' && url !== null ? url.url : url;
    await this.add(urlStr);
    const normUrl = (0, config_1.normalizeUrl)(urlStr);
    this.processedDonors.add(normUrl);
    // We now delete from 'donor' type to keep the list clean after processing
    const db = await (0, db_1.getDB)();
    try {
      // [MARK] Donors are no longer deleted from the list after processing to allow visual marking in UI
    } catch (e) {
      console.error('Ошибка при удалении отработанного донора:', e);
    }
  },
  async saveResult(profileData) {
    const db = await (0, db_1.getDB)();
    const usernameNorm = normalizeUsername(profileData.username);
    let existing = await db.get(`SELECT * FROM profiles WHERE url = ?`, [profileData.url]);

    // Merge по username: тот же человек из другого донора / другой URL
    if (!existing && usernameNorm) {
      const byUsername = await findProfileByUsername(db, profileData.username);
      if (byUsername && byUsername.url !== profileData.url) {
        await this.add(profileData.url);
        const merged = mergeProfileRecords(byUsername, {
          ...profileData,
          donor: mergeDonors(byUsername.donor, profileData.donor),
        });
        await db.run(
          `UPDATE profiles SET name = ?, bio = ?, photo = ?, photo_local = ?, photo_cached_at = ?, photo_status = ?,
           followers_count = ?, publications_count = ?, posts_count = ?, donor = ?, isInCity = ?, timestamp = ? WHERE url = ?`,
          [
            merged.name,
            merged.bio,
            merged.photo,
            merged.photo_local,
            merged.photo_cached_at,
            merged.photo_status,
            merged.followers_count,
            merged.publications_count,
            merged.posts_count,
            merged.donor,
            merged.isInCity,
            new Date().toISOString(),
            byUsername.url,
          ]
        );
        console.log(
          `   🔗 [MERGE] @${profileData.username} уже в базе — донор «${profileData.donor || '?'}» добавлен к ${byUsername.url}`
        );
        return;
      }
    }

    const ts = new Date().toISOString();
    const photoUrl = profileData.photo || existing?.photo || '';
    const photoCache = profileData.photo_local
      ? {
        success: true,
        status: profileData.photo_status || 'cached',
        localPath: profileData.photo_local,
        cachedAt: profileData.photo_cached_at || ts,
      }
      : photoUrl
        ? await cacheProfilePhoto(photoUrl).catch((e) => ({
        success: false,
        status: 'failed',
        error: e.message,
      }))
        : { success: false, status: 'missing' };
    if (photoUrl && !photoCache.success) {
      console.warn(`⚠️ [PHOTO CACHE] Не удалось сохранить фото профиля ${profileData.username || profileData.url}: ${photoCache.error || photoCache.status}`);
    }
    const pubCount =
      profileData.publications_count !== undefined
        ? profileData.publications_count
        : profileData.posts_count || 0;
    if (existing) {
      await db.run(
        `UPDATE profiles SET name = ?, username = ?, bio = ?, photo = ?, photo_local = ?, photo_cached_at = ?, photo_status = ?, followers_count = ?, publications_count = ?, posts_count = ?, donor = ?, isInCity = ?, timestamp = ? WHERE url = ?`,
        [
          profileData.name || existing.name,
          profileData.username || existing.username,
          profileData.bio || existing.bio,
          photoUrl,
          photoCache.localPath || existing.photo_local || '',
          photoCache.cachedAt || existing.photo_cached_at || null,
          photoCache.status || existing.photo_status || 'missing',
          profileData.followers_count !== undefined
            ? profileData.followers_count
            : existing.followers_count,
          pubCount || existing.publications_count || existing.posts_count || 0,
          pubCount || existing.publications_count || existing.posts_count || 0,
          mergeDonors(existing.donor, profileData.donor),
          profileData.isInCity !== undefined ? profileData.isInCity : existing.isInCity,
          ts,
          profileData.url,
        ]
      );
    } else {
      if (usernameNorm) this.knownUsernames.add(usernameNorm);
      await db.run(
        `INSERT INTO profiles (url, name, username, bio, photo, photo_local, photo_cached_at, photo_status, followers_count, publications_count, posts_count, donor, vote, isInCity, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          profileData.url,
          profileData.name || '',
          profileData.username || '',
          profileData.bio || '',
          photoUrl,
          photoCache.localPath || '',
          photoCache.cachedAt || null,
          photoCache.status || 'missing',
          profileData.followers_count || 0,
          pubCount || 0,
          pubCount || 0,
          profileData.donor || '',
          profileData.vote || '',
          profileData.isInCity || 0,
          ts,
        ]
      );
    }
    console.log(
      `   ${profileData.isInCity ? "✅" : "🏆"} [НАЙДЕНА] ${profileData.name || profileData.url} (от ${profileData.donor || '?'}) -> сохранена в базу!`
    );
  },
  async loadDonors() {
    const db = await (0, db_1.getDB)();
    const rows = await db.all(`SELECT url, niche, city FROM urls WHERE type = 'donor' ORDER BY id DESC`);
    return rows; // Now returns objects {url, niche, city}
  },
  async saveDonor(url, niche = null, city = null) {
    const normUrl = (0, config_1.normalizeUrl)(url);
    const db = await (0, db_1.getDB)();

    try {
      await db.run(`INSERT OR REPLACE INTO urls (type, url, niche, city) VALUES (?, ?, ?, ?)`, ['donor', normUrl, niche, city]);
      console.log(`✅ Сохранен новый донор: ${normUrl} (${niche || ''} ${city || ''})`);
    } catch (e) {
      // Ignore if already exists in donor table
    }
  },
  async saveDonors(donors) {
    const db = await (0, db_1.getDB)();
    try {
      await db.run(`DELETE FROM urls WHERE type = 'donor'`);
      for (const donor of donors) {
        const url = typeof donor === 'string' ? donor : donor.url;
        const niche = donor.niche || null;
        const city = donor.city || null;
        const normUrl = (0, config_1.normalizeUrl)(url);
        await db.run(`INSERT OR REPLACE INTO urls (type, url, niche, city) VALUES (?, ?, ?, ?)`, ['donor', normUrl, niche, city]);
      }
    } catch (e) {
      console.error('Ошибка при сохранении списка доноров:', e);
      throw e;
    }
  },
  async saveDonorInfo(donorData) {
    const db = await (0, db_1.getDB)();
    const ts = new Date().toISOString();
    const existing = await db.get(`SELECT * FROM donors WHERE username = ?`, [donorData.username]);
    const photoUrl = donorData.photo || existing?.photo || '';
    const photoCache = donorData.photo_local
      ? {
        success: true,
        status: donorData.photo_status || 'cached',
        localPath: donorData.photo_local,
        cachedAt: donorData.photo_cached_at || ts,
      }
      : photoUrl
        ? await cacheProfilePhoto(photoUrl).catch((e) => ({
        success: false,
        status: 'failed',
        error: e.message,
      }))
        : { success: false, status: 'missing' };
    if (photoUrl && !photoCache.success) {
      console.warn(`⚠️ [PHOTO CACHE] Не удалось сохранить фото донора ${donorData.username}: ${photoCache.error || photoCache.status}`);
    }
    if (existing) {
      await db.run(
        `UPDATE donors SET name = ?, bio = ?, photo = ?, photo_local = ?, photo_cached_at = ?, photo_status = ?, followers_count = ?, posts_count = ?, last_updated = ? WHERE username = ?`,
        [
          donorData.name || existing.name,
          donorData.bio || existing.bio,
          photoUrl,
          photoCache.localPath || existing.photo_local || '',
          photoCache.cachedAt || existing.photo_cached_at || null,
          photoCache.status || existing.photo_status || 'missing',
          donorData.followers_count || existing.followers_count,
          donorData.posts_count || existing.posts_count,
          ts,
          donorData.username,
        ]
      );
    } else {
      await db.run(
        `INSERT INTO donors (username, name, bio, photo, photo_local, photo_cached_at, photo_status, followers_count, posts_count, last_updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          donorData.username,
          donorData.name || '',
          donorData.bio || '',
          photoUrl,
          photoCache.localPath || '',
          photoCache.cachedAt || null,
          photoCache.status || 'missing',
          donorData.followers_count || 0,
          donorData.posts_count || 0,
          ts,
        ]
      );
    }
    console.log(`📡 [ДОНОР СОХРАНЕН] ${donorData.username}`);
  },
};
exports.PATHS = {};
