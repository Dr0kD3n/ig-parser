import React, { memo, useState, useMemo, useCallback, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import {
  getKeywordCategories,
  getBundles,
  getCategoryMessagesByKeyword,
  mergeBundleStats,
  mergeKeywordStats,
  patchKeywordCategoryMessages,
  patchBundleMessages,
  mergeDiscoveredKeywords,
  addKeywordCategory,
  removeKeywordCategory,
  createBundle,
  removeBundle,
  countDonorsForKeyword,
  normalizeKeyword,
  sortCategoryStats,
  ensureDefaultDonorGroups,
  ALL_DONORS_KEY,
} from '../../utils/donorCategories';
import { useDialog } from '../../context/DialogContext';
import KeywordCategoriesTable from './KeywordCategoriesTable';
import DiscoveredKeywords from './DiscoveredKeywords';
import DonorsListEditor from './DonorsListEditor';

const DonorsSettingsSection = memo(function DonorsSettingsSection({
  settingsData,
  onSettingsChange,
  onDonorsRefresh,
  authFetch,
}) {
  const { prompt, confirm } = useDialog();
  const [statsRows, setStatsRows] = useState([]);
  const [sortKey, setSortKey] = useState('likes_count');
  const [sortDir, setSortDir] = useState('desc');
  const [selectedCategoryKey, setSelectedCategoryKey] = useState(null);
  const [checkedKeys, setCheckedKeys] = useState(() => new Set());

  const fetchStats = useCallback(async () => {
    try {
      const res = await authFetch('/api/stats/likes-by-category');
      const data = await res.json();
      if (data.success) setStatsRows(data.rows || []);
    } catch {
      /* ignore */
    }
  }, [authFetch]);

  useEffect(() => {
    fetchStats();
    onDonorsRefresh?.();
    const t = setInterval(() => {
      fetchStats();
      onDonorsRefresh?.();
    }, 5000);
    return () => clearInterval(t);
  }, [fetchStats, onDonorsRefresh]);

  const donorGroups = useMemo(
    () => ensureDefaultDonorGroups(settingsData.donorGroups),
    [settingsData.donorGroups]
  );

  const bundles = useMemo(() => {
    const built = getBundles(donorGroups);
    return mergeBundleStats(built, statsRows, settingsData.donors || []).map((b) => ({
      ...b,
      messages: donorGroups.find((g) => g.id === b.id)?.messages || b.messages || [],
    }));
  }, [donorGroups, statsRows, settingsData.donors]);

  const categories = useMemo(() => {
    const built = getKeywordCategories(donorGroups);
    return mergeKeywordStats(built, statsRows, settingsData.donors || []).map((cat) => ({
      ...cat,
      messages: donorGroups.find((g) => g.id === cat.id)?.messages || cat.messages || [],
    }));
  }, [donorGroups, statsRows, settingsData.donors]);

  const discoveredKeywords = useMemo(
    () => mergeDiscoveredKeywords(settingsData.donors || [], statsRows),
    [settingsData.donors, statsRows]
  );

  const categoryKeys = useMemo(() => {
    const keys = new Set(categories.map((c) => c.key));
    for (const b of bundles) {
      for (const kw of b.keywords || []) keys.add(normalizeKeyword(kw));
    }
    return keys;
  }, [categories, bundles]);

  const checkedCount = checkedKeys.size;

  const bundledKeys = useMemo(() => {
    const set = new Set();
    for (const b of bundles) {
      for (const kw of b.keywords || []) set.add(normalizeKeyword(kw));
    }
    return set;
  }, [bundles]);

  const keywordByKey = useMemo(() => {
    const map = new Map();
    for (const d of discoveredKeywords) map.set(d.key, d.keyword);
    for (const c of categories) map.set(c.key, c.keyword);
    return map;
  }, [categories, discoveredKeywords]);

  const allStats = useMemo(() => {
    const donors = settingsData.donors || [];
    const totals = (statsRows || []).reduce(
      (acc, r) => ({
        donors_count: acc.donors_count + (r.donors_count || 0),
        profiles_total: acc.profiles_total + (r.profiles_total || 0),
        likes_count: acc.likes_count + (r.likes_count || 0),
        dm_sent_count: acc.dm_sent_count + (r.dm_sent_count || 0),
      }),
      { donors_count: 0, profiles_total: 0, likes_count: 0, dm_sent_count: 0 }
    );
    return {
      ...totals,
      donors_count: Math.max(totals.donors_count, donors.length),
      like_rate:
        totals.profiles_total > 0
          ? Math.round((totals.likes_count / totals.profiles_total) * 100)
          : 0,
    };
  }, [statsRows, settingsData.donors]);

  const tableRows = useMemo(() => {
    const statsMap = new Map((statsRows || []).map((s) => [normalizeKeyword(s.keyword), s]));
    const donors = settingsData.donors || [];

    const bundleRows = bundles.map((b) => ({
      rowType: 'bundle',
      id: b.id,
      key: b.id,
      label: b.name,
      name: b.name,
      keywords: b.keywords,
      stats: b.stats,
      messages: b.messages || [],
      keywordItems: (b.keywords || []).map((kw) => {
        const nk = normalizeKeyword(kw);
        const fromApi = statsMap.get(nk);
        const disc = discoveredKeywords.find((d) => d.key === nk);
        const stats =
          fromApi ||
          {
            keyword: kw,
            donors_count: disc?.donors_count ?? countDonorsForKeyword(donors, kw),
            profiles_total: 0,
            likes_count: 0,
            dislikes_count: 0,
            dm_sent_count: 0,
            like_rate: 0,
          };
        return { keyword: kw, key: nk, stats };
      }),
      ...b.stats,
    }));

    const keywordRows = discoveredKeywords
      .filter((d) => !bundledKeys.has(d.key))
      .map((d) => {
        const fromApi = statsMap.get(d.key);
        const cat = categories.find((c) => c.key === d.key);
        const stats = fromApi ||
          cat?.stats || {
            keyword: d.keyword,
            donors_count: d.donors_count,
            profiles_total: 0,
            likes_count: 0,
            dislikes_count: 0,
            dm_sent_count: 0,
            like_rate: 0,
          };
        return {
          rowType: 'keyword',
          keyword: d.keyword,
          key: d.key,
          stats,
          messages: getCategoryMessagesByKeyword(donorGroups, d.keyword),
          ...stats,
        };
      });

    return sortCategoryStats([...bundleRows, ...keywordRows], sortKey, sortDir);
  }, [bundles, discoveredKeywords, bundledKeys, categories, statsRows, sortKey, sortDir, donorGroups, settingsData.donors]);

  const handleSort = useCallback((key) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return prev;
      }
      setSortDir('desc');
      return key;
    });
  }, []);

  const handleSelectKeyword = useCallback((keyword) => {
    const key = normalizeKeyword(keyword);
    setSelectedCategoryKey((prev) => (prev === key ? null : key));
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedCategoryKey((prev) => (prev === ALL_DONORS_KEY ? null : ALL_DONORS_KEY));
  }, []);

  const handleSelectBundle = useCallback((bundleId) => {
    setSelectedCategoryKey((prev) => (prev === bundleId ? null : bundleId));
  }, []);

  const handleToggleCheck = useCallback((key) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleKeywordChip = useCallback((keyword) => {
    setSelectedCategoryKey(normalizeKeyword(keyword));
  }, []);

  const donorsCount = (settingsData.donors || []).length;

  const allGroup = useMemo(
    () =>
      donorGroups.find((g) => g.id === 'all') || {
        id: 'all',
        type: 'all',
        name: 'Все доноры',
        messages: [],
      },
    [donorGroups]
  );

  const handleDonorsCommit = useCallback(
    (donors) => onSettingsChange({ donors }),
    [onSettingsChange]
  );

  const handleAllGroupUpdate = useCallback(
    (patch) => {
      onSettingsChange((prev) => ({
        donorGroups: ensureDefaultDonorGroups(prev.donorGroups).map((g) =>
          g.id === 'all' ? { ...g, ...patch } : g
        ),
      }));
    },
    [onSettingsChange]
  );

  const handleAllMessagesCommit = useCallback(
    (messages) => handleAllGroupUpdate({ messages }),
    [handleAllGroupUpdate]
  );

  const handleCategoryMessages = useCallback(
    (keyword, messages) => {
      onSettingsChange((prev) => ({
        donorGroups: patchKeywordCategoryMessages(prev.donorGroups, keyword, messages),
      }));
    },
    [onSettingsChange]
  );

  const handleBundleMessages = useCallback(
    (bundleId, messages) => {
      onSettingsChange((prev) => ({
        donorGroups: patchBundleMessages(prev.donorGroups, bundleId, messages),
      }));
    },
    [onSettingsChange]
  );

  const handleCreateBundle = useCallback(async () => {
    if (checkedKeys.size < 2) return;
    const keywords = [...checkedKeys].map((k) => keywordByKey.get(k)).filter(Boolean);
    if (keywords.length < 2) {
      toast.error('Выбери минимум 2 запроса');
      return;
    }
    const name = await prompt({
      title: 'Название блока сообщений',
      placeholder: keywords.join(' + '),
      defaultValue: keywords.slice(0, 2).join(' + '),
    });
    if (name === null) return;
    const bundleName = String(name).trim() || keywords.join(' + ');
    const preview = createBundle(donorGroups, bundleName, keywords);
    const created = preview.find(
      (g) =>
        g.type === 'bundle' &&
        (g.keywords || []).length === keywords.length &&
        keywords.every((kw) =>
          (g.keywords || []).some((k) => normalizeKeyword(k) === normalizeKeyword(kw))
        )
    );
    onSettingsChange((prev) => ({
      donorGroups: createBundle(prev.donorGroups, bundleName, keywords),
    }));
    setCheckedKeys(new Set());
    if (created?.id) setSelectedCategoryKey(created.id);
  }, [checkedKeys, keywordByKey, prompt, onSettingsChange, donorGroups]);

  const handleDeleteBundle = useCallback(
    async (bundleId) => {
      const bundle = bundles.find((b) => b.id === bundleId);
      const ok = await confirm({
        message: `Удалить блок «${bundle?.name || 'блок'}»? Категории вернутся в список.`,
        confirmText: 'Удалить',
        variant: 'danger',
      });
      if (!ok) return;
      onSettingsChange((prev) => ({
        donorGroups: removeBundle(prev.donorGroups, bundleId),
      }));
      if (selectedCategoryKey === bundleId) setSelectedCategoryKey(null);
    },
    [confirm, bundles, onSettingsChange, selectedCategoryKey]
  );

  const handleAddBundleManual = useCallback(async () => {
    const raw = await prompt({
      title: 'Запросы для блока',
      message: 'Введи через запятую или с новой строки',
      placeholder: 'Ростов модель, Rostov Косметолог',
    });
    if (raw === null || !String(raw).trim()) return;
    const keywords = [...new Set(String(raw).split(/[\n,]+/).map((s) => s.trim()).filter(Boolean))];
    if (keywords.length < 2) {
      toast.error('Нужно минимум 2 запроса');
      return;
    }
    const name = await prompt({
      title: 'Название блока',
      defaultValue: keywords.slice(0, 2).join(' + '),
    });
    if (name === null) return;
    const bundleName = String(name).trim() || keywords.join(' + ');
    const preview = createBundle(donorGroups, bundleName, keywords);
    const created = preview.find(
      (g) =>
        g.type === 'bundle' &&
        keywords.every((kw) =>
          (g.keywords || []).some((k) => normalizeKeyword(k) === normalizeKeyword(kw))
        )
    );
    onSettingsChange((prev) => ({
      donorGroups: createBundle(prev.donorGroups, bundleName, keywords),
    }));
    if (created?.id) setSelectedCategoryKey(created.id);
  }, [prompt, onSettingsChange, donorGroups]);

  const handleAddCategory = useCallback(async () => {
    const kw = await prompt({
      title: 'Поисковый запрос категории',
      placeholder: 'маникюр мск',
    });
    if (!kw?.trim()) return;
    const keyword = kw.trim();
    if (categoryKeys.has(normalizeKeyword(keyword))) {
      toast.error('Такая категория уже есть');
      handleSelectKeyword(keyword);
      return;
    }
    onSettingsChange((prev) => ({
      donorGroups: addKeywordCategory(prev.donorGroups, keyword),
    }));
    setSelectedCategoryKey(normalizeKeyword(keyword));
  }, [prompt, categoryKeys, onSettingsChange, handleSelectKeyword]);

  const handleDeleteCategory = useCallback(
    async (keyword) => {
      const ok = await confirm({
        message: `Удалить категорию «${keyword}»?`,
        confirmText: 'Удалить',
        variant: 'danger',
      });
      if (!ok) return;
      onSettingsChange((prev) => ({
        donorGroups: removeKeywordCategory(prev.donorGroups, keyword),
      }));
      if (selectedCategoryKey === normalizeKeyword(keyword)) {
        setSelectedCategoryKey(null);
      }
    },
    [confirm, onSettingsChange, selectedCategoryKey]
  );

  return (
    <div className="donor-groups-manager">
      <div className="donors-raw-list">
        <div className="flex-between mb-12">
          <h4 className="fs-16 color-accent m-0">📋 Общий список доноров</h4>
          <span className="count-badge">{donorsCount}</span>
        </div>
        <DonorsListEditor donors={settingsData.donors} onCommit={handleDonorsCommit} />
      </div>

      <div className="donors-workspace donors-workspace-single">
        <div className="donors-table-col">
          <KeywordCategoriesTable
            rows={tableRows}
            allStats={allStats}
            allGroup={allGroup}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            selectedKey={selectedCategoryKey}
            checkedKeys={checkedKeys}
            onToggleCheck={handleToggleCheck}
            onSelect={handleSelectKeyword}
            onSelectBundle={handleSelectBundle}
            onSelectAll={handleSelectAll}
            onAdd={handleAddCategory}
            onAddBundle={handleAddBundleManual}
            onCreateBundle={handleCreateBundle}
            checkedCount={checkedCount}
            onDelete={handleDeleteCategory}
            onDeleteBundle={handleDeleteBundle}
            onAllMessagesCommit={handleAllMessagesCommit}
            onCategoryMessagesCommit={handleCategoryMessages}
            onBundleMessagesCommit={handleBundleMessages}
          />
          <DiscoveredKeywords
            keywords={discoveredKeywords}
            bundledKeys={bundledKeys}
            checkedKeys={checkedKeys}
            onToggleCheck={handleToggleCheck}
            onSelect={handleKeywordChip}
          />
        </div>
      </div>
    </div>
  );
});

export default DonorsSettingsSection;
