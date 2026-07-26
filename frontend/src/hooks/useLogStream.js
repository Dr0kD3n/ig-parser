import { useEffect, useState } from 'react';

const RETRY_DELAY_MS = 3000;

function appendSseEvents(buffer, onEvent) {
  const events = buffer.split(/\r?\n\r?\n/);
  const remainder = events.pop() || '';

  for (const event of events) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    try {
      onEvent(JSON.parse(data));
    } catch {
      // Ignore one malformed event; keep stream alive.
    }
  }

  return remainder;
}

function waitForRetry(signal) {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, RETRY_DELAY_MS);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

export function useLogStream(enabled, authFetch, limit) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();

    const connect = async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await authFetch('/api/logs', {
            headers: { Accept: 'text/event-stream' },
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            throw new Error(`Log stream HTTP ${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            buffer = appendSseEvents(buffer, (entry) => {
              setLogs((current) => [...current, entry].slice(-limit));
            });
          }
        } catch (error) {
          if (error.name === 'AbortError' || controller.signal.aborted) break;
        }

        await waitForRetry(controller.signal);
      }
    };

    connect();
    return () => controller.abort();
  }, [authFetch, enabled, limit]);

  return [logs, setLogs];
}
