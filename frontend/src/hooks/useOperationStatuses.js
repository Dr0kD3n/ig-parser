import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';

const IDLE_STATUS = { running: false, current: 0, total: 0, status: 'Idle' };
const RESTORE_IDLE_STATUS = { running: false, current: 0, total: 0 };

function useStatusPolling({ enabled, intervalMs, path, authFetch, onStatus }) {
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    if (!enabled) return undefined;

    const poll = async () => {
      try {
        const response = await authFetch(path);
        if (!response.ok) return;
        onStatusRef.current(await response.json());
      } catch {
        // Next interval retries.
      }
    };

    const interval = setInterval(poll, intervalMs);
    return () => clearInterval(interval);
  }, [authFetch, enabled, intervalMs, path]);
}

export function useOperationStatuses({ enabled, authFetch, onProfilesChange }) {
  const [tgCheckStatus, setTgCheckStatus] = useState(IDLE_STATUS);
  const [restoreStatus, setRestoreStatus] = useState(RESTORE_IDLE_STATUS);
  const [massMessagingStatus, setMassMessagingStatus] = useState(IDLE_STATUS);

  useStatusPolling({
    enabled: restoreStatus.running,
    intervalMs: 3000,
    path: '/api/profiles/restore-photos/status',
    authFetch,
    onStatus: (data) => {
      setRestoreStatus(data);
      if (data.error) {
        toast.error(`Ошибка восстановления: ${data.error}`);
      } else if (data.running) {
        onProfilesChange();
      } else if (data.done) {
        toast.success(`Обновлено профилей: ${data.result?.updatedCount || 0}`);
        onProfilesChange();
      }
    },
  });

  useStatusPolling({
    enabled: massMessagingStatus.running,
    intervalMs: 3000,
    path: '/api/mass-messages/status',
    authFetch,
    onStatus: (data) => {
      setMassMessagingStatus(data);
      if (!data.running) {
        if (data.status === 'Done') toast.success('Рассылка завершена');
        onProfilesChange();
      }
    },
  });

  useStatusPolling({
    enabled: tgCheckStatus.running,
    intervalMs: 2000,
    path: '/api/check-telegram-batch/status',
    authFetch,
    onStatus: (data) => {
      setTgCheckStatus(data);
      if (data.running) {
        onProfilesChange();
      } else {
        if (data.status === 'Done') {
          toast.success(`TG проверено: ${data.current}/${data.total}`);
        } else if (data.stopped) {
          toast('Проверка TG остановлена');
        }
        onProfilesChange();
      }
    },
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();

    const restoreRunningStatuses = async () => {
      const operations = [
        ['/api/check-telegram-batch/status', setTgCheckStatus],
        ['/api/mass-messages/status', setMassMessagingStatus],
        ['/api/profiles/restore-photos/status', setRestoreStatus],
      ];
      await Promise.all(
        operations.map(async ([path, setStatus]) => {
          try {
            const response = await authFetch(path, { signal: controller.signal });
            if (!response.ok) return;
            const data = await response.json();
            if (data.running) setStatus(data);
          } catch (error) {
            if (error.name !== 'AbortError') {
              // Initial status recovery is best-effort.
            }
          }
        })
      );
    };

    restoreRunningStatuses();
    return () => controller.abort();
  }, [authFetch, enabled]);

  return {
    tgCheckStatus,
    setTgCheckStatus,
    restoreStatus,
    setRestoreStatus,
    massMessagingStatus,
    setMassMessagingStatus,
  };
}
