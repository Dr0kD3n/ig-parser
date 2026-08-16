import { useState, useEffect, useRef, memo } from 'react';
import { FileIcon } from './Icons';

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
  authFetch,
}) {
  const logBoxRef = useRef(null);
  const liveViewUrlRef = useRef('');
  const [liveViewSrc, setLiveViewSrc] = useState('');
  const [isZoomed, setIsZoomed] = useState(false);

  const botsRunning = botStatus.index || botStatus.parser;
  const groups = groupLogs(logs);
  useEffect(() => {
    if (!botsRunning) return undefined;
    const controller = new AbortController();
    let inFlight = false;

    const loadLiveView = async () => {
      if (inFlight || controller.signal.aborted) return;
      inFlight = true;
      try {
        const response = await authFetch(`/api/live-view?t=${Date.now()}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const nextUrl = URL.createObjectURL(await response.blob());
        if (controller.signal.aborted) {
          URL.revokeObjectURL(nextUrl);
          return;
        }
        const previousUrl = liveViewUrlRef.current;
        liveViewUrlRef.current = nextUrl;
        setLiveViewSrc(nextUrl);
        if (previousUrl) URL.revokeObjectURL(previousUrl);
      } catch (error) {
        if (error.name !== 'AbortError') {
          // Next interval retries.
        }
      } finally {
        inFlight = false;
      }
    };

    loadLiveView();
    const interval = setInterval(loadLiveView, 2000);
    return () => {
      controller.abort();
      clearInterval(interval);
      if (liveViewUrlRef.current) {
        URL.revokeObjectURL(liveViewUrlRef.current);
        liveViewUrlRef.current = '';
      }
    };
  }, [authFetch, botsRunning]);

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
        <h3 className="control-header-content">
          Фарм профилей
          <div className="control-status-group">
            <div className={`status-dot${botStatus.index ? ' active' : ''}`} />
          </div>
        </h3>
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
      </div>

      <div className="control-card">
        <h3 className="control-header-content">
          Фарм доноров
          <div className="control-status-group">
            <div className={`status-dot${botStatus.parser ? ' active' : ''}`} />
          </div>
        </h3>
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
      </div>

      <div className="control-card logs-card">
        <div className="logs-header" style={{ marginBottom: 12 }}>
          <h3 className="control-header-content gap-10">
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
          </div>
        </div>
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
      </div>

      <div className="stream-card">
        <div className="logs-header">
          <h3 style={{ margin: 0 }}>Стрим</h3>
          <div className={`status-dot${botsRunning ? ' active' : ''}`} />
        </div>
        <div className="stream-container" onClick={() => setIsZoomed(true)}>
            <img
              src={liveViewSrc}
              className={botsRunning && liveViewSrc ? 'block' : 'hidden'}
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
      </div>

      {isZoomed && (
        <div className="stream-overlay-full" onClick={() => setIsZoomed(false)}>
          <img src={liveViewSrc} alt="Live View Full" />
        </div>
      )}
    </div>
  );
}
