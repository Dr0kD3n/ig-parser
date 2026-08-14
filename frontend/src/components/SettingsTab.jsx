import { useState, useEffect, useCallback, startTransition } from 'react';
import { toast } from 'react-hot-toast';
import { CITIES_PRESETS } from '../constants/cities';
import SkeletonSettings from './settings/SkeletonSettings';
import AccountsSection from './settings/AccountsSection';
import DonorsSettingsSection from './settings/DonorsSettingsSection';
import NichePresetsSection from './settings/NichePresetsSection';
import TelegramAgentSection from './settings/TelegramAgentSection';
import ChangesSection from './settings/ChangesSection';

const SETTINGS_TABS = [
  'accounts',
  'names',
  'cities',
  'blacklist',
  'niches',
  'donors',
  'automation',
  'telegram',
  'changes',
];
const SETTINGS_TAB_LABELS = {
  accounts: 'Аккаунты',
  names: 'Имена',
  cities: 'Города',
  blacklist: 'Блеклист',
  niches: 'Ниши',
  donors: 'Доноры',
  automation: 'Авточек',
  telegram: 'Telegram',
  changes: 'Изменения',
};

export default function SettingsTab({
  settingsData,
  onSettingsChange,
  onDonorsRefresh,
  isLoading,
  authFetch,
  failedUrls,
}) {
  const [settingsTab, setSettingsTab] = useState(() => localStorage.getItem('ig_settings_tab') || 'accounts');
  const [donorsMounted, setDonorsMounted] = useState(
    () => localStorage.getItem('ig_settings_tab') === 'donors'
  );
  const [donorsReady, setDonorsReady] = useState(false);
  const [feedbackStatus, setFeedbackStatus] = useState({
    running: false,
    current: 0,
    total: 0,
    found: 0,
    status: 'Ожидание',
  });
  const [feedbackActionBusy, setFeedbackActionBusy] = useState(false);

  const handleSettingsTabChange = (tab) => {
    if (tab === 'donors') setDonorsMounted(true);
    startTransition(() => setSettingsTab(tab));
    localStorage.setItem('ig_settings_tab', tab);
  };

  useEffect(() => {
    if (!donorsMounted || settingsTab !== 'donors') return;
    if (donorsReady) return;
    let cancelled = false;
    const mount = () => {
      if (!cancelled) setDonorsReady(true);
    };
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(mount, { timeout: 250 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }
    const id = setTimeout(mount, 16);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [donorsMounted, settingsTab, donorsReady]);

  const loadFeedbackStatus = useCallback(async () => {
    const response = await authFetch('/api/feedback/status');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    setFeedbackStatus(data);
    return data;
  }, [authFetch]);

  useEffect(() => {
    if (settingsTab !== 'automation') return undefined;
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await authFetch('/api/feedback/status');
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setFeedbackStatus(data);
      } catch {
        // Следующий polling повторит запрос.
      }
    };
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [settingsTab, authFetch]);

  const handleFeedbackAction = async () => {
    setFeedbackActionBusy(true);
    try {
      const shouldStop = feedbackStatus.running || feedbackStatus.starting;
      const response = await authFetch(`/api/feedback/${shouldStop ? 'stop' : 'start'}`, {
        method: 'POST',
      });
      const data = await response.json();
      if (!response.ok) {
        const message =
          data.reason === 'busy'
            ? `Instagram занят: ${data.activity || 'другая операция'}`
            : data.error || 'Не удалось запустить проверку';
        throw new Error(message);
      }
      toast.success(shouldStop ? 'Остановка проверки запрошена' : 'Проверка Primary запущена');
      await loadFeedbackStatus();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setFeedbackActionBusy(false);
    }
  };

  const senderAccounts = (settingsData.activeServerAccountIds || [])
    .map((id) => (settingsData.accounts || []).find((account) => account.id === id))
    .filter(Boolean);

  if (isLoading) return <SkeletonSettings />;

  return (
    <div className="settings-wrap tab-content-fade">
      <div className="settings-header">
        <div className="settings-nested-tabs">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab}
              className={`tab-btn${settingsTab === tab ? ' active' : ''}`}
              onClick={() => handleSettingsTabChange(tab)}
            >
              {SETTINGS_TAB_LABELS[tab]}
            </button>
          ))}
        </div>
        <div className="header-right gap-20">
          <label className="checkbox-label checkbox" title="Графитовая чёрно-белая палитра">
            <input
              type="checkbox"
              checked={settingsData.monochromeMode === true}
              onChange={(e) => onSettingsChange({ monochromeMode: e.target.checked })}
            />
            Монохром
          </label>
          <label className="checkbox-label checkbox">
            <input
              type="checkbox"
              checked={settingsData.humanEmulation || false}
              onChange={(e) => onSettingsChange({ humanEmulation: e.target.checked })}
            />
            {"Эмуляция человека"}
          </label>
          <label className="checkbox-label checkbox">
            <input
              type="checkbox"
              checked={settingsData.showBrowser || false}
              onChange={(e) => onSettingsChange({ showBrowser: e.target.checked })}
            />
            {"Показывать браузер"}
          </label>
          <label className="checkbox-label">
            {"Потоков:"}
            <input
              type="number"
              min="1"
              max="20"
              value={settingsData.concurrentProfiles || 3}
              className="num-input-sm"
              onChange={(e) =>
                onSettingsChange({ concurrentProfiles: parseInt(e.target.value, 10) || 1 })
              }
            />
          </label>
          <label className="checkbox-label">
            {"Лимит DM:"}
            <input
              type="number"
              min="1"
              value={settingsData.dmLimit || 200}
              className="num-input-sm"
              style={{ width: '60px' }}
              onChange={(e) => onSettingsChange({ dmLimit: parseInt(e.target.value, 10) || 1 })}
            />
          </label>
        </div>
      </div>

      {settingsTab === 'accounts' && (
        <AccountsSection
          settingsData={settingsData}
          onSettingsChange={onSettingsChange}
          authFetch={authFetch}
          failedUrls={failedUrls}
        />
      )}

      {
        settingsTab === 'names' && (
          <textarea
            className="msg-textarea"
            style={{ height: 500, margin: '0 32px' }}
            value={(settingsData.names || []).join('\n')}
            onChange={(e) => onSettingsChange({ names: e.target.value.split('\n') })}
          />
        )
      }

      {
        settingsTab === 'cities' && (
          <div className="settings-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            <div className="flex-v gap-8">
              <div className="flex-between align-center">
                <label className="fs-14 font-bold">{"Белый список (Обязательно)"}</label>
                <select
                  className="search-input py-4 px-8 fs-12 w-auto"
                  value=""
                  onChange={(e) => {
                    const val = e.target.value;
                    if (!val) return;
                    onSettingsChange({ cities: val.split('\n') });
                  }}
                >
                  <option value="" selected disabled>Выбрать город</option>
                  {CITIES_PRESETS.map(c => <option key={c.name} value={c.value}>{c.name}</option>)}
                </select>
              </div>
              <textarea
                className="msg-textarea"
                style={{ height: 500 }}
                value={(settingsData.cities || []).join('\n')}
                onChange={(e) => onSettingsChange({ cities: e.target.value.split('\n') })}
                placeholder="Москва\nПитер..."
              />
            </div>
            <div className="flex-v gap-8">
              <div className="flex-between align-center">
                <label className="fs-14 font-bold">{"Черный список (Исключить)"}</label>
                <select
                  className="search-input py-4 px-8 fs-12 w-auto"
                  value=""
                  onChange={(e) => {
                    const selectedVal = e.target.value;
                    if (!selectedVal) return;
                    const allOthers = CITIES_PRESETS
                      .filter(c => c.value !== selectedVal)
                      .map(c => c.value)
                      .join('\n')
                      .split('\n');
                    onSettingsChange({ citiesBlacklist: allOthers });
                  }}
                >
                  <option value="" selected disabled>Выбрать город</option>
                  {CITIES_PRESETS.map(c => <option key={c.name} value={c.value}>{c.name}</option>)}
                </select>
              </div>
              <textarea
                className="msg-textarea"
                style={{ height: 500 }}
                value={(settingsData.citiesBlacklist || []).join('\n')}
                onChange={(e) => onSettingsChange({ citiesBlacklist: e.target.value.split('\n') })}
                placeholder="Лондон\nПариж..."
              />
            </div>
          </div>
        )
      }

      {
        settingsTab === 'blacklist' && (
          <div className="flex-v gap-8">
            <textarea
              className="msg-textarea"
              style={{ height: 500, margin: '0 32px' }}
              value={(settingsData.wordsBlacklist || []).join('\n')}
              onChange={(e) => onSettingsChange({ wordsBlacklist: e.target.value.split('\n') })}
              placeholder={'магазин\nshop\ncrypto\nреклама...'}
            />
          </div>
        )
      }
      {
        settingsTab === 'niches' && (
          <NichePresetsSection
            niches={settingsData.niches || []}
            presets={settingsData.nichePresets || []}
            onChange={onSettingsChange}
          />
        )
      }

      {donorsMounted && (
        <div style={{ display: settingsTab === 'donors' ? 'block' : 'none' }} aria-hidden={settingsTab !== 'donors'}>
          {donorsReady ? (
            <DonorsSettingsSection
              settingsData={settingsData}
              onSettingsChange={onSettingsChange}
              onDonorsRefresh={onDonorsRefresh}
              authFetch={authFetch}
            />
          ) : (
            <div className="skeleton-item skeleton h-400" />
          )}
        </div>
      )}

      {settingsTab === 'automation' && (
        <div className="automation-settings">
          <section className="automation-settings-card">
            <div>
              <h3>Автоматическая проверка ответов</h3>
              <p>
                Бот открывает только Primary, читает preview последнего сообщения, не открывает
                диалоги.
              </p>
            </div>
            <div className="automation-status-row">
              <div>
                <strong>
                  {feedbackStatus.running || feedbackStatus.starting
                    ? feedbackStatus.status || 'Запуск...'
                    : 'Проверка не запущена'}
                </strong>
                <span>
                  {feedbackStatus.running
                    ? `${feedbackStatus.current || 0}/${feedbackStatus.total || 0}, найдено: ${feedbackStatus.found || 0}`
                    : `Сендеры: ${senderAccounts.map((account) => account.name).join(', ') || 'не выбраны'}`}
                </span>
              </div>
              <button
                type="button"
                className={`btn-primary btn-sm${feedbackStatus.running ? ' btn-danger' : ''}`}
                disabled={
                  feedbackActionBusy ||
                  (!feedbackStatus.running && !feedbackStatus.starting && senderAccounts.length === 0)
                }
                onClick={handleFeedbackAction}
              >
                {feedbackActionBusy
                  ? 'Подождите...'
                  : feedbackStatus.running || feedbackStatus.starting
                    ? 'Остановить'
                    : 'Проверить сейчас'}
              </button>
            </div>
            <label className="checkbox-label checkbox">
              <input
                type="checkbox"
                checked={settingsData.feedbackCheckEnabled === true}
                onChange={(event) =>
                  onSettingsChange({ feedbackCheckEnabled: event.target.checked })
                }
              />
              Включить автопроверку
            </label>
            <label className="automation-interval-field">
              <span>Интервал проверки</span>
              <div>
                <input
                  type="number"
                  min="5"
                  max="1440"
                  value={settingsData.feedbackCheckIntervalMinutes || 60}
                  disabled={!settingsData.feedbackCheckEnabled}
                  onChange={(event) =>
                    onSettingsChange({
                      feedbackCheckIntervalMinutes: Math.min(
                        1440,
                        Math.max(5, parseInt(event.target.value, 10) || 5)
                      ),
                    })
                  }
                />
                <span>минут</span>
              </div>
            </label>
            <p className="automation-settings-note">
              Минимум 5 минут. Проверка ждёт освобождения Instagram, использует только аккаунты
              с выбранной ролью «Сендер». Неоднозначные совпадения пропускаются.
            </p>
          </section>
        </div>
      )}

      {settingsTab === 'telegram' && <TelegramAgentSection authFetch={authFetch} />}

      {settingsTab === 'changes' && <ChangesSection />}
    </div>
  );
}
