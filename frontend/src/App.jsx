import { useState, useEffect, useCallback } from 'react'
import { t } from './i18n.js'
import ProfilesTab from './components/ProfilesTab.jsx'
import ControlsTab from './components/ControlsTab.jsx'
import SettingsTab from './components/SettingsTab.jsx'

const LANG = localStorage.getItem('ig_lang') || 'ru'
const tr = (key) => t(LANG, key)

const LOG_BUFFER = 200

export default function App() {
    const [girls, setGirls] = useState([])
    const [votes, setVotes] = useState({})
    const [viewed, setViewed] = useState(() => JSON.parse(localStorage.getItem('ig_viewed_profiles') || '[]'))
    const [sentDM, setSentDM] = useState(() => JSON.parse(localStorage.getItem('ig_sent_dm') || '[]'))
    const [failedImages, setFailedImages] = useState(new Set())
    const [modalOpen, setModalOpen] = useState(false)
    const [messagesText, setMessagesText] = useState('')
    const [settingsData, setSettingsData] = useState({
        accounts: [], activeParserAccountId: null, activeServerAccountId: null, activeIndexAccountId: null, activeProfilesAccountId: null,
        names: [], cities: [], niches: []
    })
    const [botStatus, setBotStatus] = useState({ index: false, parser: false })
    const [logs, setLogs] = useState([])
    const [activeTab, setActiveTab] = useState(() => localStorage.getItem('ig_active_tab') || 'main')
    const [isLoading, setIsLoading] = useState(true)

    // Persist active tab
    useEffect(() => { localStorage.setItem('ig_active_tab', activeTab) }, [activeTab])

    // Fetch profiles + votes
    const fetchData = useCallback(async () => {
        try {
            const [girlsRes, votesRes] = await Promise.all([
                fetch('/api/girls', { cache: 'no-store' }),
                fetch('/api/votes', { cache: 'no-store' })
            ])
            const girlsData = await girlsRes.json()
            const votesData = await votesRes.json()
            const viewedArr = JSON.parse(localStorage.getItem('ig_viewed_profiles') || '[]')
            const sentArr = JSON.parse(localStorage.getItem('ig_sent_dm') || '[]')
            girlsData.forEach(g => {
                g.viewed = viewedArr.includes(g.url)
                g.dmSent = sentArr.includes(g.url)
            })
            setGirls(girlsData)
            setVotes(votesData)
        } catch (e) { console.error('Error loading data', e) }
    }, [])

    const fetchSettings = useCallback(async () => {
        try {
            const res = await fetch('/api/settings')
            const data = await res.json()
            setSettingsData({
                accounts: data.accounts || [],
                activeParserAccountId: data.activeParserAccountId || null,
                activeServerAccountId: data.activeServerAccountId || null,
                activeIndexAccountId: data.activeIndexAccountId || null,
                activeProfilesAccountId: data.activeProfilesAccountId || null,
                names: data.names || [],
                cities: data.cities || [],
                niches: data.niches || []
            })
        } catch (e) { console.error('Error fetching settings', e) }
    }, [])

    const fetchBotStatus = useCallback(async () => {
        try {
            const res = await fetch('/api/bot/status')
            const data = await res.json()
            setBotStatus(data)
        } catch (e) { }
    }, [])

    // Initial data load + SSE
    useEffect(() => {
        fetchData()
        fetchSettings()
        fetchBotStatus()

        const saved = JSON.parse(localStorage.getItem('ig_first_messages') || '[]')
        setMessagesText(saved.join('\n'))

        // SSE log stream
        const es = new EventSource('/api/logs')
        let initialBurst = true
        const burstTimer = setTimeout(() => { initialBurst = false }, 1500)

        es.onmessage = (ev) => {
            const log = JSON.parse(ev.data)
            const entry = { ...log, id: Math.random().toString(36).slice(2, 9) }
            if (initialBurst) {
                // Bulk-load history without animation
                setLogs(prev => [...prev, entry].slice(-LOG_BUFFER))
            } else {
                setLogs(prev => [...prev, entry].slice(-LOG_BUFFER))
            }
        }

        // Poll bot status every 10s (instead of 3s)
        const statusInterval = setInterval(fetchBotStatus, 10000)

        // Remove loader after a tick (no artificial delay)
        const loaderTimer = setTimeout(() => setIsLoading(false), 600)

        return () => {
            es.close()
            clearInterval(statusInterval)
            clearTimeout(burstTimer)
            clearTimeout(loaderTimer)
        }
    }, [])

    // Actions
    const handleVote = useCallback(async (g, status) => {
        setVotes(prev => ({ ...prev, [g.url]: status }))
        setGirls(prev => prev.map(p => p.url === g.url ? { ...p, status } : p))
        fetch('/api/vote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: g.url, status })
        })
    }, [])

    const handleOpen = useCallback(async (g) => {
        if (!viewed.includes(g.url)) {
            const newV = [...viewed, g.url]
            setViewed(newV)
            localStorage.setItem('ig_viewed_profiles', JSON.stringify(newV))
            setGirls(prev => prev.map(p => p.url === g.url ? { ...p, viewed: true } : p))
        }
        fetch('/api/view', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: g.url })
        })
        window.open(g.url, '_blank')
    }, [viewed])

    const handleSendDM = useCallback(async (g) => {
        const msgs = JSON.parse(localStorage.getItem('ig_first_messages') || '[]')
        const m = msgs[Math.floor(Math.random() * msgs.length)] || 'Hello!'
        const newSent = [...sentDM, g.url]
        setSentDM(newSent)
        localStorage.setItem('ig_sent_dm', JSON.stringify(newSent))
        setGirls(prev => prev.map(p => p.url === g.url ? { ...p, dmSent: true } : p))
        fetch('/api/dm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: g.url, message: m })
        })
    }, [sentDM])

    const handleImageError = useCallback((url) => {
        setFailedImages(prev => new Set([...prev, url]))
    }, [])

    const handleBotControl = useCallback(async (type, action) => {
        await fetch(`/api/bot/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type })
        })
        fetchBotStatus()
    }, [fetchBotStatus])

    const handleSaveSettings = useCallback(async () => {
        await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settingsData)
        })
    }, [settingsData])

    // Header stats (memoized-ish via inline)
    const unopenedCount = girls.filter(g => !g.viewed).length
    const likesCount = Object.values(votes).filter(v => v === 'like').length

    return (
        <div className="app">
            {isLoading && (
                <div className="loader-overlay">
                    <div className="loader-ring" />
                    <div className="loader-text">InstaPanel • LOADING</div>
                </div>
            )}

            <header className="header">
                <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    <div className="logo">{tr('logo')}</div>
                    <div className="stats">
                        <span>{tr('unopened')} <b>{unopenedCount}</b></span>
                        <span>{tr('viewed')} <b>{viewed.length}</b></span>
                        <span>{tr('dm_sent')} <b style={{ color: 'var(--accent)' }}>{sentDM.length}</b></span>
                        <div className="stats-divider" />
                        <span>{tr('likes')} <b style={{ color: 'var(--success)' }}>{likesCount}</b></span>
                    </div>
                </div>
                <button className="btn-primary" onClick={() => setModalOpen(true)}>
                    {tr('templates')}
                </button>
            </header>

            <nav className="tabs-nav" style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex' }}>
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
                    style={{ marginLeft: 'auto', background: '#2196F3', borderColor: '#2196F3', color: '#fff' }}
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
                    useProxyImages={!!settingsData.activeProfilesAccountId}
                    tr={tr}
                />
            )}

            {activeTab === 'controls' && (
                <ControlsTab
                    botStatus={botStatus}
                    onBotControl={handleBotControl}
                    logs={logs}
                    tr={tr}
                />
            )}

            {activeTab === 'settings' && (
                <SettingsTab
                    settingsData={settingsData}
                    onSettingsChange={setSettingsData}
                    onSave={handleSaveSettings}
                    tr={tr}
                />
            )}

            {modalOpen && (
                <div className="modal" onClick={() => setModalOpen(false)}>
                    <div className="modalContent" onClick={e => e.stopPropagation()}>
                        <h3 style={{ margin: 0, marginBottom: 18, color: '#fff' }}>{tr('modal_templates_title')}</h3>
                        <textarea
                            className="msg-textarea"
                            value={messagesText}
                            onChange={e => setMessagesText(e.target.value)}
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
                            <button className="btn-primary" onClick={() => {
                                localStorage.setItem('ig_first_messages', JSON.stringify(messagesText.split('\n').filter(l => l.trim())))
                                setModalOpen(false)
                            }}>
                                {tr('save_changes')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
