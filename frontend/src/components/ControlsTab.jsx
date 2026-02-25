import { useState, useEffect, useRef, memo } from 'react'
import { FileIcon } from './Icons.jsx'

const LogGroup = memo(function LogGroup({ group, tr }) {
    const [collapsed, setCollapsed] = useState(false)
    const source = group.source.split('-')[0].toUpperCase()
    const time = group.timestamp ? group.timestamp.split('T')[1].split('.')[0] : ''

    return (
        <div className={`log-group${collapsed ? ' collapsed' : ''}`}>
            <div className="log-group-header" onClick={() => setCollapsed(c => !c)}>
                <div className="group-info">
                    <span className={`log-source source-${group.source.split('-')[0]}`}>{source}</span>
                    <span className="log-time">{time}</span>
                    <span className="group-label">{tr('batch_entries').replace('{count}', group.logs.length)}</span>
                </div>
                <div className="group-toggle">{collapsed ? '+' : '−'}</div>
            </div>
            {!collapsed && (
                <div className="log-group-content">
                    {group.logs.map((log, i) => (
                        <div className="log-entry" key={log.id || i}>
                            <div className="log-time">{log.timestamp.split('T')[1].split('.')[0]}</div>
                            <div className="log-message">{log.message}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
})

const useCollapsed = (key, defaultVal = false) => {
    const [collapsed, setCollapsed] = useState(() => {
        try {
            const item = localStorage.getItem(key)
            return item ? JSON.parse(item) : defaultVal
        } catch {
            return defaultVal
        }
    })
    useEffect(() => {
        localStorage.setItem(key, JSON.stringify(collapsed))
    }, [key, collapsed])
    return [collapsed, () => setCollapsed(c => !c)]
}

const SkeletonControls = memo(function SkeletonControls() {
    return (
        <div className="controls-panel">
            <div className="control-card">
                <div className="skeleton skeleton-line" style={{ width: '40%' }} />
                <div className="skeleton skeleton-line" style={{ height: 60 }} />
                <div className="skeleton skeleton-btn" style={{ width: 120 }} />
            </div>
            <div className="control-card">
                <div className="skeleton skeleton-line" style={{ width: '40%' }} />
                <div className="skeleton skeleton-line" style={{ height: 60 }} />
                <div className="skeleton skeleton-btn" style={{ width: 120 }} />
            </div>
            <div className="control-card logs-card" style={{ height: 400 }}>
                <div className="skeleton" style={{ height: '100%' }} />
            </div>
            <div className="stream-card" style={{ height: 400 }}>
                <div className="skeleton" style={{ height: '100%' }} />
            </div>
        </div>
    )
})

export default function ControlsTab({ botStatus, onBotControl, onClearLogs, logs, tr, isLoading }) {
    const logBoxRef = useRef(null)
    const [scraperCollapsed, toggleScraper] = useCollapsed('ig_scraper_collapsed', false)
    const [parserCollapsed, toggleParser] = useCollapsed('ig_parser_collapsed', false)
    const [logsCollapsed, toggleLogs] = useCollapsed('ig_logs_collapsed', false)
    const [streamCollapsed, toggleStream] = useCollapsed('ig_stream_collapsed', false)
    const [liveViewTimestamp, setLiveViewTimestamp] = useState(Date.now())
    const [isZoomed, setIsZoomed] = useState(false)

    useEffect(() => {
        const interval = setInterval(() => {
            setLiveViewTimestamp(Date.now())
        }, 2000)
        return () => clearInterval(interval)
    }, [])

    // Group logs by session+source
    const groups = []
    let current = null
    for (const log of logs) {
        if (!current || current.sessionId !== log.sessionId || current.source !== log.source) {
            current = { sessionId: log.sessionId, source: log.source, timestamp: log.timestamp, logs: [] }
            groups.push(current)
        }
        current.logs.push(log)
    }

    useEffect(() => {
        const el = logBoxRef.current
        if (el) {
            requestAnimationFrame(() => { el.scrollTop = el.scrollHeight })
        }
    }, [logs])

    if (isLoading) return <SkeletonControls />

    return (
        <div className="controls-panel tab-content-fade">

            {/* Scraper card */}
            <div className="control-card">
                <h3 style={{ margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={toggleScraper}>
                    {tr('scraper_title')}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div className={`status-dot${botStatus.index ? ' active' : ''}`} />
                        <span style={{ color: 'hsl(var(--text-muted))', fontSize: '14px' }}>{scraperCollapsed ? '▼' : '▲'}</span>
                    </div>
                </h3>
                {!scraperCollapsed && (
                    <div style={{ marginTop: 12 }}>
                        <p style={{ fontSize: 14, color: 'hsl(var(--text-muted))', margin: '0 0 12px 0' }}>{tr('scraper_desc')}</p>
                        {botStatus.index
                            ? (
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    <button className="btn-primary" style={{ background: 'hsl(var(--danger))', boxShadow: 'none' }} onClick={() => onBotControl('index', 'stop')}>{tr('btn_stop_scraper')}</button>
                                    <button
                                        className="btn-primary"
                                        style={{ background: 'hsl(var(--warning))', boxShadow: 'none' }}
                                        onClick={async (e) => {
                                            const btn = e.currentTarget;
                                            const originalText = btn.innerText;
                                            btn.innerText = '⌛...';
                                            btn.style.opacity = '0.7';
                                            btn.disabled = true;
                                            await onBotControl('index', 'skip-donor');
                                            btn.innerText = '✅';
                                            setTimeout(() => {
                                                btn.innerText = originalText;
                                                btn.style.opacity = '1';
                                                btn.disabled = false;
                                            }, 2000);
                                        }}
                                    >
                                        {tr('btn_skip_donor')}
                                    </button>
                                </div>
                            )
                            : <button className="btn-primary" onClick={() => onBotControl('index', 'start')}>{tr('btn_start_scraper')}</button>
                        }
                    </div>
                )}
            </div>

            {/* Parser card */}
            <div className="control-card">
                <h3 style={{ margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={toggleParser}>
                    {tr('parser_title')}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div className={`status-dot${botStatus.parser ? ' active' : ''}`} />
                        <span style={{ color: 'hsl(var(--text-muted))', fontSize: '14px' }}>{parserCollapsed ? '▼' : '▲'}</span>
                    </div>
                </h3>
                {!parserCollapsed && (
                    <div style={{ marginTop: 12 }}>
                        <p style={{ fontSize: 14, color: 'hsl(var(--text-muted))', margin: '0 0 12px 0' }}>{tr('parser_desc')}</p>
                        {botStatus.parser
                            ? <button className="btn-primary" style={{ background: 'hsl(var(--danger))', boxShadow: 'none' }} onClick={() => onBotControl('parser', 'stop')}>{tr('btn_stop_parser')}</button>
                            : <button className="btn-primary" onClick={() => onBotControl('parser', 'start')}>{tr('btn_start_parser')}</button>
                        }
                    </div>
                )}
            </div>

            {/* Logs card */}
            <div className={`control-card logs-card${logsCollapsed ? ' collapsed' : ''}`}>
                <div className="logs-header" style={{ marginBottom: logsCollapsed ? 0 : 12 }}>
                    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }} onClick={toggleLogs}>
                        <FileIcon /> {tr('tab_logs')}
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button
                            className="btn-primary"
                            style={{
                                padding: '4px 12px',
                                fontSize: '12px',
                                background: 'transparent',
                                borderColor: 'hsla(var(--border), 0.5)',
                                color: 'hsl(var(--text-muted))',
                                height: 'auto'
                            }}
                            onClick={(e) => {
                                e.stopPropagation();
                                onClearLogs();
                            }}
                        >
                            {tr('btn_clear')}
                        </button>
                        <div className="badge viewedTag" style={{ background: 'hsla(var(--success), 0.1)', color: 'hsl(var(--success))', borderColor: 'hsla(var(--success), 0.2)' }}>Live</div>
                        <span style={{ color: 'hsl(var(--text-muted))', fontSize: '14px', cursor: 'pointer' }} onClick={toggleLogs}>{logsCollapsed ? '▼' : '▲'}</span>
                    </div>
                </div>
                {!logsCollapsed && (
                    <div
                        ref={logBoxRef}
                        id="log-box"
                        className="logs-container"
                    >
                        {groups.length === 0 && (
                            <div style={{ color: 'hsl(var(--text-dim))', textAlign: 'center', padding: '40px' }}>{tr('no_logs')}</div>
                        )}
                        {groups.map((group, idx) => (
                            <LogGroup key={group.sessionId + group.source + idx} group={group} tr={tr} />
                        ))}
                        {logs.length > 0 && <span className="terminal-cursor" style={{ marginLeft: 18, background: 'hsl(var(--primary))' }} />}
                    </div>
                )}
            </div>

            {/* Stream card */}
            <div className={`stream-card${streamCollapsed ? ' collapsed' : ''}`}>
                <div className="logs-header" style={{ marginBottom: streamCollapsed ? 0 : 0, cursor: 'pointer' }} onClick={toggleStream}>
                    <h3 style={{ margin: 0 }}>{tr('live_view')}</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div className={`status-dot${botStatus.index || botStatus.parser ? ' active' : ''}`} />
                        <span style={{ color: 'hsl(var(--text-muted))', fontSize: '14px' }}>{streamCollapsed ? '▼' : '▲'}</span>
                    </div>
                </div>
                {!streamCollapsed && (
                    <div className="stream-container" onClick={() => setIsZoomed(true)}>
                        <img
                            src={`/api/live-view?t=${liveViewTimestamp}`}
                            style={{ display: (botStatus.index || botStatus.parser) ? 'block' : 'none' }}
                            alt="Live View"
                            onError={(e) => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'block'; }}
                            onLoad={(e) => { e.target.style.display = 'block'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'none'; }}
                        />
                        <div style={{ color: 'hsl(var(--text-dim))', fontFamily: 'monospace', fontSize: '12px', padding: 20, textAlign: 'center' }}>
                            {(botStatus.index || botStatus.parser) ? tr('waiting_stream') : tr('browser_not_started')}
                        </div>
                    </div>
                )}
            </div>

            {/* Fullscreen Popup */}
            {isZoomed && (
                <div className="stream-overlay-full" onClick={() => setIsZoomed(false)}>
                    <img
                        src={`/api/live-view?t=${liveViewTimestamp}`}
                        alt="Live View Full"
                    />
                </div>
            )}
        </div>
    )
}
