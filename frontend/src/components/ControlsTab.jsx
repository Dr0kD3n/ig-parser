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
            {/* Scraper card */}
            <div className="control-card">
                <h3>
                    {tr('scraper_title')}
                    <div className={`status-dot${botStatus.index ? ' active' : ''}`} />
                </h3>
                <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>{tr('scraper_desc')}</p>
                {botStatus.index
                    ? <button className="btn-primary btn-stop" onClick={() => onBotControl('index', 'stop')}>{tr('btn_stop_scraper')}</button>
                    : <button className="btn-primary" onClick={() => onBotControl('index', 'start')}>{tr('btn_start_scraper')}</button>
                }
            </div>

            {/* Parser card */}
            <div className="control-card">
                <h3>
                    {tr('parser_title')}
                    <div className={`status-dot${botStatus.parser ? ' active' : ''}`} />
                </h3>
                <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>{tr('parser_desc')}</p>
                {botStatus.parser
                    ? <button className="btn-primary btn-stop" onClick={() => onBotControl('parser', 'stop')}>{tr('btn_stop_parser')}</button>
                    : <button className="btn-primary" onClick={() => onBotControl('parser', 'start')}>{tr('btn_start_parser')}</button>
                }
            </div>

            {/* Logs card */}
            <div className="control-card logs-card">
                <div className="logs-header">
                    <h3><FileIcon /> {tr('tab_logs') || 'Логи (SSE)'}</h3>
                    <div className="badge viewedTag" style={{ textTransform: 'none', background: 'rgba(255,255,255,0.05)' }}>Live</div>
                </div>
                <div
                    ref={logBoxRef}
                    id="log-box"
                    className="logs-container"
                    style={{ margin: 0, height: '100%', borderRadius: 0, border: 'none', background: 'transparent', boxShadow: 'none' }}
                >
                    {groups.length === 0 && (
                        <div style={{ color: '#444', textAlign: 'center', padding: '40px' }}>{tr('no_logs')}</div>
                    )}
                    {groups.map((group, idx) => (
                        <LogGroup key={group.sessionId + group.source + idx} group={group} />
                    ))}
                    {logs.length > 0 && <span className="terminal-cursor" style={{ marginLeft: 18 }} />}
                </div>
            </div>
        </div>
    )
}
