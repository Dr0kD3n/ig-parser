import React, { useState, useEffect, useRef } from 'react';
import { LOCAL_API_BASE } from '../config';

function LogGroup({ group, tr }) {
    return (
        <div style={{ marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: 'var(--text-dim)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                <span style={{ color: 'hsl(var(--primary))', fontWeight: '700' }}>[{group.source}]</span>
                <span>•</span>
                <span>{new Date(group.timestamp).toLocaleTimeString()}</span>
                <span>•</span>
                <span>ID: {group.sessionId.slice(-6)}</span>
            </div>
            {group.logs.map((log, idx) => (
                <div key={idx} className={`log-entry ${log.level || 'info'}`} style={{ marginLeft: '12px' }}>
                    {log.message}
                </div>
            ))}
        </div>
    );
}

function SkeletonControls() {
    return (
        <div className="tab-container" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <div className="profile-card" style={{ height: '200px', animation: 'pulse 1.5s infinite' }} />
            <div className="profile-card" style={{ height: '200px', animation: 'pulse 1.5s infinite' }} />
        </div>
    );
}

export default function ControlsTab({ botStatus, onBotControl, onClearLogs, logs, tr, isLoading, token }) {
    const [scraperCollapsed, setScraperCollapsed] = useState(false);
    const [parserCollapsed, setParserCollapsed] = useState(false);
    const [logsCollapsed, setLogsCollapsed] = useState(false);
    const [streamCollapsed, setStreamCollapsed] = useState(false);
    const [isZoomed, setIsZoomed] = useState(false);
    const [liveViewTimestamp, setLiveViewTimestamp] = useState(Date.now());
    const logBoxRef = useRef(null);

    useEffect(() => {
        const interval = setInterval(() => {
            if (botStatus.index || botStatus.parser) {
                setLiveViewTimestamp(Date.now());
            }
        }, 3000);
        return () => clearInterval(interval);
    }, [botStatus.index, botStatus.parser]);

    useEffect(() => {
        if (logBoxRef.current) {
            logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
        }
    }, [logs]);

    const groups = [];
    let current = null;
    for (const log of logs) {
        if (!current || current.sessionId !== log.sessionId || current.source !== log.source) {
            current = { sessionId: log.sessionId, source: log.source, timestamp: log.timestamp, logs: [] };
            groups.push(current);
        }
        current.logs.push(log);
    }

    if (isLoading) return <SkeletonControls />;

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 400px', gap: '24px', alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Scraper Control */}
                <div className="profile-card" style={{ padding: '0', overflow: 'hidden' }}>
                    <div style={{ padding: '24px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ fontFamily: 'Space Grotesk', fontSize: '20px', fontWeight: '700' }}>{tr('scraper_title')}</h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div className={`status-dot ${botStatus.index ? 'active' : ''}`} style={{ width: '10px', height: '10px', borderRadius: '50%', background: botStatus.index ? 'hsl(var(--success))' : 'hsl(var(--text-dark))', boxShadow: botStatus.index ? '0 0 12px hsl(var(--success))' : 'none' }} />
                                <span style={{ fontSize: '12px', fontWeight: '600', color: botStatus.index ? 'hsl(var(--success))' : 'var(--text-dim)' }}>
                                    {botStatus.index ? 'RUNNING' : 'IDLE'}
                                </span>
                            </div>
                        </div>
                        <p style={{ color: 'var(--text-dim)', fontSize: '13px', marginTop: '8px' }}>{tr('scraper_desc')}</p>
                    </div>
                    <div style={{ padding: '20px', background: 'hsla(0, 0%, 100%, 0.02)', display: 'flex', gap: '12px' }}>
                        {botStatus.index ? (
                            <>
                                <button className="btn btn-primary" style={{ background: 'hsl(var(--danger))' }} onClick={() => onBotControl('index', 'stop')}>{tr('btn_stop_scraper')}</button>
                                <button className="btn btn-secondary" onClick={() => onBotControl('index', 'skip-donor')}>{tr('btn_skip_donor')}</button>
                            </>
                        ) : (
                            <button className="btn btn-primary" onClick={() => onBotControl('index', 'start')}>{tr('btn_start_scraper')}</button>
                        )}
                    </div>
                </div>

                {/* Parser Control */}
                <div className="profile-card" style={{ padding: '0', overflow: 'hidden' }}>
                    <div style={{ padding: '24px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ fontFamily: 'Space Grotesk', fontSize: '20px', fontWeight: '700' }}>{tr('parser_title')}</h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div className={`status-dot ${botStatus.parser ? 'active' : ''}`} style={{ width: '10px', height: '10px', borderRadius: '50%', background: botStatus.parser ? 'hsl(var(--success))' : 'hsl(var(--text-dark))', boxShadow: botStatus.parser ? '0 0 12px hsl(var(--success))' : 'none' }} />
                                <span style={{ fontSize: '12px', fontWeight: '600', color: botStatus.parser ? 'hsl(var(--success))' : 'var(--text-dim)' }}>
                                    {botStatus.parser ? 'RUNNING' : 'IDLE'}
                                </span>
                            </div>
                        </div>
                        <p style={{ color: 'var(--text-dim)', fontSize: '13px', marginTop: '8px' }}>{tr('parser_desc')}</p>
                    </div>
                    <div style={{ padding: '20px', background: 'hsla(0, 0%, 100%, 0.02)', display: 'flex', gap: '12px' }}>
                        {botStatus.parser ? (
                            <button className="btn btn-primary" style={{ background: 'hsl(var(--danger))' }} onClick={() => onBotControl('parser', 'stop')}>{tr('btn_stop_parser')}</button>
                        ) : (
                            <button className="btn btn-primary" onClick={() => onBotControl('parser', 'start')}>{tr('btn_start_parser')}</button>
                        )}
                    </div>
                </div>

                {/* Logs Area */}
                <div className="profile-card" style={{ display: 'flex', flexDirection: 'column', height: '600px' }}>
                    <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h3 style={{ fontFamily: 'Space Grotesk', fontSize: '16px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                            SYSTEM LOGS
                        </h3>
                        <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={onClearLogs}>CLEAR</button>
                    </div>
                    <div ref={logBoxRef} className="logs-panel" style={{ flex: 1, border: 'none', borderRadius: '0' }}>
                        {groups.length === 0 ? (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dark)', fontFamily: 'Space Grotesk' }}>
                                WAITING FOR LOGS...
                            </div>
                        ) : (
                            groups.map((group, idx) => <LogGroup key={idx} group={group} tr={tr} />)
                        )}
                        {logs.length > 0 && <span style={{ display: 'inline-block', width: '8px', height: '16px', background: 'hsl(var(--primary))', animation: 'pulse 1s infinite' }} />}
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Live Stream Card */}
                <div className="profile-card" style={{ padding: '0', overflow: 'hidden', position: 'sticky', top: '100px' }}>
                    <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', background: 'hsla(var(--primary), 0.05)' }}>
                        <h3 style={{ fontFamily: 'Space Grotesk', fontSize: '16px', fontWeight: '600', color: 'hsl(var(--primary))' }}>LIVE MONITOR</h3>
                    </div>
                    <div className="stream-container" style={{ aspectRation: '1', background: '#000', position: 'relative', cursor: 'pointer' }} onClick={() => setIsZoomed(true)}>
                        <img
                            src={`${LOCAL_API_BASE}/api/live-view?t=${liveViewTimestamp}&token=${token}`}
                            style={{ width: '100%', height: 'auto', display: (botStatus.index || botStatus.parser) ? 'block' : 'none' }}
                            alt="Live View"
                        />
                        {!(botStatus.index || botStatus.parser) && (
                            <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-dark)', fontSize: '12px' }}>
                                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ marginBottom: '16px', opacity: 0.3 }}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                                <br />
                                {tr('browser_not_started')}
                            </div>
                        )}
                    </div>
                    <div style={{ padding: '12px', textAlign: 'center', fontSize: '11px', color: 'var(--text-dim)', background: 'hsla(0, 0%, 100%, 0.02)' }}>
                        CLICK TO EXPAND
                    </div>
                </div>
            </div>

            {/* Zoom Modal */}
            {isZoomed && (
                <div className="modal-overlay" onClick={() => setIsZoomed(false)}>
                    <img
                        src={`${LOCAL_API_BASE}/api/live-view?t=${liveViewTimestamp}&token=${token}`}
                        style={{ maxWidth: '95vw', maxHeight: '95vh', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)' }}
                        alt="Full Live View"
                    />
                </div>
            )}
        </div>
    );
}
