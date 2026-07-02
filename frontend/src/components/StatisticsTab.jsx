import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'react-hot-toast';

const EMPTY_DETAILS = { total: 0, replied: 0, liked: 0, sent: 0 };

function sortRows(data, sortConfig, table) {
  if (sortConfig.table !== table || !sortConfig.key) return data;

  return [...data].sort((a, b) => {
    let aVal;
    let bVal;

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
}

function SortArrow({ active, direction }) {
  return (
    <span className={`sort-arrow${active ? '' : ' sort-arrow-inactive'}`}>
      {active ? (direction === 'asc' ? '↑' : '↓') : '↑'}
    </span>
  );
}

export default function StatisticsTab({ authFetch }) {
  const [summary, setSummary] = useState([]);
  const [records, setRecords] = useState([]);
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [isLoading, setIsLoading] = useState(true);
  const [checkerStatus, setCheckerStatus] = useState({
    running: false,
    current: 0,
    total: 0,
    status: 'Idle',
  });
  const [sortConfig, setSortConfig] = useState({ key: 'total_sent', direction: 'desc', table: 'summary' });

  const requestSort = (key, table) => {
    setSortConfig((prev) => {
      let direction = 'asc';
      if (prev.key === key && prev.direction === 'asc' && prev.table === table) {
        direction = 'desc';
      }
      return { key, direction, table };
    });
  };

  const fetchStats = useCallback(async () => {
    try {
      const resp = await authFetch('/api/stats');
      const data = await resp.json();
      if (data.success) {
        setSummary(data.summary || []);
        setRecords(data.records || []);
        setDetails(data.details || EMPTY_DETAILS);
      }
    } catch {
      toast.error('Не удалось загрузить статистику');
    } finally {
      setIsLoading(false);
    }
  }, [authFetch]);

  const fetchCheckerStatus = useCallback(async () => {
    try {
      const resp = await authFetch('/api/feedback/status');
      setCheckerStatus(await resp.json());
    } catch {
      /* polling — тихо */
    }
  }, [authFetch]);

  useEffect(() => {
    fetchStats();
    fetchCheckerStatus();
    const interval = setInterval(() => {
      fetchStats();
      fetchCheckerStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchStats, fetchCheckerStatus]);

  const handleFeedbackToggle = async () => {
    try {
      if (checkerStatus.running) {
        await authFetch('/api/feedback/stop', { method: 'POST' });
        toast.success('Останавливаем проверку...');
      } else {
        await authFetch('/api/feedback/start', { method: 'POST' });
        toast.success('Проверка ответов запущена');
      }
      fetchCheckerStatus();
    } catch {
      toast.error('Ошибка операции');
    }
  };

  const sortedSummary = useMemo(
    () => sortRows(summary, sortConfig, 'summary'),
    [summary, sortConfig]
  );
  const sortedRecords = useMemo(
    () => sortRows(records, sortConfig, 'history'),
    [records, sortConfig]
  );

  const renderSortArrow = (key, table) => (
    <SortArrow active={sortConfig.key === key && sortConfig.table === table} direction={sortConfig.direction} />
  );

  return (
    <div className="tab-content-fade stats-tab">
      <div className="section-header">
        <div>
          <h2 className="section-title">Статистика и Ответы</h2>
          <p className="section-desc">Отслеживание конверсии и ответов</p>
        </div>
        <div className="section-actions">
          <button
            type="button"
            className={`btn-feedback${checkerStatus.running ? ' btn_running' : ''}`}
            onClick={handleFeedbackToggle}
            disabled={isLoading}
          >
            {checkerStatus.running
              ? `Стоп ${checkerStatus.current}/${checkerStatus.total}`
              : 'Сбор обратной связи'}
          </button>
          <button type="button" className="btn-primary btn-sm" onClick={fetchStats}>
            Обновить
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
          <span>
            {checkerStatus.status}... Прогресс: {checkerStatus.current}/{checkerStatus.total}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="loader-ring" />
      ) : (
        <>
          <div className="stats-container">
            <h3>Суммарно</h3>
            {summary.length === 0 ? (
              <div className="empty-state-msg">Статистика пока недоступна.</div>
            ) : (
              <table className="stats-table">
                <thead>
                  <tr>
                    <th onClick={() => requestSort('message_text', 'summary')} className="sortable">
                      Сообщение {renderSortArrow('message_text', 'summary')}
                    </th>
                    <th
                      onClick={() => requestSort('total_sent', 'summary')}
                      className="sortable head-center"
                      style={{ width: '120px' }}
                    >
                      Отправлено {renderSortArrow('total_sent', 'summary')}
                    </th>
                    <th
                      onClick={() => requestSort('replied_count', 'summary')}
                      className="sortable head-center"
                      style={{ width: '110px' }}
                    >
                      Ответил {renderSortArrow('replied_count', 'summary')}
                    </th>
                    <th
                      onClick={() => requestSort('liked_count', 'summary')}
                      className="sortable head-center"
                      style={{ width: '90px' }}
                    >
                      Like {renderSortArrow('liked_count', 'summary')}
                    </th>
                    <th
                      onClick={() => requestSort('conversion', 'summary')}
                      className="sortable head-center"
                      style={{ width: '90px' }}
                    >
                      % {renderSortArrow('conversion', 'summary')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedSummary.map((row, i) => {
                    const conv = (
                      (((row.replied_count || 0) + (row.liked_count || 0)) / (row.total_sent || 1)) *
                      100
                    ).toFixed(1);
                    return (
                      <tr key={i}>
                        <td className="msg-cell">{row.message_text}</td>
                        <td className="count-cell" style={{ textAlign: 'center' }}>
                          <span className="badge viewedTag" style={{ opacity: 0.8 }}>
                            {row.total_sent}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className="badge dmTag" style={{ opacity: row.replied_count > 0 ? 1 : 0.3 }}>
                            {row.replied_count || 0}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <span className="badge likedTag" style={{ opacity: row.liked_count > 0 ? 1 : 0.3 }}>
                            {row.liked_count || 0}
                          </span>
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
              <div className="empty-state-msg">Сообщений пока нет.</div>
            ) : (
              <table className="stats-table">
                <thead>
                  <tr>
                    <th
                      onClick={() => requestSort('username', 'history')}
                      className="sortable"
                      style={{ textAlign: 'left', width: '180px' }}
                    >
                      Юзернейм {renderSortArrow('username', 'history')}
                    </th>
                    <th onClick={() => requestSort('message_text', 'history')} className="sortable" style={{ textAlign: 'left' }}>
                      Сообщение {renderSortArrow('message_text', 'history')}
                    </th>
                    <th
                      onClick={() => requestSort('status', 'history')}
                      className="sortable head-center"
                      style={{ width: '120px' }}
                    >
                      Статус {renderSortArrow('status', 'history')}
                    </th>
                    <th
                      onClick={() => requestSort('timestamp', 'history')}
                      className="sortable head-center"
                      style={{ width: '180px' }}
                    >
                      Дата {renderSortArrow('timestamp', 'history')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRecords.map((row, i) => (
                    <tr key={i}>
                      <td className="user-cell">@{row.username || row.url.split('/').pop()}</td>
                      <td className="msg-cell">{row.message_text}</td>
                      <td style={{ textAlign: 'center' }}>
                        {row.status === 'replied' && <span className="badge dmTag">Ответил</span>}
                        {row.status === 'liked' && <span className="badge likedTag">Лайкнул</span>}
                        {row.status === 'sent' && (
                          <span className="badge viewedTag" style={{ opacity: 0.5 }}>
                            Написал
                          </span>
                        )}
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
    </div>
  );
}
