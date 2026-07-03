import React, { useState, useEffect, startTransition } from 'react';
import { CITIES_PRESETS } from '../constants/cities';
import SkeletonSettings from './settings/SkeletonSettings';
import AccountsSection from './settings/AccountsSection';
import DonorsSettingsSection from './settings/DonorsSettingsSection';

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

  if (isLoading) return <SkeletonSettings />;

  return (
    <div className="settings-wrap tab-content-fade">
      <div className="settings-header">
        <div className="settings-nested-tabs">
          {['accounts', 'names', 'cities', 'blacklist', 'niches', 'donors'].map((tab) => (
            <button
              key={tab}
              className={`tab-btn${settingsTab === tab ? ' active' : ''}`}
              onClick={() => handleSettingsTabChange(tab)}
            >
              {({ accounts: 'Аккаунты', names: 'Имена', cities: 'Города', blacklist: 'Блеклист', niches: 'Ниши', donors: 'Доноры' })[tab]}
            </button>
          ))}
        </div>
        <div className="header-right gap-20">
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
          <textarea
            className="msg-textarea"
            style={{ height: 500, margin: '0 32px' }}
            value={(settingsData.niches || []).join('\n')}
            onChange={(e) => onSettingsChange({ niches: e.target.value.split('\n') })}
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
    </div>
  );
}
