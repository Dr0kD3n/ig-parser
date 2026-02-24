import { useState, useEffect, useRef, memo } from 'react'
import { FileIcon } from './Icons.jsx'

const LogGroup = memo(function LogGroup({ group }) {
    const [collapsed, setCollapsed] = useState(false)
    const source = group.source.split('-')[0].toUpperCase()
    const time = group.timestamp ? group.timestamp.split('T')[1].split('.')[0] : ''

    return (
        <div className={`log-group${collapsed ? ' collapsed' : ''}`}>
            <div className="log-group-header" onClick={() => setCollapsed(c => !c)}>
                <div className="group-info">
                    <span className={`log-source source-${group.source.split('-')[0]}`}>{source}</span>
                    <span className="log-time">{time}</span>
                    <span className="group-label">BATCH • {group.logs.length} entries</span>
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

export default function ControlsTab({ botStatus, onBotControl, logs, tr }) {
    const logBoxRef = useRef(null)
    const [liveViewTimestamp, setLiveViewTimestamp] = useState(Date.now())

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

    return (
        <div className="controls-panel tab-content-fade">
            {/* Live View */}
            <div className="control-card" style={{ gridColumn: '1 / -1' }}>
                <div className="logs-header" style={{ background: 'transparent', padding: 0, marginBottom: 12 }}>
                    <h3 style={{ margin: 0 }}>Прямой эфир (Live View)</h3>
                    <div className={`status-dot${botStatus.index || botStatus.parser ? ' active' : ''}`} />
                </div>
                <div style={{
                    flex: 1, minHeight: 400, background: '#000',
                    borderRadius: 'var(--radius)', overflow: 'hidden', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', border: '1px solid hsl(var(--border))'
                }}>
                    <img
                        src={`/api/live-view?t=${liveViewTimestamp}`}
                        style={{ maxWidth: '100%', maxHeight: 600, objectFit: 'contain', display: (botStatus.index || botStatus.parser) ? 'block' : 'none' }}
                        alt="Live View"
                        onError={(e) => { e.target.style.display = 'none'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'block'; }}
                        onLoad={(e) => { e.target.style.display = 'block'; if (e.target.nextSibling) e.target.nextSibling.style.display = 'none'; }}
                    />
                    <div style={{ color: 'hsl(var(--text-dim))', fontFamily: 'monospace', fontSize: '13px' }}>
                        {(botStatus.index || botStatus.parser) ? 'Ожидание трансляции...' : 'Браузер не запущен'}
                    </div>
                </div>
            </div>

            {/* Scraper card */}
            <div className="control-card">
                <h3 style={{ margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {tr('scraper_title')}
                    <div className={`status-dot${botStatus.index ? ' active' : ''}`} />
                </h3>
                <p style={{ fontSize: 14, color: 'hsl(var(--text-muted))', margin: 0 }}>{tr('scraper_desc')}</p>
                {botStatus.index
                    ? (
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button className="btn-primary" style={{ background: 'hsl(var(--danger))', boxShadow: 'none' }} onClick={() => onBotControl('index', 'stop')}>{tr('btn_stop_scraper')}</button>
                            <button className="btn-primary" style={{ background: 'hsl(var(--warning))', boxShadow: 'none' }} onClick={() => onBotControl('index', 'skip-donor')}>{tr('btn_skip_donor')}</button>
                        </div>
                    )
                    : <button className="btn-primary" onClick={() => onBotControl('index', 'start')}>{tr('btn_start_scraper')}</button>
                }
            </div>

            {/* Parser card */}
            <div className="control-card">
                <h3 style={{ margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {tr('parser_title')}
                    <div className={`status-dot${botStatus.parser ? ' active' : ''}`} />
                </h3>
                <p style={{ fontSize: 14, color: 'hsl(var(--text-muted))', margin: 0 }}>{tr('parser_desc')}</p>
                {botStatus.parser
                    ? <button className="btn-primary" style={{ background: 'hsl(var(--danger))', boxShadow: 'none' }} onClick={() => onBotControl('parser', 'stop')}>{tr('btn_stop_parser')}</button>
                    : <button className="btn-primary" onClick={() => onBotControl('parser', 'start')}>{tr('btn_start_parser')}</button>
                }
            </div>

            {/* Logs card */}
            <div className="control-card logs-card">
                <div className="logs-header">
                    <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}><FileIcon /> {tr('tab_logs') || 'Логи (SSE)'}</h3>
                    <div className="badge viewedTag" style={{ background: 'hsla(var(--success), 0.1)', color: 'hsl(var(--success))', borderColor: 'hsla(var(--success), 0.2)' }}>Live</div>
                </div>
                <div
                    ref={logBoxRef}
                    id="log-box"
                    className="logs-container"
                >
                    {groups.length === 0 && (
                        <div style={{ color: 'hsl(var(--text-dim))', textAlign: 'center', padding: '40px' }}>{tr('no_logs')}</div>
                    )}
                    {groups.map((group, idx) => (
                        <LogGroup key={group.sessionId + group.source + idx} group={group} />
                    ))}
                    {logs.length > 0 && <span className="terminal-cursor" style={{ marginLeft: 18, background: 'hsl(var(--primary))' }} />}
                </div>
            </div>
        </div>
    )
}
