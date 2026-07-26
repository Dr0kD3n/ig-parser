/* eslint-disable react/prop-types */
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';

async function readResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export default function TelegramAgentSection({ authFetch }) {
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState('');
  const [pairing, setPairing] = useState(null);
  const [busy, setBusy] = useState('');
  const pairingRequestInFlight = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await authFetch('/api/telegram-bot/status', { cache: 'no-store' });
      setStatus(await readResponse(response));
    } catch (error) {
      setStatus({ configured: false, running: false, error: error.message });
    }
  }, [authFetch]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const saveToken = async () => {
    if (!token.trim()) {
      toast.error('Вставьте BotFather token');
      return;
    }
    setBusy('token');
    try {
      const response = await authFetch('/api/telegram-bot/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await readResponse(response);
      setStatus(data);
      setToken('');
      setPairing(null);
      toast.success('Telegram-бот запущен');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const createPairing = async () => {
    if (pairingRequestInFlight.current) return;
    pairingRequestInFlight.current = true;
    setBusy('pair');
    try {
      const response = await authFetch('/api/telegram-bot/pair', { method: 'POST' });
      const data = await readResponse(response);
      setPairing(data);
      await refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      pairingRequestInFlight.current = false;
      setBusy('');
    }
  };

  const copyPairingLink = async () => {
    if (!pairing?.deepLink) return;
    await navigator.clipboard.writeText(pairing.deepLink);
    toast.success('Ссылка скопирована');
  };

  const unpair = async () => {
    setBusy('unpair');
    try {
      await readResponse(
        await authFetch('/api/telegram-bot/pair', {
          method: 'DELETE',
        })
      );
      setPairing(null);
      await refresh();
      toast.success('Telegram-пользователь отвязан');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const toggleService = async () => {
    const shouldStart = !status?.running;
    setBusy('service');
    try {
      const data = await readResponse(
        await authFetch(`/api/telegram-bot/${shouldStart ? 'start' : 'stop'}`, {
          method: 'POST',
        })
      );
      setStatus(data);
      toast.success(shouldStart ? 'Telegram-сервис запущен' : 'Telegram-сервис остановлен');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy('');
    }
  };

  const configured = !!status?.configured;
  const owner = status?.owner;

  return (
    <div className="telegram-settings">
      <section className="telegram-settings-card">
        <div className="telegram-settings-head">
          <div>
            <h3>Локальный Telegram-бот</h3>
            <p>Работает только пока запущен локальный сервис. Token хранится зашифрованно.</p>
          </div>
          <span className={`telegram-status ${status?.running ? 'online' : 'offline'}`}>
            {status?.running ? 'Сервис запущен' : 'Сервис остановлен'}
          </span>
        </div>

        {configured && (
          <div className="telegram-bot-identity">
            <strong>{status.botUsername ? `@${status.botUsername}` : 'Бот настроен'}</strong>
            <span>
              Локальный сервер: {status.running ? 'работает' : 'остановлен'} · Telegram API:{' '}
              {status.connected ? 'подключён' : status.lastError || 'нет соединения'}
            </span>
          </div>
        )}

        <label className="telegram-field">
          <span>{configured ? 'Заменить BotFather token' : 'BotFather token'}</span>
          <div className="telegram-token-row">
            <input
              type="password"
              className="search-input"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="123456789:AA..."
              autoComplete="off"
            />
            <button className="btn-primary" onClick={saveToken} disabled={busy === 'token'}>
              {busy === 'token' ? 'Проверка...' : configured ? 'Заменить' : 'Подключить'}
            </button>
          </div>
        </label>
      </section>

      {configured && (
        <section className="telegram-settings-card">
          <div className="telegram-settings-head">
            <div>
              <h3>Владелец бота</h3>
              <p>Команды принимает только от привязанного Telegram-пользователя.</p>
            </div>
          </div>

          {owner ? (
            <div className="telegram-owner-row">
              <div>
                <strong>
                  {owner.username ? `@${owner.username}` : owner.firstName || 'Привязан'}
                </strong>
                <span>Telegram ID: {owner.userId}</span>
              </div>
              <button
                className="btn-primary btn-outline"
                onClick={unpair}
                disabled={busy === 'unpair'}
              >
                Отвязать
              </button>
            </div>
          ) : (
            <div className="telegram-pairing">
              <button className="btn-primary" onClick={createPairing} disabled={busy === 'pair'}>
                {busy === 'pair' ? 'Создание...' : 'Создать ссылку привязки'}
              </button>
              {pairing?.deepLink && (
                <div className="telegram-pairing-link">
                  <a href={pairing.deepLink} target="_blank" rel="noreferrer">
                    Открыть @{status.botUsername} и привязать
                  </a>
                  <button className="btn-primary btn-outline" onClick={copyPairingLink}>
                    Копировать
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {configured && (
        <section className="telegram-settings-card">
          <div className="telegram-settings-head">
            <div>
              <h3>Команды</h3>
              <p>Доступны только привязанному владельцу, пока локальный сервис запущен.</p>
            </div>
          </div>
          <ul className="telegram-commands">
            <li>
              <code>/status</code> — workers, рассылка, слот
            </li>
            <li>
              <code>/worker_start index|parser|checker</code>
            </li>
            <li>
              <code>/worker_stop index|parser|checker</code>
            </li>
            <li>
              <code>/mass_status</code> / <code>/mass_stop</code>
            </li>
            <li>
              <code>/schedule</code> — следующий слот
            </li>
            <li>
              <code>/skip_donor</code> — пропуск донора
            </li>
          </ul>
        </section>
      )}

      {configured && (
        <section className="telegram-settings-card telegram-danger">
          <div>
            <h3>{status?.running ? 'Остановить Telegram-сервис' : 'Запустить Telegram-сервис'}</h3>
            <p>Зашифрованный token и привязка владельца сохраняются после остановки.</p>
          </div>
          <button
            className="btn-primary btn-outline"
            onClick={toggleService}
            disabled={busy === 'service'}
          >
            {busy === 'service' ? 'Подождите...' : status?.running ? 'Остановить' : 'Запустить'}
          </button>
        </section>
      )}
    </div>
  );
}
