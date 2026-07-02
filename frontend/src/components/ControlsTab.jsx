import { useState, useEffect, useRef, memo } from 'react';
import { FileIcon } from './Icons';
import { useCollapsed } from '../hooks/useCollapsed';

const LogGroup = memo(function LogGroup({ group }) {
  const [collapsed, setCollapsed] = useState(false);
  const source = group.source.split('-')[0].toUpperCase();
  const time = group.timestamp ? group.timestamp.split('T')[1].split('.')[0] : '';

  return (
    <div className={`log-group${collapsed ? ' collapsed' : ''}`}>
      <div className="log-group-header" onClick={() => setCollapsed((c) => !c)}>
        <div className="group-info">
          <span className={`log-source source-${group.source.split('-')[0]}`}>{source}</span>
          <span className="log-time">{time}</span>
          <span className="group-label">{`БАТЧ • ${group.logs.length} записей`}</span>
        </div>
        <div className="group-toggle">{collapsed ? '+' : '−'}</div>
      </div>
      {!collapsed && (
        <div className="log-group-content">
          {group.logs.map((log, i) => (
            <div className="log-entry" key={log.id || i}>
              <div className="log-time">
                {log.timestamp ? log.timestamp.split('T')[1].split('.')[0] : ''}
              </div>
              <div className="log-message">{log.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

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
  );
});

function groupLogs(logs) {
  const groups = [];
  let current = null;

  for (const log of logs) {
    if (!current || current.sessionId !== log.sessionId || current.source !== log.source) {
      current = {
        sessionId: log.sessionId,
        source: log.source,
        timestamp: log.timestamp,
        logs: [],
      };
      groups.push(current);
    }
    current.logs.push(log);
  }

  return groups;
}

export default function ControlsTab({
  botStatus,
  onBotControl,
  onClearLogs,
  logs,
  isLoading,
  token,
}) {
  const logBoxRef = useRef(null);
  const [scraperCollapsed, toggleScraper] = useCollapsed('ig_scraper_collapsed', false);
  const [parserCollapsed, toggleParser] = useCollapsed('ig_parser_collapsed', false);
  const [logsCollapsed, toggleLogs] = useCollapsed('ig_logs_collapsed', false);
  const [streamCollapsed, toggleStream] = useCollapsed('ig_stream_collapsed', false);
  const [liveViewTimestamp, setLiveViewTimestamp] = useState(Date.now());
  const [isZoomed, setIsZoomed] = useState(false);

  const botsRunning = botStatus.index || botStatus.parser;
  const groups = groupLogs(logs);
  const liveViewSrc = `/api/live-view?t=${liveViewTimestamp}&token=${token}`;

  useEffect(() => {
    const interval = setInterval(() => setLiveViewTimestamp(Date.now()), 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const el = logBoxRef.current;
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [logs]);

  const handleSkipDonor = async (e) => {
    const btn = e.currentTarget;
    const originalText = btn.innerText;
    btn.innerText = '⌛...';
    btn.classList.add('opacity-70');
    btn.disabled = true;

    await onBotControl('index', 'skip-donor');

    btn.innerText = '✅';
    setTimeout(() => {
      btn.innerText = originalText;
      btn.classList.remove('opacity-70');
      btn.disabled = false;
    }, 2000);
  };

  if (isLoading) return <SkeletonControls />;

  return (
    <div className="controls-panel tab-content-fade">
      <div className="control-card">
        <h3 className="control-header-content" onClick={toggleScraper}>
          Фарм профилей
          <div className="control-status-group">
            <div className={`status-dot${botStatus.index ? ' active' : ''}`} />
            <span className="count-badge">{scraperCollapsed ? '▼' : '▲'}</span>
          </div>
        </h3>
        {!scraperCollapsed && (
          <div className="flex-v gap-12 mt-12">
            <p className="control-desc">Сбор профилей по донорам.</p>
            {botStatus.index ? (
              <div className="flex gap-12">
                <button
                  type="button"
                  className="btn-primary btn-danger btn-ghost"
                  onClick={() => onBotControl('index', 'stop')}
                >
                  Остановить
                </button>
                <button
                  type="button"
                  className="btn-primary btn-warning btn-ghost"
                  onClick={handleSkipDonor}
                >
                  Пропустить донора
                </button>
              </div>
            ) : (
              <button type="button" className="btn-primary" onClick={() => onBotControl('index', 'start')}>
                Запустить
              </button>
            )}
          </div>
        )}
      </div>

      <div className="control-card">
        <h3 className="control-header-content" onClick={toggleParser}>
          Фарм доноров
          <div className="control-status-group">
            <div className={`status-dot${botStatus.parser ? ' active' : ''}`} />
            <span className="count-badge">{parserCollapsed ? '▼' : '▲'}</span>
          </div>
        </h3>
        {!parserCollapsed && (
          <div className="flex-v gap-12 mt-12">
            <p className="control-desc">Поиск активных доноров.</p>
            {botStatus.parser ? (
              <button
                type="button"
                className="btn-primary btn-danger btn-ghost"
                onClick={() => onBotControl('parser', 'stop')}
              >
                Остановить
              </button>
            ) : (
              <button type="button" className="btn-primary" onClick={() => onBotControl('parser', 'start')}>
                Запустить
              </button>
            )}
          </div>
        )}
      </div>

      <div className={`control-card logs-card${logsCollapsed ? ' collapsed' : ''}`}>
        <div className="logs-header" style={{ marginBottom: logsCollapsed ? 0 : 12 }}>
          <h3 className="control-header-content gap-10" onClick={toggleLogs}>
            <FileIcon /> Логи
          </h3>
          <div className="control-status-group">
            <button
              type="button"
              className="btn-primary btn-ghost btn-sm btn-outline btn-clear"
              onClick={(e) => {
                e.stopPropagation();
                onClearLogs();
              }}
            >
              Очистить
            </button>
            <div className="badge viewedTag live-badge">Live</div>
            <span className="count-badge cursor-pointer" onClick={toggleLogs}>
              {logsCollapsed ? '▼' : '▲'}
            </span>
          </div>
        </div>
        {!logsCollapsed && (
          <div ref={logBoxRef} id="log-box" className="logs-container">
            {groups.length === 0 && (
              <div style={{ color: 'hsl(var(--text-dim))', textAlign: 'center', padding: '40px' }}>
                Логи пусты. Запустите ботов...
              </div>
            )}
            {groups.map((group, idx) => (
              <LogGroup key={group.sessionId + group.source + idx} group={group} />
            ))}
            {logs.length > 0 && (
              <span
                className="terminal-cursor"
                style={{ marginLeft: 18, background: 'hsl(var(--primary))' }}
              />
            )}
          </div>
        )}
      </div>

      <div className={`stream-card${streamCollapsed ? ' collapsed' : ''}`}>
        <div
          className="logs-header"
          style={{ marginBottom: streamCollapsed ? 0 : 0, cursor: 'pointer' }}
          onClick={toggleStream}
        >
          <h3 style={{ margin: 0 }}>Стрим</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div className={`status-dot${botsRunning ? ' active' : ''}`} />
            <span style={{ color: 'hsl(var(--text-muted))', fontSize: '14px' }}>
              {streamCollapsed ? '▼' : '▲'}
            </span>
          </div>
        </div>
        {!streamCollapsed && (
          <div className="stream-container" onClick={() => setIsZoomed(true)}>
            <img
              src={liveViewSrc}
              className={botsRunning ? 'block' : 'hidden'}
              alt="Live View"
              onError={(e) => {
                e.target.style.display = 'none';
                if (e.target.nextSibling) e.target.nextSibling.style.display = 'block';
              }}
              onLoad={(e) => {
                e.target.style.display = 'block';
                if (e.target.nextSibling) e.target.nextSibling.style.display = 'none';
              }}
            />
            <div className="stream-placeholder">
              {botsRunning ? 'Ожидание трансляции...' : 'Браузер не запущен'}
            </div>
          </div>
        )}
      </div>

      {isZoomed && (
        <div className="stream-overlay-full" onClick={() => setIsZoomed(false)}>
          <img src={liveViewSrc} alt="Live View Full" />
        </div>
      )}
    </div>
  );
}
