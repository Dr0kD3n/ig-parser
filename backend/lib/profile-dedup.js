'use strict';

/** Нормализация IG username для сравнения */
function normalizeUsername(value) {
  if (!value) return '';
  return String(value)
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
}

/** SQL-выражение для сравнения username (без учёта регистра и @) */
const USERNAME_SQL = `LOWER(TRIM(REPLACE(REPLACE(COALESCE(username, ''), '@', ''), ' ', '')))`;

/** Объединяет списки доноров без дублей */
function mergeDonors(existing, incoming) {
  const set = new Set();
  const add = (raw) => {
    String(raw || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((d) => set.add(d));
  };
  add(existing);
  add(incoming);
  return Array.from(set).join(', ');
}

/** Выбираем лучшее значение поля при merge */
function pickRicherText(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left) return right;
  if (!right) return left;
  return right.length > left.length ? right : left;
}

function pickVote(a, b) {
  const rank = { like: 3, '': 2, dislike: 1 };
  const left = String(a || '').toLowerCase();
  const right = String(b || '').toLowerCase();
  return (rank[left] || 0) >= (rank[right] || 0) ? left : right;
}

function pickDmStatus(a, b) {
  const rank = { replied: 5, liked: 4, drain: 3, ignored: 2, '': 1 };
  const left = String(a || '').toLowerCase();
  const right = String(b || '').toLowerCase();
  return (rank[left] || 0) >= (rank[right] || 0) ? left || null : right || null;
}

function pickTgStatus(a, b) {
  const rank = { valid: 4, channel: 3, '': 2, invalid: 1 };
  const left = String(a || '').toLowerCase();
  const right = String(b || '').toLowerCase();
  return (rank[left] || 0) >= (rank[right] || 0) ? left || null : right || null;
}

/** Слияние двух записей профиля в одну (canonical ← incoming) */
function mergeProfileRecords(canonical, incoming) {
  return {
    url: canonical.url,
    name: pickRicherText(canonical.name, incoming.name),
    username: canonical.username || incoming.username,
    bio: pickRicherText(canonical.bio, incoming.bio),
    photo: canonical.photo || incoming.photo || '',
    photo_local: canonical.photo_local || incoming.photo_local || '',
    photo_cached_at: canonical.photo_cached_at || incoming.photo_cached_at || null,
    photo_status: canonical.photo_status || incoming.photo_status || 'missing',
    followers_count: Math.max(canonical.followers_count || 0, incoming.followers_count || 0),
    publications_count: Math.max(
      canonical.publications_count || canonical.posts_count || 0,
      incoming.publications_count || incoming.posts_count || 0
    ),
    posts_count: Math.max(canonical.posts_count || 0, incoming.posts_count || 0),
    donor: mergeDonors(canonical.donor, incoming.donor),
    vote: pickVote(canonical.vote, incoming.vote),
    tg_status: pickTgStatus(canonical.tg_status, incoming.tg_status),
    dmSent: canonical.dmSent === 1 || incoming.dmSent === 1 ? 1 : 0,
    tgTagged: canonical.tgTagged === 1 || incoming.tgTagged === 1 ? 1 : 0,
    dmError: canonical.dmError || incoming.dmError || null,
    dm_status: pickDmStatus(canonical.dm_status, incoming.dm_status),
    isInCity: canonical.isInCity === 1 || incoming.isInCity === 1 ? 1 : 0,
    timestamp: canonical.timestamp || incoming.timestamp,
  };
}

async function findProfileByUsername(db, username) {
  const norm = normalizeUsername(username);
  if (!norm) return null;
  return db.get(`SELECT * FROM profiles WHERE ${USERNAME_SQL} = ? LIMIT 1`, [norm]);
}

async function findProfilesByUsername(db, username) {
  const norm = normalizeUsername(username);
  if (!norm) return [];
  return db.all(`SELECT * FROM profiles WHERE ${USERNAME_SQL} = ?`, [norm]);
}

/** Пометить dmSent (и связанные поля) у всех строк с тем же username */
async function markDmSentByUsername(db, username, patch = {}) {
  const norm = normalizeUsername(username);
  if (!norm) return 0;

  const fields = ['dmSent = 1'];
  const params = [];

  if ('dmError' in patch) {
    fields.push('dmError = ?');
    params.push(patch.dmError);
  } else if (patch.clearError) {
    fields.push('dmError = NULL');
  }

  if (patch.tgTagged === 0) {
    fields.push('tgTagged = 0');
  }

  params.push(norm);
  const result = await db.run(
    `UPDATE profiles SET ${fields.join(', ')} WHERE ${USERNAME_SQL} = ?`,
    params
  );
  return result?.changes || 0;
}

/** Есть ли уже отправленное DM для этого username (cross-donor) */
async function isUsernameDmSent(db, username) {
  const norm = normalizeUsername(username);
  if (!norm) return false;
  const row = await db.get(
    `SELECT 1 AS ok FROM profiles WHERE ${USERNAME_SQL} = ? AND dmSent = 1 LIMIT 1`,
    [norm]
  );
  return !!row;
}

/** Один профиль на username в очереди рассылки + skip уже отправленных */
function dedupeProfilesForMessaging(profiles) {
  const seen = new Set();
  const result = [];

  for (const profile of profiles) {
    const norm = normalizeUsername(profile.username);
    if (!norm) {
      result.push(profile);
      continue;
    }
    if (seen.has(norm)) continue;
    seen.add(norm);
    result.push(profile);
  }

  return result;
}

/** Слияние существующих дублей в БД (один раз при старте) */
async function mergeDuplicateProfiles(db) {
  const groups = await db.all(`
    SELECT ${USERNAME_SQL} AS uname, COUNT(*) AS cnt
    FROM profiles
    WHERE username IS NOT NULL AND TRIM(username) != ''
    GROUP BY uname
    HAVING cnt > 1
  `);

  if (!groups.length) return 0;

  let mergedGroups = 0;

  for (const { uname } of groups) {
    const rows = await db.all(`SELECT * FROM profiles WHERE ${USERNAME_SQL} = ?`, [uname]);
    if (rows.length < 2) continue;

    // Каноническая запись: приоритет vote/dmSent, затем больше подписчиков, затем свежее
    rows.sort((a, b) => {
      const score = (p) =>
        (p.dmSent === 1 ? 1000 : 0) +
        (p.vote === 'like' ? 100 : 0) +
        (p.dm_status === 'replied' ? 50 : p.dm_status === 'liked' ? 25 : 0) +
        (p.followers_count || 0) / 1e6;
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return String(b.timestamp || '').localeCompare(String(a.timestamp || ''));
    });

    let canonical = rows[0];
    const duplicates = rows.slice(1);

    for (const dup of duplicates) {
      canonical = mergeProfileRecords(canonical, dup);
    }

    await db.run(
      `UPDATE profiles SET
        name = ?, username = ?, bio = ?, photo = ?, photo_local = ?, photo_cached_at = ?, photo_status = ?,
        followers_count = ?, publications_count = ?, posts_count = ?, donor = ?, vote = ?,
        tg_status = ?, dmSent = ?, tgTagged = ?, dmError = ?, dm_status = ?, isInCity = ?
      WHERE url = ?`,
      [
        canonical.name,
        canonical.username,
        canonical.bio,
        canonical.photo,
        canonical.photo_local,
        canonical.photo_cached_at,
        canonical.photo_status,
        canonical.followers_count,
        canonical.publications_count,
        canonical.posts_count,
        canonical.donor,
        canonical.vote,
        canonical.tg_status,
        canonical.dmSent,
        canonical.tgTagged,
        canonical.dmError,
        canonical.dm_status,
        canonical.isInCity,
        canonical.url,
      ]
    );

    for (const dup of duplicates) {
      await db.run(`INSERT OR IGNORE INTO urls (type, url) VALUES ('history', ?)`, [dup.url]);
      await db.run(`DELETE FROM profiles WHERE url = ?`, [dup.url]);
    }

    mergedGroups++;
  }

  return mergedGroups;
}

module.exports = {
  normalizeUsername,
  USERNAME_SQL,
  mergeDonors,
  mergeProfileRecords,
  findProfileByUsername,
  findProfilesByUsername,
  markDmSentByUsername,
  isUsernameDmSent,
  dedupeProfilesForMessaging,
  mergeDuplicateProfiles,
};
