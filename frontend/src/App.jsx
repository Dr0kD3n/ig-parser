import { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import ProfilesTab from './components/ProfilesTab';
import ControlsTab from './components/ControlsTab';
import SettingsTab from './components/SettingsTab';
import StatisticsTab from './components/StatisticsTab';
import ScheduleTab from './components/ScheduleTab';
import AuthPage from './components/AuthPage';
import { TelegramIcon } from './components/Icons';
import { API_BASE, LOCAL_API_BASE } from './config';
import { toast } from 'react-hot-toast';
import { safeStorage } from './utils/storage';
import { createCityMatcher, createWordsBlacklistMatcher, getTelegramUsername } from './utils/profile';
import { resolveMessagesForDonor, ensureDefaultDonorGroups } from './utils/donorCategories';
import { DEFAULT_SETTINGS, LOG_BUFFER, TABS } from './constants/settings';
import { useDialog } from './context/DialogContext';
import { useLogStream } from './hooks/useLogStream';
import { useOperationStatuses } from './hooks/useOperationStatuses';

export default function App() {
  const { confirm } = useDialog();
  const [user, setUser] = useState(() => safeStorage.parse('ig_user', null));
  const [token, setToken] = useState(() => safeStorage.getItem('ig_token', null));

  const [girls, setGirls] = useState([]);
  const [votes, setVotes] = useState({});
  const [viewed, setViewed] = useState(() => safeStorage.parse('ig_viewed_profiles', []));
  const [sentDM, setSentDM] = useState(() => safeStorage.parse('ig_sent_dm', []));
  const [failedImages, setFailedImages] = useState(new Set());

  const [settingsData, setSettingsData] = useState(() => ({
    ...DEFAULT_SETTINGS,
    ...safeStorage.parse('ig_settings', {}),
  }));

  useLayoutEffect(() => {
    document.documentElement.classList.toggle(
      'theme-monochrome',
      settingsData.monochromeMode === true
    );
    return () => document.documentElement.classList.remove('theme-monochrome');
  }, [settingsData.monochromeMode]);

  const [botStatus, setBotStatus] = useState({ index: false, parser: false, checker: false });
  const [activeTab, setActiveTab] = useState(() => safeStorage.getItem('ig_active_tab', 'profiles'));
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    safeStorage.setItem('ig_active_tab', tab);
  };
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('idle');

  const [cityOnly, setCityOnly] = useState(() => safeStorage.getItem('ig_city_only', 'false') === 'true');
  const [exceptCity, setExceptCity] = useState(() => safeStorage.getItem('ig_except_city', 'false') === 'true');

  useEffect(() => {
    safeStorage.setItem('ig_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    safeStorage.setItem('ig_city_only', String(cityOnly));
  }, [cityOnly]);

  useEffect(() => {
    safeStorage.setItem('ig_except_city', String(exceptCity));
  }, [exceptCity]);

  const matchesProfileCity = useMemo(
    () => createCityMatcher(settingsData.cities, settingsData.citiesBlacklist),
    [settingsData.cities, settingsData.citiesBlacklist]
  );

  const matchesWordsBlacklist = useMemo(
    () => createWordsBlacklistMatcher(settingsData.wordsBlacklist),
    [settingsData.wordsBlacklist]
  );

  const handleLoginSuccess = (newToken, newUser) => {
    setToken(newToken);
    setUser(newUser);
    safeStorage.setItem('ig_token', newToken);
    safeStorage.setItem('ig_user', JSON.stringify(newUser));
  };

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
    safeStorage.removeItem('ig_token');
    safeStorage.removeItem('ig_user');
  }, []);

  const handleLogout = useCallback(async () => {
    const currentToken = safeStorage.getItem('ig_token', null);
    try {
      if (currentToken && currentToken !== 'null' && currentToken !== 'undefined') {
        const response = await fetch(`${API_BASE}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${currentToken}` },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.warn('[AUTH] Logout request failed:', error.message);
      toast.error('Не удалось отозвать серверную сессию');
      return;
    }
    clearSession();
    toast.success('Вы вышли из системы');
  }, [clearSession]);

  const authFetch = useCallback(
    async (url, options = {}) => {
      let currentToken = safeStorage.getItem('ig_token', null);
      if (currentToken === 'null' || currentToken === 'undefined') currentToken = null;

      const authHeader = currentToken ? `Bearer ${currentToken}` : '';
      const headers = { ...options.headers, Authorization: authHeader };

      try {
        const baseUrl = url.startsWith('/api/auth/') ? API_BASE : LOCAL_API_BASE;
        const res = await fetch(`${baseUrl}${url}`, { ...options, headers });
        if (res.status === 401) {
          clearSession();
        }
        return res;
      } catch (error) {
        console.error(`[AUTH] Fetch error for ${url}:`, error);
        throw error;
      }
    },
    [clearSession]
  );
  const [logs, setLogs] = useLogStream(Boolean(user && token), authFetch, LOG_BUFFER);

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    fetch(`${API_BASE}/api/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
      .then((response) => {
        if (response.status === 401 || response.status === 403) clearSession();
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          console.warn('[AUTH] Session verification unavailable:', error.message);
        }
      });
    return () => controller.abort();
  }, [token, clearSession]);

  const settingsLoaded = useRef(false);
  const pendingSave = useRef(false);
  const donorsDirtyRef = useRef(false);
  const saveAbortRef = useRef(null);

  const refreshDonorsFromServer = useCallback(async () => {
    if (!user) return;
    try {
      const res = await authFetch('/api/donors');
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.donors)) {
        setSettingsData((prev) => ({ ...prev, donors: data.donors }));
      }
    } catch {
      /* ignore */
    }
  }, [user, authFetch]);

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const [girlsRes, votesRes] = await Promise.all([
        authFetch('/api/girls', { cache: 'no-store' }),
        authFetch('/api/votes', { cache: 'no-store' }),
      ]);

      if (!girlsRes.ok || !votesRes.ok) {
        console.warn('[FETCH] Data fetch failed with status:', girlsRes.status, votesRes.status);
        return;
      }

      const girlsData = await girlsRes.json();
      const votesData = await votesRes.json();

      if (!Array.isArray(girlsData)) {
        console.error('[FETCH] girlsData is not an array:', girlsData);
        setGirls([]);
        return;
      }

      const viewedArr = safeStorage.parse('ig_viewed_profiles', []);
      const sentArr = safeStorage.parse('ig_sent_dm', []);

      girlsData.forEach((g) => {
        g.viewed = g.viewed || viewedArr.includes(g.url);
        g.dmSent = g.dmSent || sentArr.includes(g.url);
        // tgTagged is now handled by backend
      });
      setGirls(girlsData);
      setVotes(votesData || {});
    } catch (e) {
      console.error('Error loading data', e);
    }
  }, [user, authFetch]);

  const {
    tgCheckStatus,
    setTgCheckStatus,
    restoreStatus,
    setRestoreStatus,
    massMessagingStatus,
    setMassMessagingStatus,
  } = useOperationStatuses({
    enabled: Boolean(user),
    authFetch,
    onProfilesChange: fetchData,
  });

  const fetchSettings = useCallback(
    async (force = false) => {
      if (!user) return;
      if (!force && activeTab === 'settings') {
        await refreshDonorsFromServer();
        return;
      }
      try {
        const res = await authFetch('/api/settings');
        if (!res.ok) return;
        const data = await res.json();
        setSettingsData((prev) => ({
          ...prev,
          ...data,
          names: Array.isArray(data.names) ? data.names : [],
          cities: Array.isArray(data.cities) ? data.cities : [],
          citiesBlacklist: Array.isArray(data.citiesBlacklist) ? data.citiesBlacklist : [],
          wordsBlacklist: Array.isArray(data.wordsBlacklist) ? data.wordsBlacklist : [],
          niches: Array.isArray(data.niches) ? data.niches : [],
          donors: Array.isArray(data.donors) ? data.donors : [],
          showBrowser: data.showBrowser || false,
          humanEmulation: data.humanEmulation || false,
          concurrentProfiles: data.concurrentProfiles || 3,
          dmLimit: data.dmLimit || 20,
          donorFollowersMin: data.donorFollowersMin ?? 1000,
          donorFollowersMax: data.donorFollowersMax ?? 0,
          targetFollowersMin: data.targetFollowersMin ?? 0,
          targetFollowersMax: data.targetFollowersMax ?? 0,
          feedbackCheckEnabled: data.feedbackCheckEnabled === true,
          monochromeMode: data.monochromeMode === true,
          feedbackCheckIntervalMinutes: data.feedbackCheckIntervalMinutes || 60,
          nichePresets: Array.isArray(data.nichePresets)
            ? data.nichePresets
            : prev.nichePresets,
          donorGroups: ensureDefaultDonorGroups(Array.isArray(data.donorGroups) ? data.donorGroups : []),
        }));
        pendingSave.current = false; // Reset dirty flag after polling
        settingsLoaded.current = true;
        setIsLoading(false);

      } catch (e) {
        console.error('Error fetching settings', e);
      }
    },
    [user, authFetch, activeTab, refreshDonorsFromServer]
  );

  const fetchBotStatus = useCallback(async () => {
    if (!user) return;
    try {
      const res = await authFetch('/api/bot/status');
      if (res.ok) {
        const data = await res.json();
        setBotStatus(data);
      }
    } catch {
      // Periodic status refresh retries automatically.
    }
  }, [user, authFetch]);

  useEffect(() => {
    if (user) {
      fetchData();
      fetchSettings(true);
      fetchBotStatus();
      const interval = setInterval(() => {
        fetchBotStatus();
        fetchSettings();
      }, 5000);
      return () => clearInterval(interval);
    } else {
      setIsLoading(false);
    }
  }, [user, fetchData, fetchSettings, fetchBotStatus]);

  useEffect(() => {
    if (!settingsLoaded.current || !user || !pendingSave.current) return;
    setSaveStatus('saving');

    const timer = setTimeout(() => {
      if (saveAbortRef.current) saveAbortRef.current.abort();
      const controller = new AbortController();
      saveAbortRef.current = controller;
      const payload = { ...settingsData };
      if (!donorsDirtyRef.current) {
        delete payload.donors;
      }
      authFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
        .then(() => {
          setSaveStatus('saved');
          pendingSave.current = false;
          donorsDirtyRef.current = false;
          setTimeout(() => setSaveStatus('idle'), 2000);
          safeStorage.setItem('ig_settings', JSON.stringify(settingsData));
        })
        .catch((err) => {
          if (err.name !== 'AbortError') setSaveStatus('error');
        })
        .finally(() => {
          saveAbortRef.current = null;
        });
    }, 1000);

    return () => clearTimeout(timer);
  }, [settingsData, user, authFetch]);

  const onSettingsChange = useCallback((newSettingsOrFn) => {
    pendingSave.current = true;
    setSettingsData((prev) => {
      const patch = typeof newSettingsOrFn === 'function' ? newSettingsOrFn(prev) : newSettingsOrFn;
      if (patch && Object.prototype.hasOwnProperty.call(patch, 'donors')) {
        donorsDirtyRef.current = true;
      }
      return { ...prev, ...patch };
    });
  }, []);


  const handleVote = useCallback(
    async (g, status) => {
      if (status === 'like' && g.tgTagged === 1) {
        authFetch('/api/profiles/tag-tg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: g.url, tagged: false }),
        });
      }
      setVotes((prev) => ({ ...prev, [g.url]: status || '' }));
      setGirls((prev) =>
        prev.map((p) =>
          p.url === g.url ? { ...p, status } : p
        )
      );
      authFetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: g.url, status }),
      });
    },
    [authFetch]
  );

  const handleOpen = useCallback(
    async (g) => {
      if (!viewed.includes(g.url)) {
        const newV = [...viewed, g.url];
        setViewed(newV);
        safeStorage.setItem('ig_viewed_profiles', JSON.stringify(newV));
        setGirls((prev) => prev.map((p) => (p.url === g.url ? { ...p, viewed: true } : p)));
      }
      authFetch('/api/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: g.url }),
      });
      window.open(g.url, '_blank');
    },
    [viewed, authFetch]
  );

  const handleSendDM = useCallback(
    async (g) => {
      const msgs = resolveMessagesForDonor(settingsData.donorGroups, settingsData.donors, g.donor);
      const m = msgs[Math.floor(Math.random() * msgs.length)] || 'Hello!';
      try {
        const res = await authFetch('/api/dm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: g.url, message: m }),
        });
        const data = await res.json();
        if (data.success) {
          const newSent = [...sentDM, g.url];
          setSentDM(newSent);
          safeStorage.setItem('ig_sent_dm', JSON.stringify(newSent));
          setGirls((prev) => prev.map((p) => (p.url === g.url ? { ...p, dmSent: true, dmError: null } : p)));
        } else {
          toast.error(data.message || 'Не отправлено');
        }
      } catch {
        toast.error('Ошибка отправки');
      }
    },
    [sentDM, authFetch, settingsData.donorGroups, settingsData.donors]
  );

  const handleTagTg = useCallback(
    async (g) => {
      // Переключение ручной отметки «написал в TG»
      const nextStatus = g.tgTagged === 1 ? 0 : 1;

      setGirls((prev) =>
        prev.map((p) =>
          p.url === g.url
            ? {
              ...p,
              tgTagged: nextStatus,
            }
            : p
        )
      );

      authFetch('/api/profiles/tag-tg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: g.url, tagged: nextStatus === 1 }),
      });

      // No longer automatically clearing vote/status when tagging
    },
    [authFetch]
  );

  const handleDeleteProfile = async (url) => {
    const ok = await confirm({
      title: 'Удалить профиль?',
      message: 'Профиль будет удалён из базы без возможности восстановления.',
      confirmText: 'Удалить',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await authFetch('/api/profiles/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        setGirls((prev) => prev.filter((g) => g.url !== url));
        toast.success("Профиль удален");
      }
    } catch {
      toast.error("Ошибка сети");
    }
  };

  const handleSaveAsDonor = async (url) => {
    try {
      const res = await authFetch('/api/donors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Сохранено как донор");
        fetchSettings();
      } else {
        toast.error(data.error || "Ошибка сохранения донора");
      }
    } catch {
      toast.error("Ошибка сети");
    }
  };

  const handleReportFailedImage = useCallback(
    async (url) => {
      if (!url) return;
      try {
        await authFetch('/api/image-failed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
      } catch {
        toast.error('Ошибка сети');
      }
    },
    [authFetch]
  );

  const handleImageError = useCallback(
    (url) => {
      setFailedImages((prev) => new Set([...prev, url]));
      handleReportFailedImage(url);
    },
    [handleReportFailedImage]
  );

  const handleTgCheck = useCallback((url, status) => {
    setGirls((prev) => prev.map((p) => (p.url === url ? { ...p, tg_status: status } : p)));
  }, []);

  const handleBotControl = useCallback(
    async (type, action) => {
      await authFetch(`/api/bot/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      fetchBotStatus();
    },
    [fetchBotStatus, authFetch]
  );

  const handleClearLogs = useCallback(async () => {
    setLogs([]);
    try {
      await authFetch('/api/logs/clear', { method: 'POST' });
    } catch {
      // Local state is already cleared; next stream event reconciles logs.
    }
  }, [authFetch, setLogs]);

  const handleRestorePhotos = async () => {
    if (restoreStatus.running) {
      try {
        await authFetch('/api/profiles/restore-photos/stop', { method: 'POST' });
        setRestoreStatus((prev) => ({ ...prev, status: 'Stopping...' }));
      } catch {
        // Polling reflects stop state on next tick.
      }
      return;
    }
    try {
      const resp = await authFetch('/api/profiles/restore-photos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concurrency: settingsData.concurrentProfiles,
          failedUrls: Array.from(failedImages),
        }),
      });
      const data = await resp.json();
      if (data.success) {
        console.log(data.profilesToCheck)
        setRestoreStatus({ running: true, current: 0, total: 0, status: 'Starting...' });
        toast.success('Запущено восстановление фото');
      } else {
        toast.error(data.error || 'Ошибка при запуске');
      }
    } catch {
      toast.error('Ошибка сети или сервера');
    }
  };

  const handleCheckAllTg = async () => {
    if (tgCheckStatus.running) {
      await authFetch('/api/check-telegram-batch/stop', { method: 'POST' });
      return;
    }

    const toCheck = girls
      .filter((g) => !g.tg_status && getTelegramUsername(g))
      .map((g) => ({ profileUrl: g.url, username: getTelegramUsername(g) }));
    if (toCheck.length === 0) {
      toast.error('Нет профилей без статуса для проверки');
      return;
    }
    const ok = await confirm({
      title: 'Массовая проверка Telegram',
      message: `Проверить ${toCheck.length} профилей параллельно (${settingsData.concurrentProfiles || 3} потоков)?`,
      confirmText: 'Проверить',
    });
    if (!ok) return;

    try {
      const resp = await authFetch('/api/check-telegram-batch/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles: toCheck }),
      });
      const data = await resp.json();
      if (data.success) {
        setTgCheckStatus({
          running: true,
          current: 0,
          total: data.total || toCheck.length,
          status: 'Starting...',
        });
      } else {
        toast.error(data.error || 'Не удалось запустить проверку');
      }
    } catch (err) {
      console.error('Batch TG check failed', err);
      toast.error('Ошибка запуска проверки TG');
    }
  };

  const handleMassMessaging = async () => {
    if (massMessagingStatus.running) {
      await authFetch('/api/mass-messages/stop', { method: 'POST' });
      return;
    }
    const cityOnly = localStorage.getItem('ig_city_only') === 'true';
    const exceptCity = localStorage.getItem('ig_except_city') === 'true';
    const likedOnly = localStorage.getItem('ig_filter_status') === 'like'
    try {
      const res = await authFetch('/api/mass-messages/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cityOnly, exceptCity, likedOnly })
      });
      if (res.ok) {
        setMassMessagingStatus({ running: true, current: 0, total: 0, status: 'Starting...' });
        toast.success(`Запущена рассылка ${cityOnly && '(только город)'} ${exceptCity && '(кроме города)'} ${likedOnly && '(только лайки)'}`);
      }
    } catch {
      toast.error('Ошибка запуска');
    }
  };

  const unopenedCount = useMemo(() => girls.filter((g) => !g.viewed).length, [girls]);
  const likesCount = useMemo(() => Object.values(votes).filter((v) => v === 'like').length, [votes]);
  const dmSentCount = useMemo(() => girls.filter((g) => g.dmSent).length, [girls]);
  const massMsgCount = useMemo(
    () =>
      girls.filter(
        (g) =>
          !g.dmSent &&
          votes[g.url] === 'like' &&
          !matchesWordsBlacklist(g) &&
          (!cityOnly || matchesProfileCity(g)) &&
          (!exceptCity || !matchesProfileCity(g))
      ).length,
    [girls, votes, matchesWordsBlacklist, cityOnly, exceptCity, matchesProfileCity]
  );
  const scrapedDonors = useMemo(
    () => Array.from(new Set(girls.map((g) => g.donor).filter(Boolean))).sort(),
    [girls]
  );

  if (isLoading)
    return (
      <div className="loading-screen-full">
        <div className="loader-ring" />
      </div>
    );

  if (!user) return <AuthPage onLoginSuccess={handleLoginSuccess} />;

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
        <div className="header-left">
          <div className="stats">
            <span>
              {"Ранее не открыты:"} <b>{unopenedCount}</b>
            </span>
            <span>
              {"Просмотрено:"} <b>{viewed.length}</b>
            </span>
            <span>
              {"Отправлено ЛС:"} <b className="color-accent">{dmSentCount}</b>
            </span>
            <div className="stats-divider" />
            <span>
              {"Лайков:"} <b className="color-success">{likesCount}</b>
            </span>
          </div>
        </div>
        <div className="header-right">
          {saveStatus !== 'idle' && (
            <div className={`save-indicator ${saveStatus === 'error' ? 'error' : ''}`}>
              {saveStatus === 'saving' && <div className="loader-ring btn-xs" />}
              {saveStatus === 'saving' ? "Сохранение..." : saveStatus === 'saved' ? "✓ Сохранено" : "Ошибка"}
            </div>
          )}
          <div className="user-badge-text">{user.email}</div>
          <button className="btn-primary btn-sm btn-danger" onClick={handleLogout}>
            {"Выйти"}
          </button>
        </div>
        </div>
      </header>

      <div className="app-content">
      <nav className="tabs-nav">
        <div className="tab-btn-wrapper">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              className={`tab-btn${activeTab === id ? ' active' : ''}`}
              onClick={() => handleTabChange(id)}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'profiles' && (
          <details className="nav-extra-actions">
            <summary className="nav-actions-summary">Действия</summary>
            <div className="nav-extra-actions-list">
            <button
              className={`btn-primary btn-sm btn-restore ${massMessagingStatus.running ? 'running' : ''}`}
              style={{ backgroundColor: 'var(--color-primary-alt)' }}
              onClick={handleMassMessaging}
            >
              {massMessagingStatus.running ? `Стоп ${massMessagingStatus.current}/${massMessagingStatus.total}` : `${"Массовая рассылка"} (${massMsgCount})`}
            </button>
            <button
              className={`btn-primary btn-tg btn-sm ${tgCheckStatus.running ? 'running' : ''}`}
              onClick={handleCheckAllTg}
            >
              {tgCheckStatus.running ? (
                <>Стоп {tgCheckStatus.current}/{tgCheckStatus.total}</>
              ) : (
                <>
                  <TelegramIcon className="mini-icon" />
                  {"Проверить все ТГ"}
                </>
              )}
            </button>
            <button
              className={`btn-primary btn-sm btn-restore ${restoreStatus.running ? 'running' : ''}`}
              onClick={handleRestorePhotos}
            >
              {restoreStatus.running
                ? `Остановить ${restoreStatus.current}/${restoreStatus.total}`
                : "Обновить профили"}
            </button>
            <button
              className="btn-primary btn-primary-alt btn-sm"
              onClick={fetchData}
              title={"Обновить"}
            >
              {"Обновить"}
            </button>
            </div>
          </details>
        )}
      </nav>

      <div className="main-content">
        {activeTab === 'profiles' && (
          <ProfilesTab
            girls={girls}
            votes={votes}
            failedImages={failedImages}
            onVote={handleVote}
            onOpen={handleOpen}
            onSendDM={handleSendDM}
            onTagTg={handleTagTg}
            onDeleteProfile={handleDeleteProfile}
            onSaveAsDonor={handleSaveAsDonor}
            onImageError={handleImageError}
            onTgCheck={handleTgCheck}
            isLoading={isLoading}
            authFetch={authFetch}
            cityOnly={cityOnly}
            setCityOnly={setCityOnly}
            exceptCity={exceptCity}
            setExceptCity={setExceptCity}
            matchesProfileCity={matchesProfileCity}
            matchesWordsBlacklist={matchesWordsBlacklist}
          />
        )}

        {activeTab === 'controls' && (
          <ControlsTab
            botStatus={botStatus}
            onBotControl={handleBotControl}
            onClearLogs={handleClearLogs}
            logs={logs}
            isLoading={isLoading}
            authFetch={authFetch}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            settingsData={settingsData}
            onSettingsChange={onSettingsChange}
            onDonorsRefresh={refreshDonorsFromServer}
            isLoading={isLoading}
            authFetch={authFetch}
            failedUrls={Array.from(failedImages)}
            scrapedDonors={scrapedDonors}
          />
        )}

        {activeTab === 'stats' && (
          <StatisticsTab authFetch={authFetch} />
        )}

        {activeTab === 'schedule' && (
          <ScheduleTab authFetch={authFetch} />
        )}
      </div>
      </div>
    </div>
  );
}
