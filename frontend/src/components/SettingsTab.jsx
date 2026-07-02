import React, { useState, memo, useMemo, useCallback, useEffect, useRef, startTransition } from 'react';
import { EditIcon, TrashIcon } from './Icons';
import { toast } from 'react-hot-toast';
const SkeletonSettings = memo(function SkeletonSettings() {
  return (
    <div className="settings-wrap tab-content-fade">
      <div className="settings-header">
        <div className="skeleton" style={{ width: 400, height: 40, borderRadius: 12 }} />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: '32px',
          padding: '0 32px',
        }}
      >
        <div>
          <div className="skeleton-item skeleton h-200" />
          <div className="skeleton-item skeleton h-200" />
        </div>
        <div>
          <div className="skeleton-item skeleton h-400" />
        </div>
      </div>
    </div>
  );
});

const plural = (n, one, two, many) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return two;
  return many;
};

const CITIES_PRESETS = [
  { name: 'Москва', value: 'Москва\nMoscow\nМСК\nMsk' },
  { name: 'Санкт-Петербург', value: 'Санкт-Петербург\nСанкт\nSaint\nСПб\nSpb' },
  { name: 'Новосибирск', value: 'Новосибирск\nNovosibirsk\nНск\nNsk' },
  { name: 'Екатеринбург', value: 'Екатеринбург\nYekaterinburg\nЕкб\nEkb' },
  { name: 'Казань', value: 'Казань\nKazan\nКЗН\nKzn' },
  { name: 'Нижний Новгород', value: 'Нижний Новгород\nNizhny Novgorod' },
  { name: 'Челябинск', value: 'Челябинск\nChelyabinsk' },
  { name: 'Красноярск', value: 'Красноярск\nKrasnoyarsk' },
  { name: 'Самара', value: 'Самара\nSamara' },
  { name: 'Уфа', value: 'Уфа\nUfa' },
  { name: 'Ростов-на-Дону', value: 'Ростов-на-Дону\nRostov-on-Don\nРостов\nRostov' },
  { name: 'Омск', value: 'Омск\nOmsk' },
  { name: 'Краснодар', value: 'Краснодар\nKrasnodar' },
  { name: 'Воронеж', value: 'Воронеж\nVoronezh' },
  { name: 'Таганрог', value: 'Таганрог\nНиколаевка' },
  { name: 'Пермь', value: 'Пермь' },
  { name: 'Волгоград', value: 'Волгоград\nVolgograd' },
  { name: 'Саратов', value: 'Саратов\nSaratov' },
  { name: 'Тюмень', value: 'Тюмень\nTyumen' },
  { name: 'Тольятти', value: 'Тольятти\nTolyatti' },
  { name: 'Ижевск', value: 'Ижевск\nIzhevsk' },
  { name: 'Барнаул', value: 'Барнаул\nBarnaul' },
  { name: 'Иркутск', value: 'Иркутск\nIrkutsk' },
  { name: 'Хабаровск', value: 'Хабаровск\nKhabarovsk' },
  { name: 'Владивосток', value: 'Владивосток\nVladivostok' }
];

const normalizeDonorUrl = (u) =>
  String(u || '')
    .toLowerCase()
    .replace(/https?:\/\/(www\.)?instagram\.com\//, '')
    .replace(/[@/]/g, '')
    .trim();

const DONOR_PICKER_LIMIT = 60;

// Поиск + лимит DOM-узлов вместо сотен кнопок
const DonorPicker = memo(function DonorPicker({ allDonors, selectedSet, checkedDonorsSet, onToggle }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = allDonors || [];
    if (q) {
      list = list.filter((d) => {
        const url = typeof d === 'string' ? d : d.url;
        return url.toLowerCase().includes(q) || normalizeDonorUrl(url).includes(q);
      });
    }
    return list.slice(0, DONOR_PICKER_LIMIT);
  }, [allDonors, query]);

  const total = (allDonors || []).length;
  const hidden = Math.max(0, total - filtered.length);

  return (
    <div className="donors-selector mb-12">
      <input
        type="text"
        className="search-input w-full mb-8 fs-12"
        placeholder={`Поиск донора (${total})...`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="flex-wrap gap-6 max-h-120 scroll-y p-8 bg-black-20 rounded-8">
        {filtered.map((d) => {
          const url = typeof d === 'string' ? d : d.url;
          const isSelected = selectedSet.has(url);
          const isProcessed = checkedDonorsSet.has(normalizeDonorUrl(url));
          const niche = d.niche;
          const city = d.city;

          return (
            <button
              key={url}
              type="button"
              className={`acc-task-tag ${isSelected ? 'active' : 'inactive'} ${isProcessed ? 'donor-processed' : ''}`}
              onClick={() => onToggle(url, d, isSelected)}
              title={isProcessed ? 'Отработан' : ''}
            >
              @{url.replace('https://www.instagram.com/', '').replace('/', '')}
              {(niche || city) && (
                <span className="donor-keyword">({[niche, city].filter(Boolean).join(', ')})</span>
              )}
            </button>
          );
        })}
        {total === 0 && <div className="fs-12 color-dim">Нет доноров в списке</div>}
        {hidden > 0 && (
          <div className="fs-11 color-dim w-full">+ ещё {hidden} — уточни поиск</div>
        )}
      </div>
    </div>
  );
});

// Debounced textarea для списка доноров (без visual-layer)
const DonorsListEditor = memo(function DonorsListEditor({ donors, onCommit }) {
  const serialized = useMemo(
    () => (donors || []).map((d) => (typeof d === 'string' ? d : d.url)).join('\n'),
    [donors]
  );
  const [draft, setDraft] = useState(serialized);
  const lastCommitted = useRef(serialized);
  const timerRef = useRef(null);
  const donorsRef = useRef(donors);

  useEffect(() => {
    donorsRef.current = donors;
  }, [donors]);

  useEffect(() => {
    if (serialized !== lastCommitted.current) {
      setDraft(serialized);
      lastCommitted.current = serialized;
    }
  }, [serialized]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const commit = useCallback(
    (text) => {
      lastCommitted.current = text;
      const lines = text.split('\n');
      const updated = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        const existing = (donorsRef.current || []).find(
          (ed) => (typeof ed === 'string' ? ed : ed.url) === trimmed
        );
        return existing || line;
      });
      onCommit(updated);
    },
    [onCommit]
  );

  const handleChange = (e) => {
    const val = e.target.value;
    setDraft(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(val), 400);
  };

  return (
    <textarea
      className="msg-textarea"
      style={{ height: 180 }}
      value={draft}
      onChange={handleChange}
      onBlur={() => {
        clearTimeout(timerRef.current);
        commit(draft);
      }}
      placeholder={'https://www.instagram.com/username/\nhttps://www.instagram.com/username2/'}
    />
  );
});

const DonorsSettingsSection = memo(function DonorsSettingsSection({
  settingsData,
  onSettingsChange,
  scrapedDonors,
  tr,
  TrashIcon,
}) {
  const checkedDonorsSet = useMemo(() => {
    const set = new Set();
    for (const cd of settingsData.checkedDonors || []) {
      set.add(normalizeDonorUrl(cd));
    }
    return set;
  }, [settingsData.checkedDonors]);

  const allDonorUrls = useMemo(
    () => (scrapedDonors || []).map((u) => `https://www.instagram.com/${u}/`),
    [scrapedDonors]
  );

  const handleDonorGroupUpdate = useCallback(
    (groupId, patch) => {
      onSettingsChange((prev) => {
        const groups = prev.donorGroups || [];
        const exists = groups.some((g) => g.id === groupId);
        let newGroups;
        if (exists) {
          newGroups = groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g));
        } else if (groupId === 'all') {
          newGroups = [{ id: 'all', name: tr('all_other_donors'), donors: [], messages: [], ...patch }, ...groups];
        } else {
          newGroups = groups;
        }
        return { donorGroups: newGroups };
      });
    },
    [onSettingsChange, tr]
  );

  const allGroup = useMemo(
    () =>
      (settingsData.donorGroups || []).find((g) => g.id === 'all') || {
        id: 'all',
        name: tr('all_other_donors'),
        donors: [],
        messages: [],
      },
    [settingsData.donorGroups, tr]
  );

  const otherDonorGroups = useMemo(
    () => (settingsData.donorGroups || []).filter((g) => g.id !== 'all'),
    [settingsData.donorGroups]
  );

  const handleDonorsCommit = useCallback(
    (donors) => onSettingsChange({ donors }),
    [onSettingsChange]
  );

  return (
    <div className="donor-groups-manager">
      <div className="donors-raw-list mb-24">
        <h4 className="mb-12 fs-16 color-accent">📋 {tr('tab_donors')} (Общий список)</h4>
        <DonorsListEditor donors={settingsData.donors} onCommit={handleDonorsCommit} />
      </div>

      <div className="groups-header flex-between mb-20">
        <h4 className="fs-18 font-bold">🧩 {tr('donor_groups')}</h4>
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => {
            const name = prompt(tr('add_group') + ':');
            if (!name) return;
            onSettingsChange({
              donorGroups: [
                ...(settingsData.donorGroups || []),
                { id: Date.now().toString(), name, donors: [], messages: [] },
              ],
            });
          }}
        >
          + {tr('add_group')}
        </button>
      </div>

      <div className="donor-groups-list flex-v gap-24">
        <DonorGroupCard
          group={allGroup}
          allDonors={allDonorUrls}
          onUpdate={handleDonorGroupUpdate}
          onDelete={() => {}}
          isAll={true}
          tr={tr}
          TrashIcon={TrashIcon}
          checkedDonorsSet={checkedDonorsSet}
        />
        {otherDonorGroups.map((group) => (
          <DonorGroupCard
            key={group.id}
            group={group}
            allDonors={allDonorUrls}
            onUpdate={handleDonorGroupUpdate}
            onDelete={() => {
              if (!confirm('Удалить эту группу?')) return;
              onSettingsChange({
                donorGroups: (settingsData.donorGroups || []).filter((g) => g.id !== group.id),
              });
            }}
            tr={tr}
            TrashIcon={TrashIcon}
            checkedDonorsSet={checkedDonorsSet}
          />
        ))}
      </div>
    </div>
  );
});

// Локальный draft — не поднимаем каждый символ в App
const DebouncedLinesTextarea = memo(function DebouncedLinesTextarea({
  lines,
  onCommit,
  debounceMs = 400,
  className,
  style,
  placeholder,
}) {
  const serialized = (lines || []).join('\n');
  const [draft, setDraft] = useState(serialized);
  const lastCommitted = useRef(serialized);
  const timerRef = useRef(null);

  useEffect(() => {
    if (serialized !== lastCommitted.current) {
      setDraft(serialized);
      lastCommitted.current = serialized;
    }
  }, [serialized]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const commit = useCallback(
    (text) => {
      lastCommitted.current = text;
      onCommit(text.split('\n'));
    },
    [onCommit]
  );

  const handleChange = (e) => {
    const val = e.target.value;
    setDraft(val);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(val), debounceMs);
  };

  const handleBlur = () => {
    clearTimeout(timerRef.current);
    commit(draft);
  };

  return (
    <textarea
      className={className}
      style={style}
      value={draft}
      onChange={handleChange}
      onBlur={handleBlur}
      placeholder={placeholder}
    />
  );
});

const DonorGroupCard = memo(function DonorGroupCard({
  group,
  allDonors,
  onUpdate,
  onDelete,
  isAll,
  tr,
  TrashIcon,
  checkedDonorsSet,
}) {
  const handleMessagesCommit = useCallback(
    (messages) => onUpdate(group.id, { messages }),
    [group.id, onUpdate]
  );

  const selectedSet = useMemo(
    () => new Set((group.donors || []).map((d) => (typeof d === 'string' ? d : d.url))),
    [group.donors]
  );

  const handleDonorToggle = useCallback(
    (url, d, isSelected) => {
      const newDonors = isSelected
        ? (group.donors || []).filter((u) => (typeof u === 'string' ? u : u.url) !== url)
        : [...(group.donors || []), d];
      onUpdate(group.id, { donors: newDonors });
    },
    [group.donors, group.id, onUpdate]
  );

  return (
    <div className={`donor-group-card ${isAll ? 'all-group' : ''}`}>
      <div className="flex-between mb-12">nБрн
        <div className="flex align-center gap-10 m-0">
          {isAll ? (
            <h5 className="fs-16 font-bold m-0">
              {isAll ? 'Все' : (group.donors || []).length}{' '}
              {isAll ? 'доноры' : plural((group.donors || []).length, 'донор', 'донора', 'доноров')}

            </h5>
          ) : (
            <input
              className="group-name-input"
              value={group.name}
              onChange={(e) => onUpdate(group.id, { name: e.target.value })}
              placeholder="Название группы"
            />
          )}
          <h5 className="count-badge fs-16 font-bold m-0">
          </h5>
        </div>
        <div className="flex gap-8">
          {!isAll && (
            <button className="btn-primary btn-danger btn-xs" onClick={onDelete}>
              <TrashIcon />
            </button>
          )}
        </div>
      </div>

      {!isAll && (
        <DonorPicker
          allDonors={allDonors}
          selectedSet={selectedSet}
          checkedDonorsSet={checkedDonorsSet}
          onToggle={handleDonorToggle}
        />
      )}

      <div className="group-messages">
        <label className="fs-12 mb-4 block color-muted">{tr('modal_templates_title')}:</label>
        <DebouncedLinesTextarea
          className="msg-textarea h-100 fs-13"
          lines={group.messages}
          onCommit={handleMessagesCommit}
          placeholder={tr('one_msg_per_line')}
        />
      </div>
    </div>
  );
});

export default function SettingsTab({
  settingsData,
  onSettingsChange,
  tr,
  isLoading,
  authFetch,
  failedUrls,
  scrapedDonors,
}) {
  const [settingsTab, setSettingsTab] = useState(() => localStorage.getItem('ig_settings_tab') || 'accounts');
  const [donorsMounted, setDonorsMounted] = useState(
    () => localStorage.getItem('ig_settings_tab') === 'donors'
  );
  const [donorsReady, setDonorsReady] = useState(false);

  const handleSettingsTabChange = (tab) => {
    if (tab === 'donors') setDonorsMounted(true);
    startTransition(() => setSettingsTab(tab));
    localStorage.setItem('ig_settings_tab', tab);
  };

  useEffect(() => {
    if (!donorsMounted || settingsTab !== 'donors') return;
    if (donorsReady) return;
    let cancelled = false;
    const mount = () => {
      if (!cancelled) setDonorsReady(true);
    };
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(mount, { timeout: 250 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    const id = setTimeout(mount, 16);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [donorsMounted, settingsTab, donorsReady]);
  const [draggedItem, setDraggedItem] = useState(null);
  const [editingAccount, setEditingAccount] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    proxy: '',
    cookies: '',
    userAgent: '',
    fingerprint: '',
  });

  const setAccounts = (accounts) => onSettingsChange({ ...settingsData, accounts });
  const handleAdd = () => {
    const nameEl = document.getElementById('new-acc-name');
    const proxyEl = document.getElementById('new-acc-proxy');
    const cookiesEl = document.getElementById('new-acc-cookies');
    const name = nameEl.value.trim();
    const cookies = cookiesEl.value.trim();
    if (!name) {
      toast.error(tr('name_placeholder'));
      return;
    }
    setAccounts([
      ...settingsData.accounts,
      { id: Date.now().toString(), name, proxy: proxyEl.value.trim(), cookies },
    ]);
    nameEl.value = '';
    proxyEl.value = '';
    cookiesEl.value = '';
  };
  const handleDelete = (id) => {
    const newAccs = settingsData.accounts.filter((a) => a.id !== id);
    const updateArr = (field) => {
      const arr = settingsData[field];
      if (Array.isArray(arr)) {
        return arr.filter((aid) => aid !== id);
      }
      return arr;
    };
    onSettingsChange({
      ...settingsData,
      accounts: newAccs,
      activeParserAccountIds: updateArr('activeParserAccountIds'),
      activeServerAccountIds: updateArr('activeServerAccountIds'),
      activeIndexAccountIds: updateArr('activeIndexAccountIds'),
      activeProfilesAccountIds: updateArr('activeProfilesAccountIds'),
    });
  };
  const toggleAccountForTask = (field, id) => {
    const arr = settingsData[field] || [];
    const newArr = arr.includes(id) ? arr.filter((aid) => aid !== id) : [...arr, id];
    onSettingsChange({ ...settingsData, [field]: newArr });
  };
  const handleStartEdit = (acc) => {
    setEditingAccount(acc.id);
    let fp = {};
    try {
      fp = JSON.parse(acc.fingerprint || '{}');
    } catch (e) { }
    setEditForm({
      name: acc.name,
      proxy: acc.proxy || '',
      cookies: acc.cookies || '',
      userAgent: fp.userAgent || '',
      fingerprint: acc.fingerprint || '{}',
    });
  };
  const handleSaveEdit = async (id) => {
    try {
      // Prepare data, only include cookies if they were changed
      const data = { ...editForm };
      if (!data.cookies) delete data.cookies;

      // Sync userAgent back into fingerprint JSON if it was edited
      try {
        let fp = JSON.parse(data.fingerprint || '{}');
        if (data.userAgent !== fp.userAgent) {
          fp.userAgent = data.userAgent;
          data.fingerprint = JSON.stringify(fp);
        }
      } catch (e) { }

      await authFetch(`/api/accounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      // Update local state
      const updatedAccounts = settingsData.accounts.map((a) =>
        a.id === id ? { ...a, ...data, fingerprint: data.fingerprint } : a
      );
      onSettingsChange({ ...settingsData, accounts: updatedAccounts });
      setEditingAccount(null);
      toast.success(tr('save_success') || 'Account updated');
    } catch (e) {
      console.error('Error saving account:', e);
      toast.error('Error saving: ' + e.message);
    }
  };
  const handleLogin = async (id) => {
    try {
      const res = await authFetch(`/api/accounts/${id}/authorize/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success) toast.success(tr('login_success'));
      else toast.error(data.error);
    } catch (e) {
      toast.error(e.message);
    }
  };
  const handleOpenBrowser = async (id, forceRestore = false) => {
    try {
      const url = `/api/accounts/${id}/browser/start${forceRestore ? '?restore=true' : ''}`;
      const res = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ failedUrls }),
      });
      const data = await res.json();
      if (data.success)
        toast.success(
          forceRestore
            ? tr('browser_restore_success') || 'Browser opened with auto-photo-load'
            : tr('browser_success')
        );
      else toast.error(data.error);
    } catch (e) {
      toast.error(e.message);
    }
  };
  const handleWarmup = async (id) => {
    try {
      const res = await authFetch(`/api/accounts/${id}/warmup`, { method: 'POST' });
      const data = await res.json();
      if (data.success) toast.success(tr('warmup_started'));
      else toast.error(data.error);
    } catch (e) {
      toast.error(e.message);
    }
  };
  const handleInstagramCooldown = async (id) => {
    try {
      const res = await authFetch(`/api/accounts/${id}/instagram-cooldown`, { method: 'POST' });
      const data = await res.json();
      if (data.success) toast.success(tr('instagram_cooldown_started'));
      else toast.error(data.error);
    } catch (e) {
      toast.error(e.message);
    }
  };
  const onDragStart = (e, index, field) => {
    setDraggedItem({ index, field });
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e, index, field) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.field !== field) return;
    if (draggedItem.index === index) return;
    const arr = [...settingsData[field]];
    const item = arr.splice(draggedItem.index, 1)[0];
    arr.splice(index, 0, item);
    onSettingsChange({ ...settingsData, [field]: arr });
    setDraggedItem({ ...draggedItem, index });
  };
  const renderTaskSection = (field, label) => {
    const activeIds = settingsData[field] || [];
    const activeAccounts = activeIds
      .map((id) => settingsData.accounts.find((a) => a.id === id))
      .filter((a) => !!a);
    return (
      <div className="task-section-card">
        <h4 className="task-section-title">{label}</h4>
        <div className="flex-v gap-8">
          {activeAccounts.length === 0 && (
            <div className="no-accs-placeholder">{tr('no_accounts_selected')}</div>
          )}
          {activeAccounts.map((acc, idx) => (
            <div
              key={acc.id}
              draggable
              onDragStart={(e) => onDragStart(e, idx, field)}
              onDragOver={(e) => onDragOver(e, idx, field)}
              className="active-acc-item"
              onMouseEnter={(e) => e.currentTarget.classList.add('border-primary')}
              onMouseLeave={(e) => e.currentTarget.classList.remove('border-primary')}
            >
              <span className="drag-handle">☰</span>
              <span className="acc-name-label">{acc.name}</span>
              <button
                onClick={() => toggleAccountForTask(field, acc.id)}
                className="acc-remove-btn"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  };
  if (isLoading) return <SkeletonSettings />;
  return (
    <div className="settings-wrap tab-content-fade">
      <div className="settings-header">
        <div className="settings-nested-tabs">
          {['accounts', 'names', 'cities', 'blacklist', 'niches', 'donors'].map((tab) => (
            <button
              key={tab}
              className={`tab-btn${settingsTab === tab ? ' active' : ''}`}
              onClick={() => handleSettingsTabChange(tab)}
            >
              {tr(`tab_${tab}`)}
            </button>
          ))}
        </div>
        <div className="header-right gap-20">
          <label className="checkbox-label checkbox">
            <input
              type="checkbox"
              checked={settingsData.humanEmulation || false}
              onChange={(e) =>
                onSettingsChange({ ...settingsData, humanEmulation: e.target.checked })
              }
            />
            {tr('human_emulation')}
          </label>
          <label className="checkbox-label checkbox">
            <input
              type="checkbox"
              checked={settingsData.showBrowser || false}
              onChange={(e) => onSettingsChange({ ...settingsData, showBrowser: e.target.checked })}
            />
            {tr('show_browser')}
          </label>
          <label className="checkbox-label">
            {tr('concurrent_profiles')}
            <input
              type="number"
              min="1"
              max="20"
              value={settingsData.concurrentProfiles || 3}
              className="num-input-sm"
              onChange={(e) =>
                onSettingsChange({
                  ...settingsData,
                  concurrentProfiles: parseInt(e.target.value) || 1,
                })
              }
            />
          </label>
          <label className="checkbox-label">
            {tr('dm_limit')}
            <input
              type="number"
              min="1"
              value={settingsData.dmLimit || 200}
              className="num-input-sm"
              style={{ width: '60px' }}
              onChange={(e) =>
                onSettingsChange({
                  ...settingsData,
                  dmLimit: parseInt(e.target.value) || 1,
                })
              }
            />
          </label>
        </div>
      </div>

      {
        settingsTab === 'accounts' && (
          <div className="settings-grid">
            <div className="tasks-columns">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                {renderTaskSection('activeParserAccountIds', tr('task_parser'))}
                {renderTaskSection('activeIndexAccountIds', tr('task_scraper'))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                {renderTaskSection('activeServerAccountIds', tr('task_sender'))}
                {renderTaskSection('activeProfilesAccountIds', tr('task_profiles'))}
              </div>
              <div className="add-acc-card">
                <h4 className="mb-20 fs-18">{tr('add_account')}</h4>
                <div className="flex gap-16 mb-16">
                  <input
                    type="text"
                    id="new-acc-name"
                    placeholder={tr('name_placeholder')}
                    className="search-input w-full"
                  />
                  <input
                    type="text"
                    id="new-acc-proxy"
                    placeholder={tr('proxy_placeholder')}
                    className="search-input w-full"
                  />
                </div>
                <textarea
                  id="new-acc-cookies"
                  placeholder={tr('cookies_placeholder')}
                  className="msg-textarea cookies h-100 mb-20"
                />
                <button className="btn-primary w-full" onClick={handleAdd}>
                  {tr('btn_add')}
                </button>
              </div>
            </div>

            <div className="all-accounts-column">
              <h4 style={{ marginBottom: '20px', fontSize: '18px' }}>{tr('all_accounts')}</h4>
              <div className="flex-v gap-12">
                {settingsData.accounts.map((acc) => (
                  <div key={acc.id} className="account-card">
                    {editingAccount === acc.id ? (
                      <div className="flex-v gap-10">
                        <input
                          type="text"
                          className="search-input"
                          placeholder={tr('edit_name')}
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        />
                        <input
                          type="text"
                          className="search-input fs-13 font-mono"
                          placeholder={tr('edit_proxy')}
                          value={editForm.proxy}
                          onChange={(e) => setEditForm({ ...editForm, proxy: e.target.value })}
                        />
                        <input
                          type="text"
                          className="search-input fs-12 font-mono"
                          placeholder="User-Agent"
                          value={editForm.userAgent}
                          onChange={(e) => setEditForm({ ...editForm, userAgent: e.target.value })}
                        />
                        <textarea
                          className="msg-textarea cookies h-80 fs-11 font-mono"
                          placeholder="System Data (Fingerprint JSON)"
                          value={editForm.fingerprint}
                          onChange={(e) => setEditForm({ ...editForm, fingerprint: e.target.value })}
                        />
                        <textarea
                          className="msg-textarea cookies h-60 fs-12 font-mono"
                          placeholder={tr('edit_cookies')}
                          value={editForm.cookies}
                          onChange={(e) => setEditForm({ ...editForm, cookies: e.target.value })}
                        />
                        <div className="flex gap-8">
                          <button
                            className="btn-primary btn-outline btn-sm flex-1 fs-11"
                            onClick={async () => {
                              if (window.confirm('Regenerate System Data?')) {
                                try {
                                  const res = await authFetch(`/api/accounts/${acc.id}`, {
                                    method: 'PUT',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ regenerateFingerprint: true }),
                                  });
                                  const data = await res.json();
                                  if (data.success && data.fingerprint) {
                                    toast.success(tr('regenerate_success'));
                                    let fp = {};
                                    try {
                                      fp = JSON.parse(data.fingerprint);
                                    } catch (e) { }
                                    setEditForm((prev) => ({
                                      ...prev,
                                      fingerprint: data.fingerprint,
                                      userAgent: fp.userAgent || prev.userAgent,
                                    }));
                                    // Sync global state
                                    const updatedAccs = settingsData.accounts.map((a) =>
                                      a.id === acc.id ? { ...a, fingerprint: data.fingerprint } : a
                                    );
                                    onSettingsChange({ ...settingsData, accounts: updatedAccs });
                                  }
                                } catch (e) {
                                  toast.error(e.message);
                                }
                              }
                            }}
                          >
                            🔄 {tr('regenerate_system_data') || 'Regenerate System Data'}
                          </button>
                        </div>
                        <div className="flex gap-8">
                          <button
                            className="btn-primary btn-success btn-sm flex-1"
                            onClick={() => handleSaveEdit(acc.id)}
                          >
                            {tr('save_changes')}
                          </button>
                          <button
                            className="btn-primary btn-outline btn-sm btn-ghost flex-1 color-muted"
                            onClick={() => setEditingAccount(null)}
                          >
                            {tr('cancel')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-between mb-4">
                          <div className="flex-1 flex-baseline gap-8">
                            <div className="font-bold fs-15">{acc.name}</div>
                            {acc.warmup_running && (
                              <div className="acc-card-score running">
                                {acc.warmup_progress || 0}%
                              </div>
                            ) || (acc.warmup_score > 0 && (
                              <div className="acc-card-score">{acc.warmup_score}%</div>
                            ))}
                          </div>

                          <button
                            className="editBtn"
                            onClick={() => handleStartEdit(acc)}
                            title={tr('edit_title')}
                          >
                            <EditIcon />
                          </button>
                          <button
                            className="deleteBtn"
                            onClick={() => handleDelete(acc.id)}
                            title={tr('delete_title')}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                        <div className="acc-proxy-text">{acc.proxy || tr('direct_connection')}</div>
                        <div className="flex-between align-end">
                          <div className="flex-wrap gap-6 flex-1">
                            {[
                              { field: 'activeParserAccountIds', label: tr('task_parser') },
                              { field: 'activeIndexAccountIds', label: tr('task_scraper') },
                              { field: 'activeServerAccountIds', label: tr('task_sender') },
                              { field: 'activeProfilesAccountIds', label: tr('task_profiles') },
                              { field: 'activeCheckerAccountIds', label: tr('task_checker') },
                            ].map((t) => {
                              const isActive = (settingsData[t.field] || []).includes(acc.id);
                              return (
                                <button
                                  key={t.field}
                                  onClick={() => toggleAccountForTask(t.field, acc.id)}
                                  className={`acc-task-tag ${isActive ? 'active' : 'inactive'}`}
                                >
                                  {t.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        <div className="acc-action-bar">
                          <button
                            onClick={() => handleLogin(acc.id)}
                            className="btn-acc-action btn-acc-login"
                          >
                            {tr('btn_login')}
                          </button>
                          <button
                            onClick={() => handleOpenBrowser(acc.id, true)}
                            className="btn-acc-action btn-acc-browser"
                          >
                            {tr('btn_open_browser')}
                          </button>
                          <button
                            onClick={() => handleWarmup(acc.id)}
                            className="btn-acc-action btn-acc-warmup"
                          >
                            {tr('btn_warmup')}
                          </button>
                          <button
                            onClick={() => handleInstagramCooldown(acc.id)}
                            className="btn-acc-action btn-acc-warmup"
                          >
                            {tr('btn_instagram_cooldown')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      }

      {
        settingsTab === 'names' && (
          <textarea
            className="msg-textarea"
            style={{ height: 500 }}
            value={(settingsData.names || []).join('\n')}
            onChange={(e) => onSettingsChange({ ...settingsData, names: e.target.value.split('\n') })}
          />
        )
      }
      {
        settingsTab === 'cities' && (
          <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <div className="flex-v gap-8">
              <div className="flex-between align-center">
                <label className="fs-14 font-bold">{tr('city_whitelist')}</label>
                <select
                  className="search-input py-4 px-8 fs-12 w-auto"
                  value=""
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) return;
                    onSettingsChange({ ...settingsData, cities: val.split('\n') });
                  }}
                >
                  <option value="" selected disabled>Выбрать город</option>
                  {CITIES_PRESETS.map(c => <option key={c.name} value={c.value}>{c.name}</option>)}
                </select>
              </div>
              <textarea
                className="msg-textarea"
                style={{ height: 500 }}
                value={(settingsData.cities || []).join('\n')}
                onChange={(e) =>
                  onSettingsChange({ ...settingsData, cities: e.target.value.split('\n') })
                }
                placeholder="Москва\nПитер..."
              />
            </div>
            <div className="flex-v gap-8">
              <div className="flex-between align-center">
                <label className="fs-14 font-bold">{tr('city_blacklist')}</label>
                <select
                  className="search-input py-4 px-8 fs-12 w-auto"
                  value=""
                  onChange={(e) => {
                    const selectedVal = e.target.value;
                    if (!selectedVal) return;
                    const allOthers = CITIES_PRESETS
                      .filter(c => c.value !== selectedVal)
                      .map(c => c.value)
                      .join('\n')
                      .split('\n');
                    onSettingsChange({ ...settingsData, citiesBlacklist: allOthers });
                  }}
                >
                  <option value="" selected disabled>Выбрать город</option>
                  {CITIES_PRESETS.map(c => <option key={c.name} value={c.value}>{c.name}</option>)}
                </select>
              </div>
              <textarea
                className="msg-textarea"
                style={{ height: 500 }}
                value={(settingsData.citiesBlacklist || []).join('\n')}
                onChange={(e) =>
                  onSettingsChange({ ...settingsData, citiesBlacklist: e.target.value.split('\n') })
                }
                placeholder="Лондон\nПариж..."
              />
            </div>
          </div>
        )
      }
      {
        settingsTab === 'blacklist' && (
          <div className="flex-v gap-8">
            <label className="fs-14 font-bold">{tr('words_blacklist')}</label>
            <p className="fs-12 color-muted m-0">{tr('words_blacklist_hint')}</p>
            <textarea
              className="msg-textarea"
              style={{ height: 500 }}
              value={(settingsData.wordsBlacklist || []).join('\n')}
              onChange={(e) =>
                onSettingsChange({ ...settingsData, wordsBlacklist: e.target.value.split('\n') })
              }
              placeholder={'магазин\nshop\ncrypto\nреклама...'}
            />
          </div>
        )
      }
      {
        settingsTab === 'niches' && (
          <textarea
            className="msg-textarea"
            style={{ height: 500 }}
            value={(settingsData.niches || []).join('\n')}
            onChange={(e) =>
              onSettingsChange({ ...settingsData, niches: e.target.value.split('\n') })
            }
          />
        )
      }
      {
        donorsMounted && (
          <div style={{ display: settingsTab === 'donors' ? 'block' : 'none' }} aria-hidden={settingsTab !== 'donors'}>
            {donorsReady ? (
              <DonorsSettingsSection
                settingsData={settingsData}
                onSettingsChange={onSettingsChange}
                scrapedDonors={scrapedDonors}
                tr={tr}
                TrashIcon={TrashIcon}
              />
            ) : (
              <div className="skeleton-item skeleton h-400" />
            )}
          </div>
        )
      }
    </div >
  );
}
