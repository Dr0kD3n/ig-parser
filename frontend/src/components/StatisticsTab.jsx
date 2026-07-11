import { memo, useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import DonorInfo from './DonorInfo';

const EMPTY_DETAILS = { total: 0, replied: 0, liked: 0, ignored: 0, drain: 0, sent: 0 };

const MANUAL_STATUS_OPTIONS = [
  { value: 'replied', label: 'Ответила' },
  { value: 'ignored', label: 'Игнор' },
  { value: 'liked', label: 'Лайк' },
  { value: 'drain', label: 'Слив' },
];

const MANUAL_STATUS_SET = new Set(MANUAL_STATUS_OPTIONS.map((o) => o.value));
const ITEMS_PER_PAGE = 20;
const STATS_POLL_MS = 15000;

function paginateRows(rows, page, perPage = ITEMS_PER_PAGE) {
  const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
  const safePage = Math.min(Math.max(1, page), totalPages);
  return {
    totalPages,
    page: safePage,
    items: rows.slice((safePage - 1) * perPage, safePage * perPage),
  };
}

function TablePagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  return (
    <div className="pagination stats-pagination">
      <button
        type="button"
        className="pageBtn"
        disabled={page === 1}
        onClick={() => onPageChange(page - 1)}
      >
        ← Назад
      </button>
      <span className="page-info">
        Страница {page} из {totalPages}
      </span>
      <button
        type="button"
        className="pageBtn"
        disabled={page === totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Вперед →
      </button>
    </div>
  );
}

function filterBySentCount(rows, sentMin, sentMax) {
  const min = String(sentMin ?? '').trim() === '' ? null : Number(sentMin);
  const max = String(sentMax ?? '').trim() === '' ? null : Number(sentMax);
  if (min === null && max === null) return rows;

  return rows.filter((row) => {
    const sent = Number(row.total_sent) || 0;
    if (min !== null && !Number.isNaN(min) && sent < min) return false;
    if (max !== null && !Number.isNaN(max) && sent > max) return false;
    return true;
  });
}

function StatsSectionHeader({
  title,
  totalCount,
  filteredCount,
  countLabel,
  sentMin,
  sentMax,
  onSentMinChange,
  onSentMaxChange,
}) {
  return (
    <h3 className="stats-section-header">
      <div className="stats-section-title">
        {title}
        {totalCount > 0 && (
          <span className="stats-table-count">
            {filteredCount !== totalCount ? `${filteredCount} из ${totalCount}` : totalCount} {countLabel}
          </span>
        )}
      </div>
      <div className="stats-sent-filter">
        <label className="stats-sent-filter-label">
          <span>от</span>
          <input
            type="number"
            min="0"
            className="stats-sent-filter-input"
            value={sentMin}
            onChange={onSentMinChange}
            placeholder="—"
          />
        </label>
        <label className="stats-sent-filter-label">
          <span>до</span>
          <input
            type="number"
            min="0"
            className="stats-sent-filter-input"
            value={sentMax}
            onChange={onSentMaxChange}
            placeholder="—"
          />
        </label>
      </div>
    </h3>
  );
}

function sortRows(data, sortConfig, table) {
  if (sortConfig.table !== table || !sortConfig.key) return data;

  return [...data].sort((a, b) => {
    let aVal;
    let bVal;

    if (sortConfig.key === 'conversion') {
      aVal = ((a.replied_count || 0) + (a.liked_count || 0)) / (a.total_sent || 1);
      bVal = ((b.replied_count || 0) + (b.liked_count || 0)) / (b.total_sent || 1);
    } else if (sortConfig.key === 'donor') {
      aVal = (a.donor || '').toLowerCase();
      bVal = (b.donor || '').toLowerCase();
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

const HistoryRow = memo(function HistoryRow({ row, onStatusChange }) {
  const username = row.username || row.url.split('/').pop();

  return (
    <tr>
      <td className="user-cell">@{username}</td>
      <td className="user-cell" style={{ fontSize: '12px' }}>
        {row.donor ? `@${row.donor}` : '—'}
      </td>
      <td className="msg-cell">{row.message_text}</td>
      <td style={{ textAlign: 'center' }}>
        <div className="status-select-wrap">
          <select
            className={`status-select status-select-${row.status || 'sent'}${row.status_manual ? ' status-select-manual' : ''}`}
            value={MANUAL_STATUS_SET.has(row.status) ? row.status : ''}
            title={row.status_manual ? 'Статус задан вручную' : 'Задать статус'}
            onChange={(e) => onStatusChange(row.id, e.target.value)}
          >
            {row.status === 'sent' && (
              <option value="" disabled>
                Написал
              </option>
            )}
            {MANUAL_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {row.status_manual ? <span className="status-manual-mark" title="Вручную">✎</span> : null}
        </div>
      </td>
      <td style={{ textAlign: 'center', fontSize: '12px', color: '#888' }}>
        {new Date(row.timestamp).toLocaleString()}
      </td>
    </tr>
  );
});

export default function StatisticsTab({ authFetch }) {
  const [summary, setSummary] = useState([]);
  const [donorSummary, setDonorSummary] = useState([]);
  const [records, setRecords] = useState([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [details, setDetails] = useState(EMPTY_DETAILS);
  const [isLoading, setIsLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [checkerStatus, setCheckerStatus] = useState({
    running: false,
    current: 0,
    total: 0,
    status: 'Idle',
  });
  const [sortConfig, setSortConfig] = useState({ key: 'total_sent', direction: 'desc', table: 'summary' });
  const [historySort, setHistorySort] = useState({ key: 'timestamp', direction: 'desc' });
  const [donorsPage, setDonorsPage] = useState(1);
  const [summaryPage, setSummaryPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [sentMin, setSentMin] = useState('');
  const [sentMax, setSentMax] = useState('');

  const handleSentMinChange = (e) => {
    setSentMin(e.target.value);
    setDonorsPage(1);
    setSummaryPage(1);
  };

  const handleSentMaxChange = (e) => {
    setSentMax(e.target.value);
    setDonorsPage(1);
    setSummaryPage(1);
  };

  const requestSort = (key, table) => {
    if (table === 'donors') {
      setDonorsPage(1);
      setSortConfig((prev) => {
        let direction = 'asc';
        if (prev.key === key && prev.direction === 'asc' && prev.table === table) {
          direction = 'desc';
        }
        return { key, direction, table };
      });
      return;
    }

    if (table === 'history') {
      setHistoryPage(1);
      setHistorySort((prev) => {
        let direction = 'asc';
        if (prev.key === key && prev.direction === 'asc') {
          direction = 'desc';
        }
        return { key, direction };
      });
      return;
    }

    setSortConfig((prev) => {
      let direction = 'asc';
      if (prev.key === key && prev.direction === 'asc' && prev.table === table) {
        direction = 'desc';
      }
      return { key, direction, table };
    });
    if (table === 'summary') setSummaryPage(1);
  };

  const fetchStats = useCallback(async () => {
    try {
      const resp = await authFetch('/api/stats');
      const data = await resp.json();
      if (data.success) {
        setSummary(data.summary || []);
        setDonorSummary(data.donorSummary || []);
        setDetails(data.details || EMPTY_DETAILS);
      }
    } catch {
      toast.error('Не удалось загрузить статистику');
    } finally {
      setIsLoading(false);
    }
  }, [authFetch]);

  const fetchHistory = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: String(historyPage),
        limit: String(ITEMS_PER_PAGE),
        sort: historySort.key,
        dir: historySort.direction,
      });
      const resp = await authFetch(`/api/stats/messages?${params}`);
      const data = await resp.json();
      if (data.success) {
        setRecords(data.records || []);
        setRecordsTotal(data.total || 0);
        setHistoryTotalPages(data.totalPages || 1);
      }
    } catch {
      toast.error('Не удалось загрузить историю');
    } finally {
      setHistoryLoading(false);
    }
  }, [authFetch, historyPage, historySort]);

  const fetchCheckerStatus = useCallback(async () => {
    try {
      const resp = await authFetch('/api/feedback/status');
      setCheckerStatus(await resp.json());
    } catch {
      /* polling — тихо */
    }
  }, [authFetch]);

  const refreshAll = useCallback(() => {
    setIsLoading(true);
    setHistoryLoading(true);
    fetchStats();
    fetchHistory();
    fetchCheckerStatus();
  }, [fetchStats, fetchHistory, fetchCheckerStatus]);

  useEffect(() => {
    setIsLoading(true);
    fetchStats();
    fetchCheckerStatus();
  }, [fetchStats, fetchCheckerStatus]);

  useEffect(() => {
    setHistoryLoading(true);
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    const interval = setInterval(fetchStats, STATS_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchStats]);

  useEffect(() => {
    if (!checkerStatus.running) return undefined;
    const interval = setInterval(() => {
      fetchCheckerStatus();
      fetchStats();
      fetchHistory();
    }, 5000);
    return () => clearInterval(interval);
  }, [checkerStatus.running, fetchCheckerStatus, fetchStats, fetchHistory]);

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

  const handleStatusChange = useCallback(async (id, status) => {
    if (!status || !MANUAL_STATUS_SET.has(status)) return;

    let prevRecords = [];
    setRecords((prev) => {
      prevRecords = prev;
      return prev.map((r) => (r.id === id ? { ...r, status, status_manual: 1 } : r));
    });

    try {
      const resp = await authFetch(`/api/stats/messages/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await resp.json();
      if (!data.success) throw new Error(data.error);
      setRecords((prev) => prev.map((r) => (r.id === id ? data.record : r)));
      fetchStats();
    } catch {
      setRecords(prevRecords);
      toast.error('Не удалось обновить статус');
    }
  }, [authFetch, fetchStats]);

  const sortedSummary = useMemo(
    () => sortRows(summary, sortConfig, 'summary'),
    [summary, sortConfig]
  );
  const sortedDonorSummary = useMemo(
    () => sortRows(donorSummary, sortConfig, 'donors'),
    [donorSummary, sortConfig]
  );

  const filteredDonorSummary = useMemo(
    () => filterBySentCount(sortedDonorSummary, sentMin, sentMax),
    [sortedDonorSummary, sentMin, sentMax]
  );
  const filteredSummary = useMemo(
    () => filterBySentCount(sortedSummary, sentMin, sentMax),
    [sortedSummary, sentMin, sentMax]
  );

  const donorsPagination = useMemo(
    () => paginateRows(filteredDonorSummary, donorsPage),
    [filteredDonorSummary, donorsPage]
  );
  const summaryPagination = useMemo(
    () => paginateRows(filteredSummary, summaryPage),
    [filteredSummary, summaryPage]
  );

  const renderSortArrow = (key, table) => {
    const activeKey = table === 'history' ? historySort.key : sortConfig.key;
    const activeDir = table === 'history' ? historySort.direction : sortConfig.direction;
    const activeTable = table === 'history' ? 'history' : sortConfig.table;
    return (
      <SortArrow
        active={activeKey === key && activeTable === table}
        direction={activeDir}
      />
    );
  };

  const safeHistoryPage = Math.min(historyPage, historyTotalPages);

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
          <button type="button" className="btn-primary btn-sm" onClick={refreshAll}>
            Обновить
          </button>
        </div>
      </div>

      <div className="stats-header-grid stats-header-grid-6">
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
          <div className="stat-label">Игнор</div>
          <div className="stat-value color-ignored">{details.ignored}</div>
        </div>
        <div className="header-stat-card">
          <div className="stat-label">Слив</div>
          <div className="stat-value color-drain">{details.drain}</div>
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
            <StatsSectionHeader
              title="По донорам"
              totalCount={donorSummary.length}
              filteredCount={filteredDonorSummary.length}
              countLabel="доноров"
              sentMin={sentMin}
              sentMax={sentMax}
              onSentMinChange={handleSentMinChange}
              onSentMaxChange={handleSentMaxChange}
            />
            {donorSummary.length === 0 ? (
              <div className="empty-state-msg">Нет данных по донорам.</div>
            ) : filteredDonorSummary.length === 0 ? (
              <div className="empty-state-msg">Нет доноров по фильтру отправленных.</div>
            ) : (
              <>
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th onClick={() => requestSort('donor', 'donors')} className="sortable">
                        Донор {renderSortArrow('donor', 'donors')}
                      </th>
                      <th
                        onClick={() => requestSort('total_sent', 'donors')}
                        className="sortable head-center"
                        style={{ width: '90px' }}
                      >
                        Отпр. {renderSortArrow('total_sent', 'donors')}
                      </th>
                      <th
                        onClick={() => requestSort('replied_count', 'donors')}
                        className="sortable head-center"
                        style={{ width: '80px' }}
                      >
                        Ответ {renderSortArrow('replied_count', 'donors')}
                      </th>
                      <th
                        onClick={() => requestSort('liked_count', 'donors')}
                        className="sortable head-center"
                        style={{ width: '70px' }}
                      >
                        Лайк {renderSortArrow('liked_count', 'donors')}
                      </th>
                      <th
                        onClick={() => requestSort('ignored_count', 'donors')}
                        className="sortable head-center"
                        style={{ width: '70px' }}
                      >
                        Игнор {renderSortArrow('ignored_count', 'donors')}
                      </th>
                      <th
                        onClick={() => requestSort('drain_count', 'donors')}
                        className="sortable head-center"
                        style={{ width: '70px' }}
                      >
                        Слив {renderSortArrow('drain_count', 'donors')}
                      </th>
                      <th
                        onClick={() => requestSort('conversion', 'donors')}
                        className="sortable head-center"
                        style={{ width: '70px' }}
                      >
                        % {renderSortArrow('conversion', 'donors')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {donorsPagination.items.map((row) => {
                      const conv = (
                        (((row.replied_count || 0) + (row.liked_count || 0)) / (row.total_sent || 1)) *
                        100
                      ).toFixed(1);
                      return (
                        <tr key={row.donor}>
                          <td className="donor-stats-cell">
                            <DonorInfo
                              variant="stats"
                              donor={row.donor}
                              donorName={row.donor_name}
                              donorPhoto={row.donor_photo}
                              donorPhotoLocal={row.donor_photo_local}
                              donorBio={row.donor_bio}
                              donorFollowersCount={row.donor_followers_count}
                              donorPostsCount={row.donor_posts_count}
                              city={row.city}
                              keyword={row.keyword}
                              niche={row.niche}
                            />
                          </td>
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
                            <span className="badge ignoredTag" style={{ opacity: row.ignored_count > 0 ? 1 : 0.3 }}>
                              {row.ignored_count || 0}
                            </span>
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            <span className="badge drainTag" style={{ opacity: row.drain_count > 0 ? 1 : 0.3 }}>
                              {row.drain_count || 0}
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
                <TablePagination
                  page={donorsPagination.page}
                  totalPages={donorsPagination.totalPages}
                  onPageChange={setDonorsPage}
                />
              </>
            )}
          </div>

          <div className="stats-container">
            <StatsSectionHeader
              title="Суммарно"
              totalCount={summary.length}
              filteredCount={filteredSummary.length}
              countLabel="шаблонов"
              sentMin={sentMin}
              sentMax={sentMax}
              onSentMinChange={handleSentMinChange}
              onSentMaxChange={handleSentMaxChange}
            />
            {summary.length === 0 ? (
              <div className="empty-state-msg">Статистика пока недоступна.</div>
            ) : filteredSummary.length === 0 ? (
              <div className="empty-state-msg">Нет шаблонов по фильтру отправленных.</div>
            ) : (
              <>
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
                  {summaryPagination.items.map((row) => {
                    const conv = (
                      (((row.replied_count || 0) + (row.liked_count || 0)) / (row.total_sent || 1)) *
                      100
                    ).toFixed(1);
                    return (
                      <tr key={row.message_text}>
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
              <TablePagination
                page={summaryPagination.page}
                totalPages={summaryPagination.totalPages}
                onPageChange={setSummaryPage}
              />
              </>
            )}
          </div>

          <div className="stats-container">
            <h3>
              История
              {recordsTotal > 0 && (
                <span className="stats-table-count">
                  {recordsTotal} сообщений
                </span>
              )}
            </h3>
            {historyLoading ? (
              <div className="loader-ring-sm stats-inline-loader" />
            ) : recordsTotal === 0 ? (
              <div className="empty-state-msg">Сообщений пока нет.</div>
            ) : (
              <>
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th
                        onClick={() => requestSort('username', 'history')}
                        className="sortable"
                        style={{ textAlign: 'left', width: '150px' }}
                      >
                        Юзернейм {renderSortArrow('username', 'history')}
                      </th>
                      <th
                        onClick={() => requestSort('donor', 'history')}
                        className="sortable"
                        style={{ textAlign: 'left', width: '120px' }}
                      >
                        Донор {renderSortArrow('donor', 'history')}
                      </th>
                      <th onClick={() => requestSort('message_text', 'history')} className="sortable" style={{ textAlign: 'left' }}>
                        Сообщение {renderSortArrow('message_text', 'history')}
                      </th>
                      <th
                        onClick={() => requestSort('status', 'history')}
                        className="sortable head-center"
                        style={{ width: '150px' }}
                      >
                        Статус {renderSortArrow('status', 'history')}
                      </th>
                      <th
                        onClick={() => requestSort('timestamp', 'history')}
                        className="sortable head-center"
                        style={{ width: '160px' }}
                      >
                        Дата {renderSortArrow('timestamp', 'history')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((row) => (
                      <HistoryRow key={row.id} row={row} onStatusChange={handleStatusChange} />
                    ))}
                  </tbody>
                </table>
                <TablePagination
                  page={safeHistoryPage}
                  totalPages={historyTotalPages}
                  onPageChange={setHistoryPage}
                />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
