import { useState, useEffect, useCallback, useRef } from 'react';
import { t } from './i18n';
import { toast, Toaster } from 'react-hot-toast';
import ProfilesTab from './components/ProfilesTab';
import ControlsTab from './components/ControlsTab';
import SettingsTab from './components/SettingsTab';

const LOG_BUFFER = 200;

const safeStorage = {
    getItem: (key, def) => {
        try {
            return localStorage.getItem(key) || def;
        } catch (e) { return def; }
    },
    setItem: (key, val) => {
        try {
            localStorage.setItem(key, val);
        } catch (e) { }
    },
    parse: (key, def) => {
        try {
            const val = localStorage.getItem(key);
            return val ? JSON.parse(val) : def;
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

    useEffect(() => { safeStorage.setItem('ig_active_tab', activeTab); }, [activeTab]);

    const settingsLoaded = useRef(false);
    const pendingSave = useRef(false);
    const saveAbortRef = useRef(null);

    const fetchData = useCallback(async () => {
        try {
            const [girlsRes, votesRes] = await Promise.all([
                fetch('/api/girls', { cache: 'no-store' }),
                fetch('/api/votes', { cache: 'no-store' })
            ]);
            const girlsData = await girlsRes.json();
            const votesData = await votesRes.json();
            const viewedArr = safeStorage.parse('ig_viewed_profiles', []);
            const sentArr = safeStorage.parse('ig_sent_dm', []);

            girlsData.forEach(g => {
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
    }, []);

    const fetchBotStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/bot/status');
            const data = await res.json();
            setBotStatus(data);
        } catch (e) { }
    }, []);

    useEffect(() => {
        fetchData();
        fetchSettings();
        fetchBotStatus();
        const interval = setInterval(fetchBotStatus, 5000);
        return () => clearInterval(interval);
    }, [fetchData, fetchSettings, fetchBotStatus]);

    useEffect(() => {
        if (!settingsLoaded.current) return;
        setSaveStatus('saving');
        const timer = setTimeout(() => {
            if (saveAbortRef.current) saveAbortRef.current.abort();
            if (pendingSave.current) {
                const controller = new AbortController();
                saveAbortRef.current = controller;
                fetch('/api/settings', {
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
    }, [settingsData]);

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
            const res = await fetch('/api/vote', {
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
            const res = await fetch('/api/profiles/delete', {
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
            const res = await fetch('/api/donors', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await res.json();
            if (data.success) {
                toast.success(tr('preset_saved') || 'Saved as donor');
                // Refresh settings to update donor list in filters
                fetchSettings();
            } else {
                toast.error(data.error || 'Error saving donor');
            }
        } catch (e) {
            console.error('Save as donor error', e);
            toast.error('Network error');
        }
    };

    useEffect(() => {
        const eventSource = new EventSource('/api/logs');
        eventSource.onmessage = (e) => {
            const log = JSON.parse(e.data);
            setLogs(prev => [...prev.slice(-(LOG_BUFFER - 1)), log]);
        };
        return () => eventSource.close();
    }, []);

    const handleBotControl = useCallback(async (type, command) => {
        try {
            if (command === 'skip-donor') {
                await fetch('/api/skip-donor', { method: 'POST' });
                return;
            }
            const res = await fetch(`/api/bot/${command}`, {
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
    }, [fetchBotStatus]);

    const handleClearLogs = useCallback(async () => {
        try {
            const res = await fetch('/api/logs/clear', { method: 'POST' });
            if (res.ok) {
                setLogs([]);
            }
        } catch (e) {
            console.error('Clear logs error', e);
        }
    }, []);

    if (isLoading) return <div className="loading">Loading...</div>;

    return (
        <div className="app">
            <header className="header">
                <div className="logo-section">
                    <div className="logo">{tr('logo')}</div>
                    <div className="header-stats">
                        <div className="stat-item">
                            <span className="stat-label">{tr('tab_profiles')}:</span>
                            <span className="stat-value">{girls.length}</span>
                        </div>
                        <div className="stat-divider" />
                        <div className="stat-item">
                            <span className="stat-label">{tr('likes')}:</span>
                            <span className="stat-value">{Object.values(votes).filter(v => v === 'like').length}</span>
                        </div>
                        <div className="stat-divider" />
                        <div className="stat-item">
                            <span className="stat-label">{tr('dm_sent')}:</span>
                            <span className="stat-value">{girls.filter(g => g.dmSent).length}</span>
                        </div>
                    </div>
                </div>
                <div className="header-actions">
                    <button className="lang-toggle-btn" onClick={toggleLang}>{lang.toUpperCase()}</button>
                </div>
            </header>

            <div className="nav-bar">
                <div className="tabs-nav">
                    <button className={`tab-btn ${activeTab === 'main' ? 'active' : ''}`} onClick={() => setActiveTab('main')}>{tr('tab_profiles')}</button>
                    <button className={`tab-btn ${activeTab === 'controls' ? 'active' : ''}`} onClick={() => setActiveTab('controls')}>{tr('tab_execution')}</button>
                    <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>{tr('tab_configuration')}</button>
                </div>
                <div className="nav-right-group">
                    {activeTab === 'controls' && (
                        <div className="header-bot-configs">
                            <label className="header-checkbox">
                                <input type="checkbox" checked={settingsData.humanEmulation || false} onChange={e => onSettingsChange({ humanEmulation: e.target.checked })} />
                                <span>{tr('human_emulation')}</span>
                            </label>
                            <label className="header-checkbox">
                                <input type="checkbox" checked={settingsData.showBrowser || false} onChange={e => onSettingsChange({ showBrowser: e.target.checked })} />
                                <span>{tr('show_browser')}</span>
                            </label>
                            <label className="header-number-input">
                                <span>{tr('concurrent_profiles')}</span>
                                <input type="number" min="1" max="20" value={settingsData.concurrentProfiles || 3} onChange={e => onSettingsChange({ concurrentProfiles: parseInt(e.target.value) || 1 })} />
                            </label>
                        </div>
                    )}
                    <button className="btn-primary update-btn" onClick={fetchData}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                        </svg>
                        {tr('btn_update')}
                    </button>
                </div>
            </div>

            <main className="content content-fade" key={activeTab}>
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
                {activeTab === 'settings' && <SettingsTab settingsData={settingsData} onSettingsChange={onSettingsChange} tr={tr} isLoading={isLoading} />}
            </main>

            {
                modalOpen && (
                    <div className="modal" onClick={() => setModalOpen(false)}>
                        <div className="modalContent" onClick={e => e.stopPropagation()}>
                            <h2>{tr('modal_send_dm')}</h2>
                            <textarea
                                className="select-input"
                                style={{ width: '100%', height: '120px', padding: '12px', marginTop: '16px', resize: 'none' }}
                                value={messagesText}
                                onChange={e => setMessagesText(e.target.value)}
                            />
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '20px' }}>
                                <button className="btn-primary" style={{ background: 'hsl(var(--text-dim))' }} onClick={() => setModalOpen(false)}>
                                    {tr('btn_cancel')}
                                </button>
                                <button className="btn-primary" onClick={() => {
                                    toast.success('DM Sent (Demo)');
                                    setModalOpen(false);
                                }}>
                                    {tr('btn_send')}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
            <Toaster position="bottom-right" />
        </div >
    );
}
