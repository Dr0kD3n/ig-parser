import { normalizeDonorUrl, getDonorUsername } from './donor';

export const ALL_DONORS_KEY = '__all__';
export const ALL_DONORS_LABEL = 'Все доноры';

export function normalizeKeyword(kw) {
  return String(kw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Поисковый запрос, по которому нашли донора */
export function deriveDonorKeyword(donor) {
  if (!donor || typeof donor === 'string') return '';
  if (donor.keyword) return String(donor.keyword).trim();
  const city = String(donor.city || '').trim();
  const niche = String(donor.niche || '').trim();
  return `${city} ${niche}`.trim();
}

export function keywordCategoryId(keyword) {
  return `cat:kw:${encodeURIComponent(normalizeKeyword(keyword))}`;
}

export function createBundleId() {
  return `bundle:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function migrateDonorGroup(g) {
  if (!g) return null;
  if (g.id === 'all') {
    return { ...g, type: 'all', name: g.name || 'Все доноры', messages: g.messages || [] };
  }
  if (g.type === 'bundle' && Array.isArray(g.keywords)) {
    const keywords = g.keywords.map((k) => String(k).trim()).filter(Boolean);
    if (!keywords.length) return null;
    return {
      ...g,
      id: g.id || createBundleId(),
      type: 'bundle',
      name: g.name || keywords.join(' + '),
      keywords,
      messages: g.messages || [],
    };
  }
  if (g.type === 'keyword' && g.keyword) return { ...g, messages: g.messages || [] };
  if (g.type === 'category' || (g.city && g.niche)) {
    const keyword = `${String(g.city || '').trim()} ${String(g.niche || '').trim()}`.trim();
    if (!keyword) return null;
    return {
      id: keywordCategoryId(keyword),
      type: 'keyword',
      keyword,
      name: keyword,
      messages: g.messages || [],
    };
  }
  if (g.keyword) {
    return {
      ...g,
      type: 'keyword',
      id: g.id || keywordCategoryId(g.keyword),
      messages: g.messages || [],
    };
  }
  return null;
}

/** По умолчанию: «Все доноры» + блоки + одиночные категории */
export function ensureDefaultDonorGroups(groups) {
  const migrated = (Array.isArray(groups) ? groups : []).map(migrateDonorGroup).filter(Boolean);
  const bundles = migrated.filter((g) => g.type === 'bundle');
  const keywords = migrated.filter((g) => g.type === 'keyword');
  const all =
    migrated.find((g) => g.id === 'all') || {
      id: 'all',
      type: 'all',
      name: 'Все доноры',
      messages: [],
    };
  return [all, ...bundles, ...keywords];
}

export function getBundles(donorGroups) {
  return ensureDefaultDonorGroups(donorGroups).filter((g) => g.type === 'bundle');
}

export function getKeywordsInBundles(donorGroups) {
  const set = new Set();
  for (const b of getBundles(donorGroups)) {
    for (const kw of b.keywords || []) set.add(normalizeKeyword(kw));
  }
  return set;
}

export function findBundleForKeyword(donorGroups, keyword) {
  const nk = normalizeKeyword(keyword);
  return (
    getBundles(donorGroups).find((b) =>
      (b.keywords || []).some((k) => normalizeKeyword(k) === nk)
    ) || null
  );
}

export function getKeywordCategories(donorGroups) {
  const inBundle = getKeywordsInBundles(donorGroups);
  return ensureDefaultDonorGroups(donorGroups)
    .filter((g) => g.type === 'keyword' && g.keyword && !inBundle.has(normalizeKeyword(g.keyword)))
    .map((g) => ({
      ...g,
      key: normalizeKeyword(g.keyword),
    }));
}

export function countDonorsForKeyword(donors, keyword) {
  const nk = normalizeKeyword(keyword);
  return (donors || []).filter((d) => normalizeKeyword(deriveDonorKeyword(d)) === nk).length;
}

export function mergeKeywordStats(categories, statsRows = [], donors = []) {
  const statsMap = new Map((statsRows || []).map((s) => [normalizeKeyword(s.keyword), s]));
  return categories.map((cat) => {
    const nk = normalizeKeyword(cat.keyword);
    const fromApi = statsMap.get(nk);
    const donorsCount = fromApi?.donors_count ?? countDonorsForKeyword(donors, cat.keyword);
    return {
      ...cat,
      stats: fromApi || {
        keyword: cat.keyword,
        donors_count: donorsCount,
        profiles_total: 0,
        likes_count: 0,
        dislikes_count: 0,
        dm_sent_count: 0,
        like_rate: 0,
      },
    };
  });
}

export function mergeBundleStats(bundles, statsRows = [], donors = []) {
  const statsMap = new Map((statsRows || []).map((s) => [normalizeKeyword(s.keyword), s]));
  return (bundles || []).map((bundle) => {
    const stats = (bundle.keywords || []).reduce(
      (acc, kw) => {
        const nk = normalizeKeyword(kw);
        const fromApi = statsMap.get(nk);
        const dc = fromApi?.donors_count ?? countDonorsForKeyword(donors, kw);
        return {
          donors_count: acc.donors_count + dc,
          profiles_total: acc.profiles_total + (fromApi?.profiles_total || 0),
          likes_count: acc.likes_count + (fromApi?.likes_count || 0),
          dislikes_count: acc.dislikes_count + (fromApi?.dislikes_count || 0),
          dm_sent_count: acc.dm_sent_count + (fromApi?.dm_sent_count || 0),
        };
      },
      { donors_count: 0, profiles_total: 0, likes_count: 0, dislikes_count: 0, dm_sent_count: 0 }
    );
    return {
      ...bundle,
      key: bundle.id,
      stats: {
        ...stats,
        like_rate:
          stats.profiles_total > 0 ? Math.round((stats.likes_count / stats.profiles_total) * 100) : 0,
      },
    };
  });
}

export function mergeDiscoveredKeywords(donors = [], statsRows = []) {
  const map = new Map();
  for (const item of discoverKeywords(donors)) {
    map.set(item.key, item);
  }
  for (const row of statsRows || []) {
    const kw = String(row.keyword || '').trim();
    if (!kw || kw === '—') continue;
    const nk = normalizeKeyword(kw);
    const existing = map.get(nk);
    if (existing) {
      existing.donors_count = Math.max(existing.donors_count, row.donors_count || 0);
    } else {
      map.set(nk, { keyword: kw, key: nk, donors_count: row.donors_count || 0 });
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => b.donors_count - a.donors_count || a.keyword.localeCompare(b.keyword, 'ru')
  );
}

/** Уникальные поисковые запросы из доноров */
export function discoverKeywords(donors = []) {
  const map = new Map();
  for (const d of donors) {
    const kw = deriveDonorKeyword(d);
    if (!kw) continue;
    const nk = normalizeKeyword(kw);
    if (!map.has(nk)) map.set(nk, { keyword: kw, key: nk, donors_count: 0 });
    map.get(nk).donors_count++;
  }
  return Array.from(map.values()).sort(
    (a, b) => b.donors_count - a.donors_count || a.keyword.localeCompare(b.keyword, 'ru')
  );
}

export function findDonorMeta(donors, donorUsername) {
  const norm = String(donorUsername || '')
    .replace(/^@/, '')
    .trim()
    .toLowerCase();
  if (!norm) return null;
  return (donors || []).find((d) => normalizeDonorUrl(getDonorUsername(d)) === norm) || null;
}

export function getCategoryMessagesByKeyword(donorGroups, keyword) {
  const id = keywordCategoryId(keyword);
  const nk = normalizeKeyword(keyword);
  return (
    (donorGroups || []).find(
      (g) => g.id === id || (g.type === 'keyword' && normalizeKeyword(g.keyword) === nk)
    )?.messages || []
  );
}

/** Шаблоны: блок → категория → fallback «Все» */
export function resolveMessagesForDonor(donorGroups, donors, donorUsername) {
  const meta = findDonorMeta(donors, donorUsername);
  if (meta) {
    const kw = deriveDonorKeyword(meta);
    if (kw) {
      const bundle = findBundleForKeyword(donorGroups, kw);
      if (bundle?.messages?.length) return bundle.messages;
      const msgs = getCategoryMessagesByKeyword(donorGroups, kw);
      if (msgs.length > 0) return msgs;
    }
  }
  const allGroup = ensureDefaultDonorGroups(donorGroups).find((g) => g.id === 'all');
  return allGroup?.messages?.length ? allGroup.messages : [];
}

export function sortCategoryStats(rows, sortKey, direction = 'desc') {
  const mul = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let aVal = a[sortKey];
    let bVal = b[sortKey];
    if (sortKey === 'category') {
      aVal = a.label || a.keyword || a.stats?.keyword || '';
      bVal = b.label || b.keyword || b.stats?.keyword || '';
      return mul * String(aVal).localeCompare(String(bVal), 'ru');
    }
    aVal = Number(aVal ?? a.stats?.[sortKey]) || 0;
    bVal = Number(bVal ?? b.stats?.[sortKey]) || 0;
    if (aVal < bVal) return -1 * mul;
    if (aVal > bVal) return 1 * mul;
    return 0;
  });
}

export function patchKeywordCategoryMessages(donorGroups, keyword, messages) {
  const id = keywordCategoryId(keyword);
  const groups = ensureDefaultDonorGroups(donorGroups).filter(
    (g) => g.id === 'all' || g.type === 'keyword' || g.type === 'bundle'
  );
  const nk = normalizeKeyword(keyword);
  const idx = groups.findIndex((g) => g.id === id || normalizeKeyword(g.keyword) === nk);
  const entry = {
    id,
    type: 'keyword',
    keyword: String(keyword).trim(),
    name: String(keyword).trim(),
    messages,
  };
  if (idx >= 0) groups[idx] = { ...groups[idx], ...entry };
  else groups.push(entry);
  return groups;
}

export function addKeywordCategory(donorGroups, keyword) {
  const kw = String(keyword || '').trim();
  if (!kw) return ensureDefaultDonorGroups(donorGroups);
  const norm = normalizeKeyword(kw);
  const groups = ensureDefaultDonorGroups(donorGroups);
  if (groups.some((g) => g.type === 'keyword' && normalizeKeyword(g.keyword) === norm)) return groups;
  return [
    ...groups,
    { id: keywordCategoryId(kw), type: 'keyword', keyword: kw, name: kw, messages: [] },
  ];
}

export function removeKeywordCategory(donorGroups, keyword) {
  const norm = normalizeKeyword(keyword);
  return ensureDefaultDonorGroups(donorGroups)
    .map((g) => {
      if (g.type !== 'bundle') return g;
      const keywords = (g.keywords || []).filter((k) => normalizeKeyword(k) !== norm);
      return keywords.length ? { ...g, keywords } : null;
    })
    .filter(Boolean)
    .filter((g) => g.id === 'all' || g.type === 'bundle' || normalizeKeyword(g.keyword) !== norm);
}

export function createBundle(donorGroups, name, keywords) {
  const kws = [...new Set(keywords.map((k) => String(k).trim()).filter(Boolean))];
  if (kws.length < 2) return ensureDefaultDonorGroups(donorGroups);
  const inBundle = new Set(kws.map(normalizeKeyword));
  const groups = ensureDefaultDonorGroups(donorGroups).filter((g) => {
    if (g.type !== 'keyword') return true;
    return !inBundle.has(normalizeKeyword(g.keyword));
  });
  groups.push({
    id: createBundleId(),
    type: 'bundle',
    name: String(name || '').trim() || kws.join(' + '),
    keywords: kws,
    messages: [],
  });
  return groups;
}

export function removeBundle(donorGroups, bundleId) {
  const groups = ensureDefaultDonorGroups(donorGroups);
  const bundle = groups.find((g) => g.id === bundleId);
  if (!bundle) return groups;
  const rest = groups.filter((g) => g.id !== bundleId);
  for (const kw of bundle.keywords || []) {
    const nk = normalizeKeyword(kw);
    const exists = rest.some(
      (g) =>
        (g.type === 'keyword' && normalizeKeyword(g.keyword) === nk) ||
        (g.type === 'bundle' && (g.keywords || []).some((k) => normalizeKeyword(k) === nk))
    );
    if (!exists) {
      rest.push({
        id: keywordCategoryId(kw),
        type: 'keyword',
        keyword: kw,
        name: kw,
        messages: [],
      });
    }
  }
  return rest;
}

export function patchBundleMessages(donorGroups, bundleId, messages) {
  return ensureDefaultDonorGroups(donorGroups).map((g) =>
    g.id === bundleId ? { ...g, messages } : g
  );
}
