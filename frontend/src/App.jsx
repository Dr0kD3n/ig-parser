import { useState, useEffect, useCallback, useRef } from 'react';
import { t } from './i18n';
import ProfilesTab from './components/ProfilesTab';
import ControlsTab from './components/ControlsTab';
import SettingsTab from './components/SettingsTab';
import AuthPage from './components/AuthPage';
import { TelegramIcon } from './components/Icons';
import { API_BASE, LOCAL_API_BASE } from './config';
import { toast, Toaster } from 'react-hot-toast';

const LOG_BUFFER = 200;

const safeStorage = {
    getItem: (key, def) => {
        try {
            const val = localStorage.getItem(key);
            if (val === null || val === 'null' || val === 'undefined') return def;
            return val;
        } catch (e) { return def; }
    },
    setItem: (key, val) => {
        try {
            if (val === null || val === undefined) {
                localStorage.removeItem(key);
            } else {
                localStorage.setItem(key, val);
            }
        } catch (e) { }
    },
    removeItem: (key) => {
        try {
            localStorage.removeItem(key);
        } catch (e) { }
    },
    parse: (key, def) => {
        try {
            const val = localStorage.getItem(key);
            if (val === null || val === 'null' || val === 'undefined') return def;
            return JSON.parse(val);
        } catch (e) { return def; }
    }
};

export default function App() {
    const [lang, setLang] = useState(() => safeStorage.getItem('ig_lang', 'ru'));
    const tr = (key) => t(lang, key);
    const toggleLang = () => {
        const next = lang === 'ru' ? 'en' : 'ru';
        setLang(next);
        safeStorage.setItem('ig_lang', next);
    };

    const [user, setUser] = useState(() => safeStorage.parse('ig_user', null));
    const [token, setToken] = useState(() => safeStorage.getItem('ig_token', null));

    const [girls, setGirls] = useState([]);
    const [votes, setVotes] = useState({});
    const [viewed, setViewed] = useState(() => safeStorage.parse('ig_viewed_profiles', []));
    const [sentDM, setSentDM] = useState(() => safeStorage.parse('ig_sent_dm', []));
    const [failedImages, setFailedImages] = useState(new Set());
    const [modalOpen, setModalOpen] = useState(false);
    const [messagesText, setMessagesText] = useState('');

    const [settingsData, setSettingsData] = useState(() => {
        const defaultState = {
            accounts: [], activeParserAccountIds: [], activeServerAccountIds: [], activeIndexAccountIds: [], activeProfilesAccountIds: [],
            names: [], cities: [], niches: [], donors: [], showBrowser: false, humanEmulation: false, concurrentProfiles: 3
        };
        return { ...defaultState, ...safeStorage.parse('ig_settings', {}) };
    });

    const [botStatus, setBotStatus] = useState({ index: false, parser: false, checker: false });
    const [logs, setLogs] = useState([]);
    const [activeTab, setActiveTab] = useState(() => safeStorage.getItem('ig_active_tab', 'main'));
    const [isLoading, setIsLoading] = useState(true);
    const [saveStatus, setSaveStatus] = useState('idle');

    const [checkingAllTg, setCheckingAllTg] = useState(false);
    const [restoreStatus, setRestoreStatus] = useState({ running: false, current: 0, total: 0 });

    useEffect(() => { safeStorage.setItem('ig_active_tab', activeTab); }, [activeTab]);

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
        toast.success('Logged out successfully');
    }, []);

    const authFetch = useCallback(async (url, options = {}) => {
        let currentToken = safeStorage.getItem('ig_token', null);
        if (currentToken === 'null' || currentToken === 'undefined') currentToken = null;

        const authHeader = currentToken ? `Bearer ${currentToken}` : '';
        const headers = { ...options.headers, 'Authorization': authHeader };

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
    }, [handleLogout]);

    const settingsLoaded = useRef(false);
    const pendingSave = useRef(false);
    const saveAbortRef = useRef(null);

    const fetchData = useCallback(async () => {
        if (!user) return;
        try {
            const [girlsRes, votesRes] = await Promise.all([
                authFetch('/api/girls', { cache: 'no-store' }),
                authFetch('/api/votes', { cache: 'no-store' })
            ]);
            const girlsData = await girlsRes.json();
            const votesData = await votesRes.json();
            const viewedArr = safeStorage.parse('ig_viewed_profiles', []);
            const sentArr = safeStorage.parse('ig_sent_dm', []);

            girlsData.forEach(g => {
                g.viewed = viewedArr.includes(g.url);
                g.dmSent = sentArr.includes(g.url);
            });
            setGirls(girlsData || []);
            setVotes(votesData || {});
        } catch (e) {
            console.error('Error loading data', e);
        }
    }, [user, authFetch]);

    const fetchSettings = useCallback(async () => {
        if (!user) return;
        try {
            const res = await authFetch('/api/settings');
            const data = await res.json();
            setSettingsData(prev => ({
                ...prev,
                ...data,
                names: data.names || [],
                cities: data.cities || [],
                niches: data.niches || [],
                donors: data.donors || [],
                showBrowser: data.showBrowser || false,
                humanEmulation: data.humanEmulation || false,
                concurrentProfiles: data.concurrentProfiles || 3
            }));
            settingsLoaded.current = true;
            setIsLoading(false);
        } catch (e) {
            console.error('Error fetching settings', e);
        }
    }, [user, authFetch]);

    const fetchBotStatus = useCallback(async () => {
        if (!user) return;
        try {
            const res = await authFetch('/api/bot/status');
            const data = await res.json();
            setBotStatus(data);
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
                    if (data.running) fetchData();
                    if (!data.running && data.done) {
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
        if (user) {
            authFetch('/api/profiles/restore-photos/status')
                .then(res => res.json())
                .then(data => { if (data.running) setRestoreStatus(data); })
                .catch(() => { });
        }
    }, [user, authFetch]);

    useEffect(() => {
        if (user) {
            fetchData();
            fetchSettings();
            fetchBotStatus();
            const interval = setInterval(fetchBotStatus, 5000);
            const saved = safeStorage.parse('ig_first_messages', []);
            setMessagesText(saved.join('\n'));
            return () => clearInterval(interval);
        } else {
            setIsLoading(false);
        }
    }, [user, fetchData, fetchSettings, fetchBotStatus]);

    useEffect(() => {
        if (!settingsLoaded.current || !user) return;
        setSaveStatus('saving');
        const timer = setTimeout(() => {
            if (saveAbortRef.current) saveAbortRef.current.abort();
            const controller = new AbortController();
            saveAbortRef.current = controller;
            authFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(settingsData),
                signal: controller.signal
            }).then(() => {
                setSaveStatus('saved');
                setTimeout(() => setSaveStatus('idle'), 2000);
                safeStorage.setItem('ig_settings', JSON.stringify(settingsData));
            }).catch(err => {
                if (err.name !== 'AbortError') setSaveStatus('error');
            }).finally(() => {
                saveAbortRef.current = null;
            });
        }, 1000);
        return () => clearTimeout(timer);
    }, [settingsData, user, authFetch]);

    const onSettingsChange = (newSettings) => {
        setSettingsData(prev => ({ ...prev, ...newSettings }));
    };

    const handleVote = useCallback(async (g, status) => {
        setVotes(prev => ({ ...prev, [g.url]: status || '' }));
        setGirls(prev => prev.map(p => p.url === g.url ? { ...p, status } : p));
        authFetch('/api/vote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: g.url, status })
        });
    }, [authFetch]);

    const handleOpen = useCallback(async (g) => {
        if (!viewed.includes(g.url)) {
            const newV = [...viewed, g.url];
            setViewed(newV);
            safeStorage.setItem('ig_viewed_profiles', JSON.stringify(newV));
            setGirls(prev => prev.map(p => p.url === g.url ? { ...p, viewed: true } : p));
        }
        authFetch('/api/view', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: g.url })
        });
        window.open(g.url, '_blank');
    }, [viewed, authFetch]);

    const handleSendDM = useCallback(async (g) => {
        const msgs = safeStorage.parse('ig_first_messages', []);
        const m = msgs[Math.floor(Math.random() * msgs.length)] || 'Hello!';
        const newSent = [...sentDM, g.url];
        setSentDM(newSent);
        safeStorage.setItem('ig_sent_dm', JSON.stringify(newSent));
        setGirls(prev => prev.map(p => p.url === g.url ? { ...p, dmSent: true } : p));
        authFetch('/api/dm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: g.url, message: m })
        });
    }, [sentDM, authFetch]);

    const handleDeleteProfile = async (url) => {
        if (!confirm(tr('confirm_delete'))) return;
        try {
            const res = await authFetch('/api/profiles/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            if (res.ok) {
                setGirls(prev => prev.filter(g => g.url !== url));
                toast.success(tr('profile_deleted_success'));
            }
        } catch (e) {
            toast.error('Network error');
        }
    };

    const handleSaveAsDonor = async (url) => {
        try {
            const res = await authFetch('/api/donors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await res.json();
            if (data.success) {
                toast.success(tr('preset_saved') || 'Saved as donor');
                fetchSettings();
            } else {
                toast.error(data.error || 'Error saving donor');
            }
        } catch (e) {
            toast.error('Network error');
        }
    };

    const handleTgCheck = useCallback((url, status) => {
        setGirls(prev => prev.map(p => p.url === url ? { ...p, tg_status: status } : p));
    }, []);

    const handleImageError = useCallback((url) => {
        setFailedImages(prev => new Set([...prev, url]));
    }, []);

    const handleBotControl = useCallback(async (type, action) => {
        await authFetch(`/api/bot/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type })
        });
        fetchBotStatus();
    }, [fetchBotStatus, authFetch]);

    const handleClearLogs = useCallback(async () => {
        setLogs([]);
        try { await authFetch('/api/logs/clear', { method: 'POST' }); }
        catch (e) { }
    }, [authFetch]);

    const handleRestorePhotos = async () => {
        if (restoreStatus.running) {
            try {
                await authFetch('/api/profiles/restore-photos/stop', { method: 'POST' });
                setRestoreStatus(prev => ({ ...prev, status: 'Stopping...' }));
            } catch (err) { }
            return;
        }
        try {
            const resp = await authFetch('/api/profiles/restore-photos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    concurrency: settingsData.concurrentProfiles,
                    failedUrls: Array.from(failedImages)
                })
            });
            const data = await resp.json();
            if (data.success) {
                setRestoreStatus({ running: true, current: 0, total: 0, status: 'Starting...' });
                toast.success('Запущено восстановление фото');
            }
        } catch (err) { }
    };

    const handleCheckAllTg = async () => {
        const toCheck = girls.filter(g => !g.tg_status).map(g => g.name);
        if (toCheck.length === 0) {
            toast.error('Нет профилей без статуса для проверки');
            return;
        }
        if (!confirm(`Проверить ${toCheck.length} профилей? Это может занять время.`))
            return;
        setCheckingAllTg(true);
        try {
            const resp = await authFetch('/api/check-telegram-batch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: toCheck })
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

    useEffect(() => {
        if (!user || !token) return;
        const normalizedToken = token === 'null' ? null : token;
        if (!normalizedToken) return;
        const baseUrl = LOCAL_API_BASE;
        const es = new EventSource(`${baseUrl}/api/logs?token=${normalizedToken}`);
        es.onmessage = (ev) => {
            const log = JSON.parse(ev.data);
            setLogs(prev => [...prev, log].slice(-LOG_BUFFER));
        };
        return () => es.close();
    }, [user, token]);

    if (isLoading) return <div className="loading-screen-full"><div className="loader-ring" /></div>;

    if (!user) return <AuthPage onLoginSuccess={handleLoginSuccess} tr={tr} />;

    const unopenedCount = girls.filter(g => !g.viewed).length;
    const likesCount = Object.values(votes).filter(v => v === 'like').length;

    return (
        <div className="app">
            <header className="header">
                <div className="header-left">
                    <div className="logo">{tr('logo')}</div>
                    <div className="stats">
                        <span>{tr('unopened')} <b>{unopenedCount}</b></span>
                        <span>{tr('viewed')} <b>{viewed.length}</b></span>
                        <span>{tr('dm_sent')} <b className="color-accent">{sentDM.length}</b></span>
                        <div className="stats-divider" />
                        <span>{tr('likes')} <b className="color-success">{likesCount}</b></span>
                    </div>
                </div>
                <div className="header-right">
                    {saveStatus !== 'idle' && (
                        <div className={`save-indicator ${saveStatus === 'error' ? 'error' : ''}`}>
                            {saveStatus === 'saving' && <div className="loader-ring btn-xs" />}
                            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved' : 'Error'}
                        </div>
                    )}
                    <div className="user-badge-text">
                        {user.email}
                    </div>
                    <button className="btn-primary btn-icon-only btn-ghost" onClick={toggleLang}>
                        {lang.toUpperCase()}
                    </button>
                    <button className="btn-primary btn-sm btn-danger" onClick={handleLogout}>
                        OUT
                    </button>
                    <button className="btn-primary" onClick={() => setModalOpen(true)}>
                        {tr('templates')}
                    </button>
                </div>
            </header>

            <nav className="tabs-nav">
                <div className="tab-btn-wrapper">
                    {[
                        { id: 'main', label: tr('tab_profiles') },
                        { id: 'controls', label: tr('tab_execution') },
                        { id: 'settings', label: tr('tab_configuration') },
                    ].map(({ id, label }) => (
                        <button key={id} className={`tab-btn${activeTab === id ? ' active' : ''}`} onClick={() => setActiveTab(id)}>
                            {label}
                        </button>
                    ))}
                </div>

                {activeTab === 'main' && (
                    <div className="nav-extra-actions">
                        <button className="btn-primary btn-tg btn-sm"
                            onClick={handleCheckAllTg}
                            disabled={checkingAllTg}>
                            {checkingAllTg ? <div className="loader-ring btn-xs" /> : <TelegramIcon className="mini-icon" />}
                            {checkingAllTg ? 'Проверка...' : tr('btn_check_all_tg')}
                        </button>
                        <button className={`btn-primary btn-sm btn-restore ${restoreStatus.running ? 'running' : ''}`}
                            onClick={handleRestorePhotos}>
                            {restoreStatus.running ? `Остановить ${restoreStatus.current}/${restoreStatus.total}` : tr('btn_restore_photos')}
                        </button>
                        <button className="btn-primary btn-primary-alt btn-sm" onClick={fetchData} title={tr('btn_update')}>
                            {tr('btn_update')}
                        </button>
                    </div>
                )}
            </nav>

            <div className="main-content">
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
                        onDeleteProfile={handleDeleteProfile}
                        onSaveAsDonor={handleSaveAsDonor}
                        onImageError={handleImageError}
                        onRefresh={fetchData}
                        useProxyImages={settingsData.showBrowser}
                        tr={tr}
                        onTgCheck={handleTgCheck}
                        isLoading={isLoading}
                        authFetch={authFetch}
                        token={token}
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
                        token={token}
                    />
                )}

                {activeTab === 'settings' && (
                    <SettingsTab
                        settingsData={settingsData}
                        onSettingsChange={onSettingsChange}
                        tr={tr}
                        isLoading={isLoading}
                        authFetch={authFetch}
                        failedUrls={Array.from(failedImages)}
                    />
                )}
            </div>

            {modalOpen && (
                <div className="modal" onClick={() => setModalOpen(false)}>
                    <div className="modalContent" onClick={e => e.stopPropagation()}>
                        <h3 className="modal-title">{tr('modal_templates_title')}</h3>
                        <textarea className="msg-textarea" value={messagesText} onChange={e => setMessagesText(e.target.value)} placeholder={tr('one_msg_per_line')} />
                        <div className="modal-footer">
                            <button className="btn-primary btn-ghost" onClick={() => setModalOpen(false)}>
                                {tr('cancel')}
                            </button>
                            <button className="btn-primary" onClick={() => {
                                safeStorage.setItem('ig_first_messages', JSON.stringify(messagesText.split('\n').filter(l => l.trim())));
                                setModalOpen(false);
                            }}>
                                {tr('save_changes')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <Toaster position="bottom-right" toastOptions={{ style: { background: '#333', color: '#fff' } }} />
        </div>
    );
}
