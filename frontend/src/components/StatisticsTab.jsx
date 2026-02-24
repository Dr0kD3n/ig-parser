import React, { useState, useEffect, useRef } from 'react'

export default function StatisticsTab({ botStatus, onBotControl, logs, tr }) {
    const [stats, setStats] = useState([])
    const [isLoading, setIsLoading] = useState(false)

    const fetchStats = async () => {
        setIsLoading(true)
        try {
            const res = await fetch('/api/stats')
            const data = await res.json()
            if (data.success) {
                setStats(data.data || [])
            }
        } catch (e) {
            console.error('Error fetching stats', e)
        } finally {
            setIsLoading(false)
        }
    }

    const logsEndRef = useRef(null)

    useEffect(() => {
        fetchStats()
    }, [])

    useEffect(() => {
        if (logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [logs])

    const checkerLogs = logs.filter(l => l.source === 'checker' || l.source === 'checker-error' || (l.source === 'system' && l.message.includes('checker')))

    return (
        <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            <div className="controls-grid" style={{ gridTemplateColumns: 'minmax(300px, 400px)' }}>
                <div className="control-card">
                    <div className="card-header">
                        <div className="card-icon" style={{ background: 'var(--accent)' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                            </svg>
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1rem' }}>{tr('checker_title')}</h3>
                            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#888' }}>
                                {tr('checker_desc')}
                            </p>
                        </div>
                    </div>
                    {botStatus.checker ? (
                        <button className="btn-secondary" onClick={() => onBotControl('checker', 'stop')}>
                            {tr('btn_stop_checker')}
                        </button>
                    ) : (
                        <button className="btn-primary" onClick={() => onBotControl('checker', 'start')}>
                            {tr('btn_start_checker')}
                        </button>
                    )}
                </div>
            </div>

            <div className="settings-section" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h3 style={{ margin: 0 }}>{tr('tab_statistics')}</h3>
                    <button className="btn-secondary" style={{ padding: '8px 16px', height: 'auto' }} onClick={fetchStats} disabled={isLoading}>
                        {isLoading ? '...' : 'Обновить'}
                    </button>
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', minWidth: '600px' }}>
                        <thead>
                            <tr style={{ background: '#222', color: '#aaa', fontSize: '13px', textTransform: 'uppercase' }}>
                                <th style={{ padding: '12px 16px', borderRadius: '8px 0 0 8px' }}>{tr('stats_template')}</th>
                                <th style={{ padding: '12px 16px' }}>{tr('stats_sent')}</th>
                                <th style={{ padding: '12px 16px' }}>{tr('stats_replied')}</th>
                                <th style={{ padding: '12px 16px' }}>{tr('stats_replied_rate')}</th>
                                <th style={{ padding: '12px 16px' }}>{tr('stats_continued')}</th>
                                <th style={{ padding: '12px 16px', borderRadius: '0 8px 8px 0' }}>{tr('stats_continued_rate')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {stats.length === 0 ? (
                                <tr>
                                    <td colSpan="6" style={{ padding: '40px 20px', textAlign: 'center', color: '#666' }}>
                                        Нет данных
                                    </td>
                                </tr>
                            ) : (
                                stats.map((row, idx) => {
                                    const replyRate = row.total_sent > 0 ? ((row.replies / row.total_sent) * 100).toFixed(1) : 0
                                    const contRate = row.replies > 0 ? ((row.continuations / row.replies) * 100).toFixed(1) : 0

                                    return (
                                        <tr key={idx} style={{ borderBottom: '1px solid #222', transition: 'background 0.2s', ':hover': { background: '#1a1a1a' } }}>
                                            <td style={{ padding: '16px', maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#fff' }} title={row.message_text}>
                                                {row.message_text}
                                            </td>
                                            <td style={{ padding: '16px', color: '#ddd' }}>{row.total_sent}</td>
                                            <td style={{ padding: '16px', color: '#ddd' }}>{row.replies}</td>
                                            <td style={{ padding: '16px', fontWeight: 'bold', color: replyRate > 0 ? 'hsl(var(--success))' : '#888' }}>
                                                {replyRate}%
                                            </td>
                                            <td style={{ padding: '16px', color: '#ddd' }}>{row.continuations}</td>
                                            <td style={{ padding: '16px', fontWeight: 'bold', color: contRate > 0 ? 'hsl(var(--accent))' : '#888' }}>
                                                {contRate}%
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="logs-section" style={{ padding: '20px', background: 'hsl(var(--bg-card))', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                <h3 style={{ margin: '0 0 16px 0', fontSize: '1rem' }}>Терминал (Логи)</h3>
                <div className="terminal-window" style={{ background: '#000', borderRadius: '8px', padding: '16px', height: '400px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '13px', border: '1px solid #333' }}>
                    {checkerLogs.length === 0 ? (
                        <div style={{ color: '#666', fontStyle: 'italic' }}>{tr('no_logs')}</div>
                    ) : (
                        checkerLogs.map((log) => {
                            let color = '#ccc'
                            if (log.source.includes('error') || log.message.includes('❌') || log.message.includes('КРИТИЧЕСКАЯ')) color = 'hsl(var(--danger))'
                            else if (log.message.includes('✅') || log.message.includes('ЗАПУСК') || log.message.includes('ЗАВЕРШЕНА')) color = 'hsl(var(--success))'
                            else if (log.source === 'system') color = 'hsl(var(--accent))'
                            else if (log.message.includes('⚠️')) color = '#e2b340'

                            return (
                                <div key={log.id} style={{ marginBottom: '4px', color, display: 'flex', gap: '8px' }}>
                                    <span style={{ opacity: 0.5, minWidth: '70px' }}>{new Date(log.timestamp).toLocaleTimeString()}</span>
                                    <span style={{ wordBreak: 'break-all' }}>{log.message}</span>
                                </div>
                            )
                        })
                    )}
                    <div ref={logsEndRef} />
                </div>
            </div>

        </div>
    )
}
