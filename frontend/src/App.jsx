import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ProfilesTab from './components/ProfilesTab';
import ControlsTab from './components/ControlsTab';
import SettingsTab from './components/SettingsTab';
import StatisticsTab from './components/StatisticsTab';
import AuthPage from './components/AuthPage';
import { TelegramIcon } from './components/Icons';
import { API_BASE, LOCAL_API_BASE } from './config';
import { toast } from 'react-hot-toast';
import { safeStorage } from './utils/storage';
import { createCityMatcher, createWordsBlacklistMatcher } from './utils/profile';
import { getDonorUsername } from './utils/donor';
import { DEFAULT_SETTINGS, LOG_BUFFER, TABS } from './constants/settings';

export default function App() {
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

  const [botStatus, setBotStatus] = useState({ index: false, parser: false, checker: false });
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState(() => safeStorage.getItem('ig_active_tab', 'profiles'));
  const handleTabChange = (tab) => {
    setActiveTab(tab);
    safeStorage.setItem('ig_active_tab', tab);
  };
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('idle');

  const [checkingAllTg, setCheckingAllTg] = useState(false);
  const [restoreStatus, setRestoreStatus] = useState({ running: false, current: 0, total: 0 });
  const [massMessagingStatus, setMassMessagingStatus] = useState({ running: false, current: 0, total: 0 });

  const [cityOnly, setCityOnly] = useState(() => safeStorage.getItem('ig_city_only', 'false') === 'true');

  useEffect(() => {
    safeStorage.setItem('ig_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    safeStorage.setItem('ig_city_only', String(cityOnly));
  }, [cityOnly]);

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

  const handleLogout = useCallback(() => {
    setToken(null);
    setUser(null);
    safeStorage.removeItem('ig_token');
    safeStorage.removeItem('ig_user');
    toast.success("Вы вышли из системы");
  }, []);

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
          handleLogout();
        }
        return res;
      } catch (error) {
        console.error(`[AUTH] Fetch error for ${url}:`, error);
        throw error;
      }
    },
    [handleLogout]
  );

  const settingsLoaded = useRef(false);
  const pendingSave = useRef(false);
  const saveAbortRef = useRef(null);

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

  const fetchSettings = useCallback(
    async (force = false) => {
      if (!user) return;
      if (!force && activeTab === 'settings') return;
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
          donorGroups: Array.isArray(data.donorGroups) ? data.donorGroups : [],
        }));
        pendingSave.current = false; // Reset dirty flag after polling
        settingsLoaded.current = true;
        setIsLoading(false);

      } catch (e) {
        console.error('Error fetching settings', e);
      }
    },
    [user, authFetch, activeTab]
  );

  const fetchBotStatus = useCallback(async () => {
    if (!user) return;
    try {
      const res = await authFetch('/api/bot/status');
      if (res.ok) {
        const data = await res.json();
        setBotStatus(data);
      }
    } catch (e) { }
  }, [user, authFetch]);

  useEffect(() => {
    let interval;
    if (restoreStatus.running) {
      interval = setInterval(async () => {
        try {
          const res = await authFetch('/api/profiles/restore-photos/status');
          const data = await res.json();
          setRestoreStatus(data);

          if (data.error) {
            toast.error(`Ошибка восстановления: ${data.error}`);
            setRestoreStatus({ running: false, error: data.error });
          } else if (data.running) {
            fetchData();
          } else if (data.done) {
            toast.success(`Обновлено профилей: ${data.result?.updatedCount || 0}`);
            fetchData();
          }
        } catch (e) {
          console.error('Error polling restore status:', e);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [restoreStatus.running, authFetch, fetchData]);

  useEffect(() => {
    let interval;
    if (massMessagingStatus.running) {
      interval = setInterval(async () => {
        try {
          const res = await authFetch('/api/mass-messages/status');
          const data = await res.json();
          setMassMessagingStatus(data);
          if (!data.running) {
            if (data.status === 'Done') toast.success('Рассылка завершена');
            fetchData();
          }
        } catch (e) { }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [massMessagingStatus.running, authFetch, fetchData]);

  useEffect(() => {
    if (user) {
      authFetch('/api/mass-messages/status')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.running) setMassMessagingStatus(data);
        })
        .catch(() => { });

      authFetch('/api/profiles/restore-photos/status')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data && data.running) setRestoreStatus(data);
        })
        .catch(() => { });
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
      authFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsData),
        signal: controller.signal,
      })
        .then(() => {
          setSaveStatus('saved');
          pendingSave.current = false;
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
      let msgs = [];
      if (g.donor && settingsData.donorGroups?.length > 0) {
        const targetDonor = g.donor.replace('@', '').trim();
        const specificGroup = settingsData.donorGroups.find((grp) =>
          (grp.donors || []).some((d) => getDonorUsername(d) === targetDonor)
        );
        if (specificGroup && specificGroup.messages?.length > 0) {
          msgs = specificGroup.messages;
        } else {
          const allGroup = settingsData.donorGroups.find((grp) => grp.id === 'all');
          if (allGroup && allGroup.messages?.length > 0) msgs = allGroup.messages;
        }
      } else {
        const allGroup = settingsData.donorGroups?.find((grp) => grp.id === 'all');
        if (allGroup && allGroup.messages?.length > 0) msgs = allGroup.messages;
      }
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
      } catch (e) {
        toast.error('Ошибка отправки');
      }
    },
    [sentDM, authFetch, settingsData.donorGroups]
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
    if (!confirm("Удалить этот профиль?")) return;
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
    } catch (e) {
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
    } catch (e) {
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
    } catch (e) { }
  }, [authFetch]);

  const handleRestorePhotos = async () => {
    if (restoreStatus.running) {
      try {
        await authFetch('/api/profiles/restore-photos/stop', { method: 'POST' });
        setRestoreStatus((prev) => ({ ...prev, status: 'Stopping...' }));
      } catch (err) { }
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
    } catch (err) {
      toast.error('Ошибка сети или сервера');
    }
  };

  const handleCheckAllTg = async () => {
    const toCheck = girls.filter((g) => !g.tg_status).map((g) => g.name);
    if (toCheck.length === 0) {
      toast.error('Нет профилей без статуса для проверки');
      return;
    }
    if (!confirm(`Проверить ${toCheck.length} профилей? Это может занять время.`)) return;
    setCheckingAllTg(true);
    try {
      const resp = await authFetch('/api/check-telegram-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: toCheck }),
      });
      const data = await resp.json();
      if (data.success) {
        await fetchData();
      }
    } catch (err) {
      console.error('Batch TG check failed', err);
    } finally {
      setCheckingAllTg(false);
    }
  };

  const handleMassMessaging = async () => {
    if (massMessagingStatus.running) {
      await authFetch('/api/mass-messages/stop', { method: 'POST' });
      return;
    }
    const cityOnly = localStorage.getItem('ig_city_only') === 'true';
    const likedOnly = localStorage.getItem('ig_filter_status') === 'like'
    try {
      const res = await authFetch('/api/mass-messages/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cityOnly, likedOnly })
      });
      if (res.ok) {
        setMassMessagingStatus({ running: true, current: 0, total: 0, status: 'Starting...' });
        toast.success(`Запущена рассылка ${cityOnly && '(только город)'} ${likedOnly && '(только лайки)'}`);
      }
    } catch (e) { toast.error('Ошибка запуска'); }
  };

  useEffect(() => {
    if (!user || !token) return;
    const normalizedToken = token === 'null' ? null : token;
    if (!normalizedToken) return;

    let es;
    let cancelled = false;
    let retryTimer;

    const connectLogs = () => {
      if (cancelled) return;
      es = new EventSource(`/api/logs?token=${encodeURIComponent(normalizedToken)}`);
      es.onmessage = (ev) => {
        const log = JSON.parse(ev.data);
        setLogs((prev) => [...prev, log].slice(-LOG_BUFFER));
      };
      es.onerror = () => {
        es?.close();
        if (!cancelled) retryTimer = setTimeout(connectLogs, 3000);
      };
    };

    // Ждём backend — иначе vite proxy падает с ECONNREFUSED и светит token в URL
    (async () => {
      for (let i = 0; i < 15 && !cancelled; i++) {
        try {
          const res = await authFetch('/api/bot/status');
          if (res.ok) {
            connectLogs();
            return;
          }
        } catch (_) { /* backend ещё не поднялся */ }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!cancelled) connectLogs();
    })();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      es?.close();
    };
  }, [user, token, authFetch]);

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
          (!cityOnly || matchesProfileCity(g))
      ).length,
    [girls, votes, matchesWordsBlacklist, cityOnly, matchesProfileCity]
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
      </header>

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
          <div className="nav-extra-actions">
            <button
              className={`btn-primary btn-sm btn-restore ${massMessagingStatus.running ? 'running' : ''}`}
              style={{ backgroundColor: 'var(--color-primary-alt)' }}
              onClick={handleMassMessaging}
            >
              {massMessagingStatus.running ? `Стоп ${massMessagingStatus.current}/${massMessagingStatus.total}` : `${"Массовая рассылка"} (${massMsgCount})`}
            </button>
            <button
              className="btn-primary btn-tg btn-sm"
              onClick={handleCheckAllTg}
              disabled={checkingAllTg}
            >
              {checkingAllTg ? (
                <div className="loader-ring btn-xs" />
              ) : (
                <TelegramIcon className="mini-icon" />
              )}
              {checkingAllTg ? 'Проверка...' : "Проверить все ТГ"}
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
            token={token}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            settingsData={settingsData}
            onSettingsChange={onSettingsChange}
            isLoading={isLoading}
            authFetch={authFetch}
            failedUrls={Array.from(failedImages)}
            scrapedDonors={scrapedDonors}
          />
        )}

        {activeTab === 'stats' && (
          <StatisticsTab authFetch={authFetch} />
        )}
      </div>
    </div>
  );
}
