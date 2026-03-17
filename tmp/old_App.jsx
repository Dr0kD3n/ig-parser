import { useState, useEffect, useCallback, useRef } from 'react';
import { t } from './i18n';
import ProfilesTab from './components/ProfilesTab';
import ControlsTab from './components/ControlsTab';
import SettingsTab from './components/SettingsTab';
import { Toaster } from 'react-hot-toast';
const LOG_BUFFER = 200;
export default function App() {
  const [lang, setLang] = useState(() => localStorage.getItem('ig_lang') || 'ru');
  const tr = (key) => t(lang, key);
  const toggleLang = () => {
    const next = lang === 'ru' ? 'en' : 'ru';
    setLang(next);
    localStorage.setItem('ig_lang', next);
  };
  const [girls, setGirls] = useState([]);
  const [votes, setVotes] = useState({});
  const [viewed, setViewed] = useState(() =>
    JSON.parse(localStorage.getItem('ig_viewed_profiles') || '[]')
  );
  const [sentDM, setSentDM] = useState(() =>
    JSON.parse(localStorage.getItem('ig_sent_dm') || '[]')
  );
  const [failedImages, setFailedImages] = useState(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [messagesText, setMessagesText] = useState('');
  const [settingsData, setSettingsData] = useState({
    accounts: [],
    activeParserAccountIds: [],
    activeServerAccountIds: [],
    activeIndexAccountIds: [],
    activeProfilesAccountIds: [],
    names: [],
    cities: [],
    niches: [],
    donors: [],
    showBrowser: false,
  });
  const [botStatus, setBotStatus] = useState({ index: false, parser: false, checker: false });
  const [logs, setLogs] = useState([]);
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('ig_active_tab') || 'main');
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('idle');
  // Persist active tab
  useEffect(() => {
    localStorage.setItem('ig_active_tab', activeTab);
  }, [activeTab]);
  const settingsLoaded = useRef(false);
  // Fetch profiles + votes
  const fetchData = useCallback(async () => {
    try {
      const [girlsRes, votesRes] = await Promise.all([
        fetch('/api/girls', { cache: 'no-store' }),
        fetch('/api/votes', { cache: 'no-store' }),
      ]);
      const girlsData = await girlsRes.json();
      const votesData = await votesRes.json();
      const viewedArr = JSON.parse(localStorage.getItem('ig_viewed_profiles') || '[]');
      const sentArr = JSON.parse(localStorage.getItem('ig_sent_dm') || '[]');
      girlsData.forEach((g) => {
        g.viewed = viewedArr.includes(g.url);
        g.dmSent = sentArr.includes(g.url);
      });
      setGirls(girlsData);
      setVotes(votesData);
    } catch (e) {
      console.error('Error loading data', e);
    }
  }, []);
  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setSettingsData({
        accounts: data.accounts || [],
        activeParserAccountIds: data.activeParserAccountIds || [],
        activeServerAccountIds: data.activeServerAccountIds || [],
        activeIndexAccountIds: data.activeIndexAccountIds || [],
        activeProfilesAccountIds: data.activeProfilesAccountIds || [],
        names: data.names || [],
        cities: data.cities || [],
        niches: data.niches || [],
        donors: data.donors || [],
        showBrowser: data.showBrowser || false,
        concurrentProfiles: data.concurrentProfiles,
      });
      settingsLoaded.current = true;
    } catch (e) {
      console.error('Error fetching settings', e);
    }
  }, []);
  const fetchBotStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/status');
      const data = await res.json();
      setBotStatus(data);
    } catch (e) {}
  }, []);
  // Initial data load + SSE
  useEffect(() => {
    fetchData();
    fetchSettings();
    fetchBotStatus();
    const saved = JSON.parse(localStorage.getItem('ig_first_messages') || '[]');
    setMessagesText(saved.join('\n'));
    // SSE log stream
    const es = new EventSource('/api/logs');
    let initialBurst = true;
    const burstTimer = setTimeout(() => {
      initialBurst = false;
    }, 1500);
    es.onmessage = (ev) => {
      const log = JSON.parse(ev.data);
      const entry = { ...log, id: Math.random().toString(36).slice(2, 9) };
      setLogs((prev) => [...prev, entry].slice(-LOG_BUFFER));
    };
    // Poll bot status every 10s (instead of 3s)
    const statusInterval = setInterval(fetchBotStatus, 10000);
    // Remove loader after a tick (no artificial delay)
    const loaderTimer = setTimeout(() => setIsLoading(false), 50);
    return () => {
      es.close();
      clearInterval(statusInterval);
      clearTimeout(burstTimer);
      clearTimeout(loaderTimer);
    };
  }, [fetchData, fetchSettings, fetchBotStatus]);
  // Actions
  const handleVote = useCallback(async (g, status) => {
    setVotes((prev) => ({ ...prev, [g.url]: status || '' }));
    setGirls((prev) => prev.map((p) => (p.url === g.url ? { ...p, status } : p)));
    fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: g.url, status }),
    });
  }, []);
  const handleOpen = useCallback(
    async (g) => {
      if (!viewed.includes(g.url)) {
        const newV = [...viewed, g.url];
        setViewed(newV);
        localStorage.setItem('ig_viewed_profiles', JSON.stringify(newV));
        setGirls((prev) => prev.map((p) => (p.url === g.url ? { ...p, viewed: true } : p)));
      }
      fetch('/api/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: g.url }),
      });
      window.open(g.url, '_blank');
    },
    [viewed]
  );
  const handleSendDM = useCallback(
    async (g) => {
      const msgs = JSON.parse(localStorage.getItem('ig_first_messages') || '[]');
      const m = msgs[Math.floor(Math.random() * msgs.length)] || 'Hello!';
      const newSent = [...sentDM, g.url];
      setSentDM(newSent);
      localStorage.setItem('ig_sent_dm', JSON.stringify(newSent));
      setGirls((prev) => prev.map((p) => (p.url === g.url ? { ...p, dmSent: true } : p)));
      fetch('/api/dm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: g.url, message: m }),
      });
    },
    [sentDM]
  );
  const handleTgCheck = useCallback((url, status) => {
    setGirls((prev) => prev.map((p) => (p.url === url ? { ...p, tg_status: status } : p)));
  }, []);
  const handleImageError = useCallback((url) => {
    setFailedImages((prev) => new Set([...prev, url]));
  }, []);
  const handleBotControl = useCallback(
    async (type, action) => {
      await fetch(`/api/bot/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      fetchBotStatus();
    },
    [fetchBotStatus]
  );
  const handleClearLogs = useCallback(async () => {
    setLogs([]);
    try {
      await fetch('/api/logs/clear', { method: 'POST' });
    } catch (e) {
      console.error('Failed to clear logs on server', e);
    }
  }, []);
  const handleSaveSettings = useCallback(async () => {
    if (!settingsLoaded.current) return;
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settingsData),
    });
  }, [settingsData]);
  // Auto-save settings on change (debounced, skip initial load)
  const saveAbortRef = useRef(null);
  useEffect(() => {
    if (!settingsLoaded.current) return;
    setSaveStatus('saving');
    const timer = setTimeout(() => {
      if (saveAbortRef.current) saveAbortRef.current.abort();
      const controller = new AbortController();
      saveAbortRef.current = controller;
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsData),
        signal: controller.signal,
      })
        .then(() => {
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        })
        .catch((err) => {
          if (err.name !== 'AbortError') setSaveStatus('error');
        });
    }, 800);
    return () => clearTimeout(timer);
  }, [settingsData]);
  // Header stats (memoized-ish via inline)
  const unopenedCount = girls.filter((g) => !g.viewed).length;
  const likesCount = Object.values(votes).filter((v) => v === 'like').length;
  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">{tr('logo')}</div>
          <div className="stats">
            <span>
              {tr('unopened')} <b>{unopenedCount}</b>
            </span>
            <span>
              {tr('viewed')} <b>{viewed.length}</b>
            </span>
            <span>
              {tr('dm_sent')} <b style={{ color: 'hsl(var(--accent))' }}>{sentDM.length}</b>
            </span>
            <div className="stats-divider" />
            <span>
              {tr('likes')} <b style={{ color: 'hsl(var(--success))' }}>{likesCount}</b>
            </span>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
          {saveStatus !== 'idle' && (
            <div
              style={{
                fontSize: '12px',
                color: saveStatus === 'error' ? 'hsl(var(--danger))' : 'hsl(var(--text-muted))',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              {saveStatus === 'saving' && (
                <div
                  className="loader-ring"
                  style={{ width: '12px', height: '12px', borderWidth: '2px' }}
                />
              )}
              {saveStatus === 'saving'
                ? 'Сохранение...'
                : saveStatus === 'saved'
                  ? '✓ Сохранено'
                  : 'Ошибка сохранения'}
            </div>
          )}
          <button
            className="btn-primary"
            style={{
              background: 'transparent',
              fontSize: '12px',
              padding: '4px 8px',
              minWidth: '40px',
            }}
            onClick={toggleLang}
          >
            {lang.toUpperCase()}
          </button>
          <button className="btn-primary" onClick={() => setModalOpen(true)}>
            {tr('templates')}
          </button>
        </div>
      </header>

      <nav className="tabs-nav">
        <div style={{ display: 'flex', gap: '8px' }}>
          {[
            { id: 'main', label: tr('tab_profiles') },
            { id: 'controls', label: tr('tab_execution') },
            { id: 'settings', label: tr('tab_configuration') },
          ].map(({ id, label }) => (
            <button
              key={id}
              className={`tab-btn${activeTab === id ? ' active' : ''}`}
              onClick={() => setActiveTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="btn-primary"
          style={{
            marginLeft: 'auto',
            background: 'hsl(210 100% 50%)',
            borderColor: 'transparent',
          }}
          onClick={fetchData}
          title={tr('btn_update')}
        >
          {tr('btn_update')}
        </button>
      </nav>

      {activeTab === 'main' && (
        <ProfilesTab
          girls={girls}
          votes={votes}
          viewed={viewed}
          sentDM={sentDM}
          failedImages={failedImages}
          onVote={handleVote}
          onOpen={handleOpen}
          onSendDM={handleSendDM}
          onImageError={handleImageError}
          onRefresh={fetchData}
          useProxyImages={(settingsData.activeProfilesAccountIds || []).length > 0}
          tr={tr}
          onTgCheck={handleTgCheck}
          isLoading={isLoading}
        />
      )}

      {activeTab === 'controls' && (
        <ControlsTab
          botStatus={botStatus}
          onBotControl={handleBotControl}
          onClearLogs={handleClearLogs}
          logs={logs}
          tr={tr}
          isLoading={isLoading}
        />
      )}

      {activeTab === 'settings' && (
        <SettingsTab
          settingsData={settingsData}
          onSettingsChange={setSettingsData}
          onSave={handleSaveSettings}
          tr={tr}
          isLoading={isLoading}
        />
      )}

      {modalOpen && (
        <div className="modal" onClick={() => setModalOpen(false)}>
          <div className="modalContent" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: 0, marginBottom: 18, color: '#fff' }}>
              {tr('modal_templates_title')}
            </h3>
            <textarea
              className="msg-textarea"
              value={messagesText}
              onChange={(e) => setMessagesText(e.target.value)}
              placeholder={tr('one_msg_per_line')}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button
                className="btn-primary"
                style={{ background: 'transparent', border: 'none', boxShadow: 'none' }}
                onClick={() => setModalOpen(false)}
              >
                {tr('cancel')}
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  localStorage.setItem(
                    'ig_first_messages',
                    JSON.stringify(messagesText.split('\n').filter((l) => l.trim()))
                  );
                  setModalOpen(false);
                }}
              >
                {tr('save_changes')}
              </button>
            </div>
          </div>
        </div>
      )}
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#333',
            color: '#fff',
          },
        }}
      />
    </div>
  );
}
