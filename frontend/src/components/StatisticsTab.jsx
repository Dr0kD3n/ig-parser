import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';

export default function StatisticsTab({ authFetch, tr }) {
    const [summary, setSummary] = useState([]);
    const [records, setRecords] = useState([]);
    const [details, setDetails] = useState({ total: 0, replied: 0, liked: 0, sent: 0 });
    const [isLoading, setIsLoading] = useState(true);
    const [checkerStatus, setCheckerStatus] = useState({ running: false, current: 0, total: 0, status: 'Idle' });
    const [sortConfig, setSortConfig] = useState({ key: 'total_sent', direction: 'desc', table: 'summary' });

    const requestSort = (key, table) => {
        let direction = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc' && sortConfig.table === table) {
            direction = 'desc';
        }
        setSortConfig({ key, direction, table });
    };

    const getSortedData = (data, table) => {
        if (sortConfig.table !== table || !sortConfig.key) return data;
        return [...data].sort((a, b) => {
            let aVal, bVal;
            if (sortConfig.key === 'conversion') {
                aVal = ((a.replied_count || 0) + (a.liked_count || 0)) / (a.total_sent || 1);
                bVal = ((b.replied_count || 0) + (b.liked_count || 0)) / (b.total_sent || 1);
            } else if (sortConfig.key === 'username') {
                aVal = (a.username || a.url || '').toLowerCase();
                bVal = (b.username || b.url || '').toLowerCase();
            } else {
                aVal = a[sortConfig.key];
                bVal = b[sortConfig.key];
            }

            if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
            return 0;
        });
    };

    const renderSortArrow = (key, table) => {
        const active = sortConfig.key === key && sortConfig.table === table;
        return (
            <span style={{
                display: 'inline-block',
                width: '10px',
                marginLeft: '4px',
                visibility: active ? 'visible' : 'hidden',
                color: 'var(--accent)'
            }}>
                {active ? (sortConfig.direction === 'asc' ? '↑' : '↓') : '↑'}
            </span>
        );
    };


    const fetchStats = async () => {
        try {
            const resp = await authFetch('/api/stats');
            const data = await resp.json();
            if (data.success) {
                setSummary(data.summary || []);
                setRecords(data.records || []);
                setDetails(data.details || { total: 0, replied: 0, liked: 0, sent: 0 });
            }
        } catch (err) {
            toast.error('Failed to load stats');
        } finally {
            setIsLoading(false);
        }
    };

    const fetchCheckerStatus = async () => {
        try {
            const resp = await authFetch('/api/feedback/status');
            const data = await resp.json();
            setCheckerStatus(data);
        } catch (e) { }
    };


    useEffect(() => {
        fetchStats();
        fetchCheckerStatus();
        const interval = setInterval(() => {
            fetchStats();
            fetchCheckerStatus();
        }, 5000);
        return () => clearInterval(interval);
    }, [authFetch]);

    const handleFeedbackToggle = async () => {
        try {
            if (checkerStatus.running) {
                await authFetch('/api/feedback/stop', { method: 'POST' });
                toast.success('Stopping checker...');
            } else {
                await authFetch('/api/feedback/start', { method: 'POST' });
                toast.success('Feedback checker started');
            }
            fetchCheckerStatus();
        } catch (e) {
            toast.error('Operation failed');
        }
    };


    return (
        <div className="tab-content-fade" style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '0 32px 32px' }}>
            <div className="section-header">
                <div>
                    <h2 className="section-title">{tr('stats_title')}</h2>
                    <p style={{ color: '#666', fontSize: '12px', marginTop: '-10px' }}>Отслеживание конверсии и ответов</p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button
                        className={`btn-feedback ${checkerStatus.running ? 'btn_running' : ''}`}
                        onClick={handleFeedbackToggle}
                        disabled={isLoading}
                    >

                        {checkerStatus.running ? `Стоп ${checkerStatus.current}/${checkerStatus.total}` : 'Сбор обратной связи'}
                    </button>
                    <button className="btn-primary btn-sm" onClick={fetchStats}>
                        {tr('btn_update')}
                    </button>
                </div>
            </div>

            <div className="stats-header-grid">
                <div className="header-stat-card">
                    <div className="stat-label">Всего</div>
                    <div className="stat-value">{details.total}</div>
                </div>
                <div className="header-stat-card">
                    <div className="stat-label">Отвечено</div>
                    <div className="stat-value color-replied">{details.replied}</div>
                </div>
                <div className="header-stat-card">
                    <div className="stat-label">Like</div>
                    <div className="stat-value color-liked">{details.liked}</div>
                </div>
                <div className="header-stat-card">
                    <div className="stat-label">Не отвечено</div>
                    <div className="stat-value color-sent">{details.sent}</div>
                </div>
            </div>

            {checkerStatus.running && (
                <div className="checker-banner">
                    <div className="loader-ring-sm" />
                    <span>{checkerStatus.status}... Прогресс: {checkerStatus.current}/{checkerStatus.total}</span>
                </div>
            )}


            {isLoading ? (
                <div className="loader-ring" />
            ) : (
                <>
                    <div className="stats-container">
                        <h3>Суммарно</h3>
                        {summary.length === 0 ? (
                            <div className="empty-state-msg">No statistics available yet.</div>
                        ) : (
                            <table className="stats-table">
                                <thead>
                                    <tr>
                                        <th onClick={() => requestSort('message_text', 'summary')} className="sortable">
                                            {tr('stats_message')} {renderSortArrow('message_text', 'summary')}
                                        </th>
                                        <th onClick={() => requestSort('total_sent', 'summary')} className="sortable head-center" style={{ width: '120px' }}>
                                            {tr('stats_count')} {renderSortArrow('total_sent', 'summary')}
                                        </th>
                                        <th onClick={() => requestSort('replied_count', 'summary')} className="sortable head-center" style={{ width: '110px' }}>
                                            {tr('badge_replied')} {renderSortArrow('replied_count', 'summary')}
                                        </th>
                                        <th onClick={() => requestSort('liked_count', 'summary')} className="sortable head-center" style={{ width: '90px' }}>
                                            Like {renderSortArrow('liked_count', 'summary')}
                                        </th>
                                        <th onClick={() => requestSort('conversion', 'summary')} className="sortable head-center" style={{ width: '90px' }}>
                                            % {renderSortArrow('conversion', 'summary')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {getSortedData(summary, 'summary').map((row, i) => {
                                        const conv = (((row.replied_count || 0) + (row.liked_count || 0)) / (row.total_sent || 1) * 100).toFixed(1);
                                        return (
                                            <tr key={i}>
                                                <td className="msg-cell">{row.message_text}</td>
                                                <td className="count-cell" style={{ textAlign: 'center' }}>
                                                    <span className="badge viewedTag" style={{ opacity: 0.8 }}>{row.total_sent}</span>
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <span className="badge dmTag" style={{ opacity: row.replied_count > 0 ? 1 : 0.3 }}>{row.replied_count || 0}</span>
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <span className="badge likedTag" style={{ opacity: row.liked_count > 0 ? 1 : 0.3 }}>{row.liked_count || 0}</span>
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <span style={{ fontWeight: 'bold', color: conv > 0 ? 'var(--accent)' : '#555' }}>
                                                        {conv}%
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>

                    <div className="stats-container">
                        <h3>История</h3>
                        {records.length === 0 ? (
                            <div className="empty-state-msg">No messages found.</div>
                        ) : (
                            <table className="stats-table">
                                <thead>
                                    <tr>
                                        <th onClick={() => requestSort('username', 'history')} className="sortable" style={{ textAlign: 'left', width: '180px' }}>
                                            Юзернейм {renderSortArrow('username', 'history')}
                                        </th>
                                        <th onClick={() => requestSort('message_text', 'history')} className="sortable" style={{ textAlign: 'left' }}>
                                            {tr('stats_message')} {renderSortArrow('message_text', 'history')}
                                        </th>
                                        <th onClick={() => requestSort('status', 'history')} className="sortable head-center" style={{ width: '120px' }}>
                                            {tr('status')} {renderSortArrow('status', 'history')}
                                        </th>
                                        <th onClick={() => requestSort('timestamp', 'history')} className="sortable head-center" style={{ width: '180px' }}>
                                            {tr('tab_logs').split(' ').pop()} {renderSortArrow('timestamp', 'history')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {getSortedData(records, 'history').map((row, i) => (
                                        <tr key={i}>
                                            <td className="user-cell">@{row.username || row.url.split('/').pop()}</td>
                                            <td className="msg-cell">{row.message_text}</td>
                                            <td style={{ textAlign: 'center' }}>
                                                {row.status === 'replied' && <span className="badge dmTag">{tr('badge_replied')}</span>}
                                                {row.status === 'liked' && <span className="badge likedTag">{tr('badge_liked')}</span>}
                                                {row.status === 'sent' && <span className="badge viewedTag" style={{ opacity: 0.5 }}>{tr('badge_sent_dm')}</span>}
                                            </td>
                                            <td style={{ textAlign: 'center', fontSize: '12px', color: '#888' }}>
                                                {new Date(row.timestamp).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </>
            )}

            <style jsx>{`
        .stats-container {
          background: rgba(255, 255, 255, 0.03);
          border-radius: 12px;
          padding: 20px;
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        h3 {
          margin-top: 0;
          margin-bottom: 15px;
          font-size: 16px;
          color: #aaa;
          font-weight: 500;
        }
        .stats-table {
          width: 100%;
          border-collapse: collapse;
        }
        .stats-table th {
          padding: 12px;
          color: #888;
          font-weight: 500;
          font-size: 13px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .stats-table th.head-center {
            text-align: center;
        }
        .stats-table th.sortable {
            cursor: pointer;
            user-select: none;
            transition: color 0.2s;
            white-space: nowrap;
        }
        .stats-table th.sortable:hover {
            color: #fff;
            background: rgba(255, 255, 255, 0.02);
        }
        .stats-table tbody tr {
          transition: background 0.2s;
        }
        .stats-table tbody tr:nth-child(odd) {
            background: rgba(255, 255, 255, 0.02);
        }
        .stats-table tbody tr:hover {
            background: rgba(255, 255, 255, 0.05);
        }
        .stats-table td {
          padding: 15px 12px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.03);
          font-size: 14px;
        }
        .msg-cell {
          color: #eee;
          line-height: 1.4;
          max-width: 400px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .count-cell {
          font-weight: 600;
          color: var(--accent);
        }
        .user-cell {
           color: var(--color-primary-alt);
           font-weight: 500;
        }

        .stats-header-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 15px;
        }
        .header-stat-card {
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            padding: 15px;
            text-align: center;
        }
        .stat-label {
            font-size: 11px;
            text-transform: uppercase;
            color: #888;
            margin-bottom: 5px;
            letter-spacing: 0.5px;
        }
        .stat-value {
            font-size: 24px;
            font-weight: 700;
            color: #fff;
        }
        .color-replied { color: #4ade80; }
        .color-liked { color: #f472b6; }
        .color-sent { color: #60a5fa; }

        .checker-banner {
            display: flex;
            align-items: center;
            gap: 12px;
            background: rgba(var(--accent-rgb), 0.1);
            border: 1px solid rgba(var(--accent-rgb), 0.3);
            border-radius: 8px;
            padding: 10px 15px;
            font-size: 13px;
            color: #fff;
        }
        .loader-ring-sm {
            width: 14px;
            height: 14px;
            border: 2px solid rgba(255,255,255,0.2);
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .btn-feedback {
            background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: white;
            padding: 8px 16px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
        }
        .btn-feedback:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 16px rgba(79, 70, 229, 0.4);
            filter: brightness(1.1);
        }
        .btn-feedback:active {
            transform: translateY(0);
        }
        .btn-feedback:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .btn-feedback.btn_running {
            background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%);
            box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
            border-color: rgba(255, 255, 255, 0.3);
        }

        .btn_running .loader-ring-sm {
            border-top-color: #fff;
        }

      `}</style>

        </div>
    );
}
