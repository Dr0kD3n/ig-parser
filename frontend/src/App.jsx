import { useState, useEffect, useCallback, useRef } from 'react';
import { t } from './i18n';
import { API_BASE, LOCAL_API_BASE } from './config';
import { toast, Toaster } from 'react-hot-toast';
import ProfilesTab from './components/ProfilesTab';
import ControlsTab from './components/ControlsTab';
import SettingsTab from './components/SettingsTab';
import AuthPage from './components/AuthPage';
import { TelegramIcon, RefreshIcon } from './components/Icons';

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
        let currentToken = token;
        if (currentToken === 'null' || currentToken === 'undefined') currentToken = null;

        const authHeader = currentToken ? `Bearer ${currentToken}` : '';
        const headers = {
            ...options.headers,
            'Authorization': authHeader
        };

        console.log(`[AUTH] Fetching ${url}, token present: ${!!currentToken}`);

        try {
            const baseUrl = url.startsWith('/api/auth/') ? API_BASE : LOCAL_API_BASE;
            const res = await fetch(`${baseUrl}${url}`, { ...options, headers });
            console.log(`[AUTH] Response for ${url}: ${res.status} ${res.statusText}`);

            if (res.status === 401 && currentToken) {
                console.warn(`[AUTH] 401 Unauthorized for ${url}, logging out`);
                handleLogout();
            }
            return res;
        } catch (error) {
            console.error(`[AUTH] Fetch error for ${url}:`, error);
            throw error;
        }
    }, [token, handleLogout]);

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
                    if (data.running) {
                        fetchData();
                    }

                    if (!data.running && data.done) {
                        toast.success(`Обновлено фото: ${data.result?.updatedCount || 0}`);
                        fetchData();
                    }
                } catch (e) {
                    console.error('Error polling restore status:', e);
                }
            }, 3000);
        }
        return () => clearInterval(interval);
    }, [restoreStatus.running, authFetch, fetchData]);

    // Initial restore status check
    useEffect(() => {
        if (user) {
            authFetch('/api/profiles/restore-photos/status')
                .then(res => res.json())
                .then(data => {
                    if (data.running) setRestoreStatus(data);
                })
                .catch(() => { });
        }
    }, [user, authFetch]);

    useEffect(() => {
        if (user) {
            fetchData();
            fetchSettings();
            fetchBotStatus();
            const interval = setInterval(fetchBotStatus, 5000);
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
            if (pendingSave.current) {
                const controller = new AbortController();
                saveAbortRef.current = controller;
                authFetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...settingsData, forceEmpty: true }),
                    signal: controller.signal
                }).then(() => {
                    setSaveStatus('saved');
                    setTimeout(() => setSaveStatus('idle'), 2000);
                }).catch(err => {
                    if (err.name !== 'AbortError') setSaveStatus('error');
                }).finally(() => {
                    pendingSave.current = false;
                    saveAbortRef.current = null;
                });
            }
        }, 800);
        return () => clearTimeout(timer);
    }, [settingsData, user, authFetch]);

    const onSettingsChange = (newSettings) => {
        setSettingsData(prev => ({ ...prev, ...newSettings }));
        pendingSave.current = true;
    };

    const handleImageError = useCallback((url) => {
        setFailedImages(prev => {
            const next = new Set(prev);
            next.add(url);
            return next;
        });
    }, []);

    const handleTgCheck = useCallback((url, status) => {
        setGirls(prev => prev.map(g => g.url === url ? { ...g, tg_status: status } : g));
    }, []);

    const markViewed = useCallback((url) => {
        setViewed(prev => {
            if (prev.includes(url)) return prev;
            const next = [...prev, url];
            safeStorage.setItem('ig_viewed_profiles', JSON.stringify(next));
            return next;
        });
        setGirls(prev => prev.map(g => g.url === url ? { ...g, viewed: true } : g));
    }, []);

    const handleOpenProfile = useCallback((g) => {
        markViewed(g.url);
        window.open(g.url, '_blank');
    }, [markViewed]);

    const handleSendDM = useCallback((g) => {
        setMessagesText(`Привет, ${g.name}! У тебя отличный профиль.`);
        setModalOpen(true);
    }, []);

    const handleVote = async (url, status) => {
        try {
            const res = await authFetch('/api/vote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, status })
            });
            if (res.ok) {
                setVotes(prev => ({ ...prev, [url]: status }));
                setGirls(prev => prev.map(g => g.url === url ? { ...g, vote: status } : g));
            }
        } catch (e) { console.error('Vote error', e); }
    };

    const handleDeleteProfile = async (url) => {
        try {
            const res = await authFetch('/api/profiles/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            if (res.ok) {
                setGirls(prev => prev.filter(g => g.url !== url));
                toast.success(tr('profile_deleted_success'));
            } else {
                toast.error(tr('profile_deleted_error'));
            }
        } catch (e) {
            console.error('Delete profile error', e);
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
            console.error('Save as donor error', e);
            toast.error('Network error');
        }
    };

    const handleCheckAllTg = async () => {
        const toCheck = girls.filter(g => !g.tg_status).map(g => g.name);
        if (toCheck.length === 0) {
            toast.error('Нет профилей без статуса для проверки');
            return;
        }
        setCheckingAllTg(true);
        try {
            const resp = await authFetch(`/api/check-telegram-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: toCheck })
            });
            const data = await resp.json();
            if (data.success) {
                await fetchData();
            }
        }
        catch (err) {
            console.error('Batch TG check failed', err);
        }
        finally {
            setCheckingAllTg(false);
        }
    };

    const handleRestorePhotos = async () => {
        if (restoreStatus.running) {
            // STOP command
            try {
                await authFetch('/api/profiles/restore-photos/stop', { method: 'POST' });
                setRestoreStatus(prev => ({ ...prev, status: 'Stopping...' }));
                toast.success('Остановка восстановления...');
            } catch (err) {
                toast.error('Ошибка при остановке');
            }
            return;
        }
        try {
            const resp = await authFetch('/api/profiles/restore-photos', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ concurrency: settingsData.concurrentProfiles })
            });
            const data = await resp.json();
            if (data.success) {
                setRestoreStatus({ running: true, current: 0, total: 0, status: 'Starting...' });
                toast.success('Запущено восстановление фото');
            } else {
                toast.error(data.error || 'Ошибка запуска');
            }
        } catch (err) {
            toast.error('Ошибка сервера');
        }
    };

    useEffect(() => {
        if (!user || !token) return;
        const normalizedToken = (token === 'null' || token === 'undefined') ? null : token;
        if (!normalizedToken) return;

        const baseUrl = LOCAL_API_BASE; // Logs are on local server
        const eventSource = new EventSource(`${baseUrl}/api/logs?token=${normalizedToken}`);
        eventSource.onmessage = (e) => {
            const log = JSON.parse(e.data);
            setLogs(prev => [...prev.slice(-(LOG_BUFFER - 1)), log]);
        };
        return () => eventSource.close();
    }, [user, token]);

    const handleBotControl = useCallback(async (type, command) => {
        try {
            if (command === 'skip-donor') {
                await authFetch('/api/skip-donor', { method: 'POST' });
                return;
            }
            const res = await authFetch(`/api/bot/${command}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type })
            });
            if (res.ok) {
                fetchBotStatus();
            }
        } catch (e) {
            console.error('Bot control error', e);
        }
    }, [fetchBotStatus, authFetch]);

    const handleClearLogs = useCallback(async () => {
        try {
            const res = await authFetch('/api/logs/clear', { method: 'POST' });
            if (res.ok) {
                setLogs([]);
            }
        } catch (e) {
            console.error('Clear logs error', e);
        }
    }, [authFetch]);

    if (isLoading) return (
        <div className="loading-screen" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'hsl(var(--bg-deep))' }}>
            <div className="loading-spinner" />
        </div>
    );

    if (!user) {
        return (
            <div className="auth-wrapper">
                <div className="app-bg" />
                <AuthPage onLoginSuccess={handleLoginSuccess} tr={tr} />
                <Toaster position="bottom-right" toastOptions={{ className: 'toast-custom' }} />
            </div>
        );
    }

    return (
        <div className="body-wrapper">
            <div className="app-bg" />

            <div className="app-container">
                <header className="header">
                    <div className="header-title-group">
                        <div className="logo-container">IG</div>
                        <div>
                            <h1 className="brand-name">IG BOT PREMIER</h1>
                            <div className="stats-container">
                                <div className="stat-pill">
                                    <span className="stat-label">{tr('total_profiles')}</span>
                                    <span className="stat-value">{girls.length}</span>
                                </div>
                                <div className="stat-pill">
                                    <span className="stat-label">{tr('dm_sent')}</span>
                                    <span className="stat-value">{girls.filter(g => g.dmSent).length}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="actions-row">
                        <div className="user-badge" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 16px', background: 'hsla(0, 0%, 100%, 0.05)', borderRadius: 'var(--radius-md)' }}>
                            <span className="user-email" style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{user.email}</span>
                            <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={handleLogout}>{tr('btn_logout')}</button>
                        </div>
                        <button className="btn btn-secondary" style={{ width: '40px', padding: '0' }} onClick={toggleLang}>
                            {lang.toUpperCase()}
                        </button>
                    </div>
                </header>

                <nav className="nav-card">
                    <div className="tabs-group">
                        <button
                            className={`tab-trigger ${activeTab === 'main' ? 'active' : ''}`}
                            onClick={() => setActiveTab('main')}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                            {tr('tab_profiles')}
                        </button>
                        <button
                            className={`tab-trigger ${activeTab === 'controls' ? 'active' : ''}`}
                            onClick={() => setActiveTab('controls')}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
                            {tr('tab_execution')}
                        </button>
                        <button
                            className={`tab-trigger ${activeTab === 'settings' ? 'active' : ''}`}
                            onClick={() => setActiveTab('settings')}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                            {tr('tab_configuration')}
                        </button>
                    </div>

                    <div className="actions-row">
                        {activeTab === 'controls' && (
                            <div className="header-bot-configs" style={{ display: 'flex', gap: '16px', color: 'var(--text-dim)', fontSize: '13px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={settingsData.humanEmulation || false} onChange={e => onSettingsChange({ humanEmulation: e.target.checked })} />
                                    <span>{tr('human_emulation')}</span>
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={settingsData.showBrowser || false} onChange={e => onSettingsChange({ showBrowser: e.target.checked })} />
                                    <span>{tr('show_browser')}</span>
                                </label>
                            </div>
                        )}

                        <button className="btn btn-secondary"
                            style={{ padding: '8px 16px' }}
                            onClick={handleCheckAllTg} disabled={checkingAllTg}>
                            {checkingAllTg ? (<span className="loading-spinner-mini" />) : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>}
                            {checkingAllTg ? '...' : tr('btn_check_all_tg')}
                        </button>

                        <button className={`btn ${restoreStatus.running ? 'btn-danger' : 'btn-primary'}`}
                            onClick={handleRestorePhotos}>
                            {restoreStatus.running ? (<span className="loading-spinner-mini" />) : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>}
                            {restoreStatus.running
                                ? `${restoreStatus.current}/${restoreStatus.total} Stop`
                                : tr('btn_restore_photos')}
                        </button>

                        <button className="btn btn-secondary" style={{ padding: '8px 12px' }} onClick={fetchData}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                        </button>
                    </div>
                </nav>

                <main className="main-content fade-in-up" key={activeTab}>
                    {activeTab === 'main' && (
                        <ProfilesTab
                            girls={girls}
                            votes={votes}
                            tr={tr}
                            onVote={handleVote}
                            onDeleteProfile={handleDeleteProfile}
                            onSaveAsDonor={handleSaveAsDonor}
                            useProxyImages={settingsData.showBrowser}
                            isLoading={isLoading}
                            failedImages={failedImages}
                            onImageError={handleImageError}
                            onOpen={handleOpenProfile}
                            onSendDM={handleSendDM}
                            onTgCheck={handleTgCheck}
                            onRefresh={fetchData}
                            authFetch={authFetch}
                            token={token}
                            checkingAllTg={checkingAllTg}
                            onCheckAllTg={handleCheckAllTg}
                            restoreStatus={restoreStatus}
                            onRestorePhotos={handleRestorePhotos}
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
                            authFetch={authFetch}
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
                        />
                    )}
                </main>

                {modalOpen && (
                    <div className="modal-overlay" onClick={() => setModalOpen(false)}>
                        <div className="modal-card" onClick={e => e.stopPropagation()}>
                            <h2 style={{ fontSize: '24px', fontWeight: '700', marginBottom: '16px' }}>{tr('modal_send_dm')}</h2>
                            <textarea
                                className="text-input"
                                style={{ width: '100%', height: '140px', resize: 'none' }}
                                placeholder="Enter your message..."
                                value={messagesText}
                                onChange={e => setMessagesText(e.target.value)}
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '24px' }}>
                                <button className="btn btn-secondary" onClick={() => setModalOpen(false)}>
                                    {tr('btn_cancel')}
                                </button>
                                <button className="btn btn-primary" onClick={() => {
                                    toast.success('DM Sent (Demo)');
                                    setModalOpen(false);
                                }}>
                                    {tr('btn_send')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                <Toaster toastOptions={{ className: 'toast-custom' }} position="bottom-right" />
            </div>
        </div>
    );
}


