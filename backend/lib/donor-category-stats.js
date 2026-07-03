'use strict';

function normalizeDonorUsernameFromUrl(url) {
  return String(url || '')
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/$/, '')
    .trim();
}

function normalizeKeyword(kw) {
  return String(kw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function deriveDonorKeyword(meta) {
  if (!meta || typeof meta === 'string') return '';
  if (meta.keyword) return String(meta.keyword).trim();
  const city = String(meta.city || '').trim();
  const niche = String(meta.niche || '').trim();
  return `${city} ${niche}`.trim();
}

function keywordCategoryId(keyword) {
  return `cat:kw:${encodeURIComponent(normalizeKeyword(keyword))}`;
}

async function getLikesByCategory(db) {
  const rows = await db.all(`
    SELECT
      COALESCE(
        NULLIF(TRIM(u.keyword), ''),
        NULLIF(TRIM(u.city || ' ' || u.niche), ''),
        '—'
      ) AS keyword,
      COUNT(DISTINCT u.url) AS donors_count,
      COUNT(p.url) AS profiles_total,
      SUM(CASE WHEN LOWER(TRIM(COALESCE(p.vote, ''))) = 'like' THEN 1 ELSE 0 END) AS likes_count,
      SUM(CASE WHEN LOWER(TRIM(COALESCE(p.vote, ''))) = 'dislike' THEN 1 ELSE 0 END) AS dislikes_count,
      SUM(CASE WHEN p.dmSent = 1 THEN 1 ELSE 0 END) AS dm_sent_count
    FROM urls u
    LEFT JOIN profiles p ON LOWER(TRIM(REPLACE(COALESCE(p.donor, ''), '@', ''))) = LOWER(
      TRIM(REPLACE(REPLACE(REPLACE(u.url, 'https://www.instagram.com/', ''), 'https://instagram.com/', ''), '/', ''))
    )
    WHERE u.type = 'donor'
    GROUP BY keyword
  `);

  return rows.map((r) => ({
    keyword: r.keyword,
    donors_count: r.donors_count || 0,
    profiles_total: r.profiles_total || 0,
    likes_count: r.likes_count || 0,
    dislikes_count: r.dislikes_count || 0,
    dm_sent_count: r.dm_sent_count || 0,
    like_rate: r.profiles_total > 0 ? Math.round((r.likes_count / r.profiles_total) * 100) : 0,
  }));
}

function findDonorMeta(donors, donorUsername) {
  const norm = String(donorUsername || '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
  if (!norm) return null;
  return (
    (donors || []).find((d) => {
      const url = typeof d === 'string' ? d : d.url;
      return normalizeDonorUsernameFromUrl(url) === norm;
    }) || null
  );
}

function findCategoryMessages(donorGroups, donors, donorUsername) {
  const meta = findDonorMeta(donors, donorUsername);
  if (!meta || typeof meta === 'string') return null;
  const kw = deriveDonorKeyword(meta);
  if (!kw) return null;
  const nk = normalizeKeyword(kw);

  const bundle = (donorGroups || []).find(
    (g) => g.type === 'bundle' && (g.keywords || []).some((k) => normalizeKeyword(k) === nk)
  );
  if (bundle?.messages?.length) return bundle.messages;

  const group = (donorGroups || []).find(
    (g) =>
      g.type === 'keyword' &&
      (g.id === keywordCategoryId(kw) || normalizeKeyword(g.keyword) === nk)
  );
  return group?.messages?.length ? group.messages : null;
}

module.exports = {
  normalizeDonorUsernameFromUrl,
  normalizeKeyword,
  deriveDonorKeyword,
  keywordCategoryId,
  getLikesByCategory,
  findDonorMeta,
  findCategoryMessages,
};
