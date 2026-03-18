import React, { useState, memo } from 'react';
import { EditIcon, TrashIcon } from './Icons';
import { toast } from 'react-hot-toast';
const SkeletonSettings = memo(function SkeletonSettings() {
  return (
    <div className="settings-wrap tab-content-fade">
      <div className="settings-header">
        <div className="skeleton" style={{ width: 400, height: 40, borderRadius: 12 }} />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 320px',
          gap: '32px',
          padding: '0 32px',
        }}
      >
        <div>
          <div className="skeleton-item skeleton h-200" />
          <div className="skeleton-item skeleton h-200" />
        </div>
        <div>
          <div className="skeleton-item skeleton h-400" />
        </div>
      </div>
    </div>
  );
});
export default function SettingsTab({
  settingsData,
  onSettingsChange,
  tr,
  isLoading,
  authFetch,
  failedUrls,
}) {
  const [settingsTab, setSettingsTab] = useState('accounts');
  const [draggedItem, setDraggedItem] = useState(null);
  const [editingAccount, setEditingAccount] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    proxy: '',
    cookies: '',
    userAgent: '',
    fingerprint: '',
  });
  const [updateInfo, setUpdateInfo] = useState(null);
  const [isUpdating, setIsUpdating] = useState(false);

  React.useEffect(() => {
    const checkUpdates = async () => {
      try {
        const res = await authFetch('/api/update/check');
        const data = await res.json();
        setUpdateInfo(data);
      } catch (e) {
        console.error('Update check failed', e);
      }
    };
    checkUpdates();
  }, [authFetch]);

  const handleInstallUpdate = async () => {
    if (!window.confirm(tr('btn_install_update') + '?')) return;
    setIsUpdating(true);
    try {
      const res = await authFetch('/api/update/install', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success(data.message);
        // The backend will exit, so we should probably show a "Reconnecting..." state
      }
    } catch (e) {
      toast.error('Update failed: ' + e.message);
      setIsUpdating(false);
    }
  };
  const setAccounts = (accounts) => onSettingsChange({ ...settingsData, accounts });
  const handleAdd = () => {
    const nameEl = document.getElementById('new-acc-name');
    const proxyEl = document.getElementById('new-acc-proxy');
    const cookiesEl = document.getElementById('new-acc-cookies');
    const name = nameEl.value.trim();
    const cookies = cookiesEl.value.trim();
    if (!name) {
      toast.error(tr('name_placeholder'));
      return;
    }
    setAccounts([
      ...settingsData.accounts,
      { id: Date.now().toString(), name, proxy: proxyEl.value.trim(), cookies },
    ]);
    nameEl.value = '';
    proxyEl.value = '';
    cookiesEl.value = '';
  };
  const handleDelete = (id) => {
    const newAccs = settingsData.accounts.filter((a) => a.id !== id);
    const updateArr = (field) => {
      const arr = settingsData[field];
      if (Array.isArray(arr)) {
        return arr.filter((aid) => aid !== id);
      }
      return arr;
    };
    onSettingsChange({
      ...settingsData,
      accounts: newAccs,
      activeParserAccountIds: updateArr('activeParserAccountIds'),
      activeServerAccountIds: updateArr('activeServerAccountIds'),
      activeIndexAccountIds: updateArr('activeIndexAccountIds'),
      activeProfilesAccountIds: updateArr('activeProfilesAccountIds'),
    });
  };
  const toggleAccountForTask = (field, id) => {
    const arr = settingsData[field] || [];
    const newArr = arr.includes(id) ? arr.filter((aid) => aid !== id) : [...arr, id];
    onSettingsChange({ ...settingsData, [field]: newArr });
  };
  const handleStartEdit = (acc) => {
    setEditingAccount(acc.id);
    let fp = {};
    try {
      fp = JSON.parse(acc.fingerprint || '{}');
    } catch (e) { }
    setEditForm({
      name: acc.name,
      proxy: acc.proxy || '',
      cookies: acc.cookies || '',
      userAgent: fp.userAgent || '',
      fingerprint: acc.fingerprint || '{}',
    });
  };
  const handleSaveEdit = async (id) => {
    try {
      // Prepare data, only include cookies if they were changed
      const data = { ...editForm };
      if (!data.cookies) delete data.cookies;

      // Sync userAgent back into fingerprint JSON if it was edited
      try {
        let fp = JSON.parse(data.fingerprint || '{}');
        if (data.userAgent !== fp.userAgent) {
          fp.userAgent = data.userAgent;
          data.fingerprint = JSON.stringify(fp);
        }
      } catch (e) { }

      await authFetch(`/api/accounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      // Update local state
      const updatedAccounts = settingsData.accounts.map((a) =>
        a.id === id ? { ...a, ...data, fingerprint: data.fingerprint } : a
      );
      onSettingsChange({ ...settingsData, accounts: updatedAccounts });
      setEditingAccount(null);
      toast.success(tr('save_success') || 'Account updated');
    } catch (e) {
      console.error('Error saving account:', e);
      toast.error('Error saving: ' + e.message);
    }
  };
  const handleLogin = async (id) => {
    try {
      const res = await authFetch(`/api/accounts/${id}/authorize/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success) toast.success(tr('login_success'));
      else toast.error(data.error);
    } catch (e) {
      toast.error(e.message);
    }
  };
  const handleOpenBrowser = async (id, forceRestore = false) => {
    try {
      const url = `/api/accounts/${id}/browser/start${forceRestore ? '?restore=true' : ''}`;
      const res = await authFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ failedUrls }),
      });
      const data = await res.json();
      if (data.success)
        toast.success(
          forceRestore
            ? tr('browser_restore_success') || 'Browser opened with auto-photo-load'
            : tr('browser_success')
        );
      else toast.error(data.error);
    } catch (e) {
      toast.error(e.message);
    }
  };
  const handleWarmup = async (id) => {
    try {
      const res = await authFetch(`/api/accounts/${id}/warmup`, { method: 'POST' });
      const data = await res.json();
      if (data.success) toast.success(tr('warmup_started'));
      else toast.error(data.error);
    } catch (e) {
      toast.error(e.message);
    }
  };
  const onDragStart = (e, index, field) => {
    setDraggedItem({ index, field });
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e, index, field) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.field !== field) return;
    if (draggedItem.index === index) return;
    const arr = [...settingsData[field]];
    const item = arr.splice(draggedItem.index, 1)[0];
    arr.splice(index, 0, item);
    onSettingsChange({ ...settingsData, [field]: arr });
    setDraggedItem({ ...draggedItem, index });
  };
  const renderTaskSection = (field, label) => {
    const activeIds = settingsData[field] || [];
    const activeAccounts = activeIds
      .map((id) => settingsData.accounts.find((a) => a.id === id))
      .filter((a) => !!a);
    return (
      <div className="task-section-card">
        <h4 className="task-section-title">{label}</h4>
        <div className="flex-v gap-8">
          {activeAccounts.length === 0 && (
            <div className="no-accs-placeholder">{tr('no_accounts_selected')}</div>
          )}
          {activeAccounts.map((acc, idx) => (
            <div
              key={acc.id}
              draggable
              onDragStart={(e) => onDragStart(e, idx, field)}
              onDragOver={(e) => onDragOver(e, idx, field)}
              className="active-acc-item"
              onMouseEnter={(e) => e.currentTarget.classList.add('border-primary')}
              onMouseLeave={(e) => e.currentTarget.classList.remove('border-primary')}
            >
              <span className="drag-handle">☰</span>
              <span className="acc-name-label">{acc.name}</span>
              <button
                onClick={() => toggleAccountForTask(field, acc.id)}
                className="acc-remove-btn"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  };
  if (isLoading) return <SkeletonSettings />;
  return (
    <div className="settings-wrap tab-content-fade">
      <div className="settings-header">
        <div className="settings-nested-tabs">
          {['accounts', 'names', 'cities', 'niches', 'donors'].map((tab) => (
            <button
              key={tab}
              className={`tab-btn${settingsTab === tab ? ' active' : ''}`}
              onClick={() => setSettingsTab(tab)}
            >
              {tr(`tab_${tab}`)}
            </button>
          ))}
        </div>
        <div className="header-right gap-20">
          <label className="checkbox-label checkbox">
            <input
              type="checkbox"
              checked={settingsData.humanEmulation || false}
              onChange={(e) =>
                onSettingsChange({ ...settingsData, humanEmulation: e.target.checked })
              }
            />
            {tr('human_emulation')}
          </label>
          <label className="checkbox-label checkbox">
            <input
              type="checkbox"
              checked={settingsData.showBrowser || false}
              onChange={(e) => onSettingsChange({ ...settingsData, showBrowser: e.target.checked })}
            />
            {tr('show_browser')}
          </label>
          <label className="checkbox-label">
            {tr('concurrent_profiles')}
            <input
              type="number"
              min="1"
              max="20"
              value={settingsData.concurrentProfiles || 3}
              className="num-input-sm"
              onChange={(e) =>
                onSettingsChange({
                  ...settingsData,
                  concurrentProfiles: parseInt(e.target.value) || 1,
                })
              }
            />
          </label>
          {updateInfo?.hasUpdate && (
            <button
              className={`btn-primary btn-sm ${isUpdating ? 'loading' : ''}`}
              onClick={handleInstallUpdate}
              disabled={isUpdating}
              style={{ backgroundColor: 'var(--accent-color)', marginLeft: '10px' }}
            >
              {isUpdating
                ? tr('checking_updates')
                : tr('update_available').replace('{version}', updateInfo.latestVersion)}
            </button>
          )}
        </div>
      </div>

      {settingsTab === 'accounts' && (
        <div className="settings-grid">
          <div className="tasks-columns">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              {renderTaskSection('activeParserAccountIds', tr('task_parser'))}
              {renderTaskSection('activeIndexAccountIds', tr('task_scraper'))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              {renderTaskSection('activeServerAccountIds', tr('task_sender'))}
              {renderTaskSection('activeProfilesAccountIds', tr('task_profiles'))}
            </div>
            <div className="add-acc-card">
              <h4 className="mb-20 fs-18">{tr('add_account')}</h4>
              <div className="flex gap-16 mb-16">
                <input
                  type="text"
                  id="new-acc-name"
                  placeholder={tr('name_placeholder')}
                  className="search-input w-full"
                />
                <input
                  type="text"
                  id="new-acc-proxy"
                  placeholder={tr('proxy_placeholder')}
                  className="search-input w-full"
                />
              </div>
              <textarea
                id="new-acc-cookies"
                placeholder={tr('cookies_placeholder')}
                className="msg-textarea cookies h-100 mb-20"
              />
              <button className="btn-primary w-full" onClick={handleAdd}>
                {tr('btn_add')}
              </button>
            </div>
          </div>

          <div className="all-accounts-column">
            <h4 style={{ marginBottom: '20px', fontSize: '18px' }}>{tr('all_accounts')}</h4>
            <div className="flex-v gap-12">
              {settingsData.accounts.map((acc) => (
                <div key={acc.id} className="account-card">
                  {editingAccount === acc.id ? (
                    <div className="flex-v gap-10">
                      <input
                        type="text"
                        className="search-input"
                        placeholder={tr('edit_name')}
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                      />
                      <input
                        type="text"
                        className="search-input fs-13 font-mono"
                        placeholder={tr('edit_proxy')}
                        value={editForm.proxy}
                        onChange={(e) => setEditForm({ ...editForm, proxy: e.target.value })}
                      />
                      <input
                        type="text"
                        className="search-input fs-12 font-mono"
                        placeholder="User-Agent"
                        value={editForm.userAgent}
                        onChange={(e) => setEditForm({ ...editForm, userAgent: e.target.value })}
                      />
                      <textarea
                        className="msg-textarea cookies h-80 fs-11 font-mono"
                        placeholder="System Data (Fingerprint JSON)"
                        value={editForm.fingerprint}
                        onChange={(e) => setEditForm({ ...editForm, fingerprint: e.target.value })}
                      />
                      <textarea
                        className="msg-textarea cookies h-60 fs-12 font-mono"
                        placeholder={tr('edit_cookies')}
                        value={editForm.cookies}
                        onChange={(e) => setEditForm({ ...editForm, cookies: e.target.value })}
                      />
                      <div className="flex gap-8">
                        <button
                          className="btn-primary btn-outline btn-sm flex-1 fs-11"
                          onClick={async () => {
                            if (window.confirm('Regenerate System Data?')) {
                              try {
                                const res = await authFetch(`/api/accounts/${acc.id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ regenerateFingerprint: true }),
                                });
                                const data = await res.json();
                                if (data.success && data.fingerprint) {
                                  toast.success(tr('regenerate_success'));
                                  let fp = {};
                                  try {
                                    fp = JSON.parse(data.fingerprint);
                                  } catch (e) { }
                                  setEditForm((prev) => ({
                                    ...prev,
                                    fingerprint: data.fingerprint,
                                    userAgent: fp.userAgent || prev.userAgent,
                                  }));
                                  // Sync global state
                                  const updatedAccs = settingsData.accounts.map((a) =>
                                    a.id === acc.id ? { ...a, fingerprint: data.fingerprint } : a
                                  );
                                  onSettingsChange({ ...settingsData, accounts: updatedAccs });
                                }
                              } catch (e) {
                                toast.error(e.message);
                              }
                            }
                          }}
                        >
                          🔄 {tr('regenerate_system_data') || 'Regenerate System Data'}
                        </button>
                      </div>
                      <div className="flex gap-8">
                        <button
                          className="btn-primary btn-success btn-sm flex-1"
                          onClick={() => handleSaveEdit(acc.id)}
                        >
                          {tr('save_changes')}
                        </button>
                        <button
                          className="btn-primary btn-outline btn-sm btn-ghost flex-1 color-muted"
                          onClick={() => setEditingAccount(null)}
                        >
                          {tr('cancel')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex-between mb-4">
                        <div className="flex-1 flex-baseline gap-8">
                          <div className="font-bold fs-15">{acc.name}</div>
                          {acc.warmup_score > 0 && (
                            <div className="acc-card-score">{acc.warmup_score}%</div>
                          )}
                        </div>

                        <button
                          className="editBtn"
                          onClick={() => handleStartEdit(acc)}
                          title={tr('edit_title')}
                        >
                          <EditIcon />
                        </button>
                        <button
                          className="deleteBtn"
                          onClick={() => handleDelete(acc.id)}
                          title={tr('delete_title')}
                        >
                          <TrashIcon />
                        </button>
                      </div>
                      <div className="acc-proxy-text">{acc.proxy || tr('direct_connection')}</div>
                      <div className="flex-between align-end">
                        <div className="flex-wrap gap-6 flex-1">
                          {[
                            { field: 'activeParserAccountIds', label: tr('task_parser') },
                            { field: 'activeIndexAccountIds', label: tr('task_scraper') },
                            { field: 'activeServerAccountIds', label: tr('task_sender') },
                            { field: 'activeProfilesAccountIds', label: tr('task_profiles') },
                            { field: 'activeCheckerAccountIds', label: tr('task_checker') },
                          ].map((t) => {
                            const isActive = (settingsData[t.field] || []).includes(acc.id);
                            return (
                              <button
                                key={t.field}
                                onClick={() => toggleAccountForTask(t.field, acc.id)}
                                className={`acc-task-tag ${isActive ? 'active' : 'inactive'}`}
                              >
                                {t.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div className="acc-action-bar">
                        <button
                          onClick={() => handleLogin(acc.id)}
                          className="btn-acc-action btn-acc-login"
                        >
                          {tr('btn_login')}
                        </button>
                        <button
                          onClick={() => handleOpenBrowser(acc.id, true)}
                          className="btn-acc-action btn-acc-browser"
                        >
                          {tr('btn_open_browser')}
                        </button>
                        <button
                          onClick={() => handleWarmup(acc.id)}
                          className="btn-acc-action btn-acc-warmup"
                        >
                          {tr('btn_warmup')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {settingsTab === 'names' && (
        <textarea
          className="msg-textarea"
          style={{ height: 500 }}
          value={(settingsData.names || []).join('\n')}
          onChange={(e) => onSettingsChange({ ...settingsData, names: e.target.value.split('\n') })}
        />
      )}
      {settingsTab === 'cities' && (
        <textarea
          className="msg-textarea"
          style={{ height: 500 }}
          value={(settingsData.cities || []).join('\n')}
          onChange={(e) =>
            onSettingsChange({ ...settingsData, cities: e.target.value.split('\n') })
          }
        />
      )}
      {settingsTab === 'niches' && (
        <textarea
          className="msg-textarea"
          style={{ height: 500 }}
          value={(settingsData.niches || []).join('\n')}
          onChange={(e) =>
            onSettingsChange({ ...settingsData, niches: e.target.value.split('\n') })
          }
        />
      )}
      {settingsTab === 'donors' && (
        <textarea
          className="msg-textarea"
          style={{ height: 500 }}
          value={(settingsData.donors || []).join('\n')}
          onChange={(e) =>
            onSettingsChange({ ...settingsData, donors: e.target.value.split('\n') })
          }
        />
      )}
    </div>
  );
}
