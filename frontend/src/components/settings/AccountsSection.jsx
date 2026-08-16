import React, { useState } from 'react';
import { EditIcon, TrashIcon } from '../Icons';
import { toast } from 'react-hot-toast';
import { useDialog } from '../../context/DialogContext';

export default function AccountsSection({
  settingsData,
  onSettingsChange,
  authFetch,
  failedUrls,
}) {
  const { confirm } = useDialog();
  const [draggedItem, setDraggedItem] = useState(null);
  const [editingAccount, setEditingAccount] = useState(null);
  const [editForm, setEditForm] = useState({
    name: '',
    proxy: '',
    cookies: '',
    userAgent: '',
    fingerprint: '',
  });

  const setAccounts = (accounts) => onSettingsChange({ accounts });
  const handleAdd = () => {
    document.getElementById('new-account-advanced')?.removeAttribute('open');
    const nameEl = document.getElementById('new-acc-name');
    const proxyEl = document.getElementById('new-acc-proxy');
    const cookiesEl = document.getElementById('new-acc-cookies');
    const name = nameEl.value.trim();
    const cookies = cookiesEl.value.trim();
    if (!name) {
      toast.error("Имя (напр. Аккаунт 1)");
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
    onSettingsChange({ [field]: newArr });
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

      const res = await authFetch(`/api/accounts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      // Update local state
      const { userAgent: _ua, ...accountPatch } = data;
      const updatedAccounts = settingsData.accounts.map((a) =>
        a.id === id ? { ...a, ...accountPatch, fingerprint: data.fingerprint } : a
      );
      onSettingsChange({ accounts: updatedAccounts });
      setEditingAccount(null);
      toast.success('Аккаунт сохранен');
    } catch (e) {
      console.error('Error saving account:', e);
      toast.error('Error saving: ' + e.message);
    }
  };
  const handleLogin = async (id) => {
    try {
      const res = await authFetch(`/api/accounts/${id}/authorize/start`, { method: 'POST' });
      const data = await res.json();
      if (data.success) toast.success("Браузер запущен для логина");
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
            ? 'Браузер запущен (подгрузка фото)'
            : 'Профиль открыт в браузере'
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
      if (data.success) toast.success("Прогрев запущен");
      else toast.error(data.error);
    } catch (e) {
      toast.error(e.message);
    }
  };
  const handleInstagramCooldown = async (id) => {
    try {
      const res = await authFetch(`/api/accounts/${id}/instagram-cooldown`, { method: 'POST' });
      const data = await res.json();
      if (data.success) toast.success("Охлаждение IG запущено");
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
      onSettingsChange({ [field]: arr });
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
            <div className="no-accs-placeholder">{"Нет выбранных аккаунтов"}</div>
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

  return (
          <div className="settings-grid">
            <div className="tasks-columns">
              {renderTaskSection('activeParserAccountIds', "Для профилей")}
              {renderTaskSection('activeIndexAccountIds', "Для доноров")}
              {renderTaskSection('activeServerAccountIds', "Сендер")}
              <div className="add-acc-card">
                <div className="add-account-header">
                  <h4 className="fs-18">{"Добавить аккаунт"}</h4>
                  <button
                    type="button"
                    className="add-account-button"
                    onClick={handleAdd}
                    aria-label="Добавить аккаунт"
                    title="Добавить аккаунт"
                  >
                    +
                  </button>
                </div>
                <div className="add-account-fields">
                  <input
                    type="text"
                    id="new-acc-name"
                    placeholder={"Имя (напр. Аккаунт 1)"}
                    className="search-input w-full"
                  />
                  <details
                    id="new-account-advanced"
                    className="account-advanced-settings"
                    onBlur={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget)) {
                        event.currentTarget.removeAttribute('open');
                      }
                    }}
                  >
                    <summary>Дополнительно</summary>
                    <div className="account-advanced-fields">
                      <input
                        type="text"
                        id="new-acc-proxy"
                        placeholder={"Прокси: IP:PORT:USER:PASS"}
                        className="search-input w-full"
                      />
                      <textarea
                        id="new-acc-cookies"
                        placeholder={"Куки (raw text)"}
                        className="msg-textarea cookies h-100"
                      />
                    </div>
                  </details>
                </div>
              </div>
            </div>

            <div className="all-accounts-column">
              <h4 style={{ marginBottom: '20px', fontSize: '18px' }}>{"Все аккаунты"}</h4>
              <div className="flex-v gap-12">
                {settingsData.accounts.map((acc) => (
                  <div key={acc.id} className="account-card">
                    {editingAccount === acc.id ? (
                      <div className="flex-v gap-10">
                        <input
                          type="text"
                          className="search-input"
                          placeholder={"Имя"}
                          value={editForm.name}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        />
                        <input
                          type="text"
                          className="search-input fs-13 font-mono"
                          placeholder={"Прокси (host:port:user:pass)"}
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
                          placeholder={"Куки"}
                          value={editForm.cookies}
                          onChange={(e) => setEditForm({ ...editForm, cookies: e.target.value })}
                        />
                        <div className="flex gap-8">
                          <button
                            className="btn-primary btn-outline btn-sm flex-1 fs-11"
                            onClick={async () => {
                              const ok = await confirm({
                                title: 'Обновить отпечаток?',
                                message: 'Текущий fingerprint аккаунта будет заменён новым. Продолжить?',
                                confirmText: 'Обновить',
                              });
                              if (!ok) return;
                              try {
                                const res = await authFetch(`/api/accounts/${acc.id}`, {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ regenerateFingerprint: true }),
                                });
                                const data = await res.json();
                                if (data.success && data.fingerprint) {
                                  toast.success("Данные системы обновлены");
                                  let fp = {};
                                  try {
                                    fp = JSON.parse(data.fingerprint);
                                  } catch (e) { }
                                  setEditForm((prev) => ({
                                    ...prev,
                                    fingerprint: data.fingerprint,
                                    userAgent: fp.userAgent || prev.userAgent,
                                  }));
                                  const updatedAccs = settingsData.accounts.map((a) =>
                                    a.id === acc.id ? { ...a, fingerprint: data.fingerprint } : a
                                  );
                                  onSettingsChange({ accounts: updatedAccs });
                                }
                              } catch (e) {
                                toast.error(e.message);
                              }
                            }}
                          >
                            🔄 Обновить отпечаток
                          </button>
                        </div>
                        <div className="flex gap-8">
                          <button
                            className="btn-primary btn-success btn-sm flex-1"
                            onClick={() => handleSaveEdit(acc.id)}
                          >
                            {"Сохранить"}
                          </button>
                          <button
                            className="btn-primary btn-outline btn-sm btn-ghost flex-1 color-muted"
                            onClick={() => setEditingAccount(null)}
                          >
                            {"Отмена"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-between mb-4">
                          <div className="flex-1 flex-baseline gap-8">
                            <div className="font-bold fs-15">{acc.name}</div>
                            {acc.warmup_running && (
                              <div className="acc-card-score running">
                                {acc.warmup_progress || 0}%
                              </div>
                            ) || (acc.warmup_score > 0 && (
                              <div className="acc-card-score">{acc.warmup_score}%</div>
                            ))}
                          </div>

                          <button
                            className="editBtn"
                            onClick={() => handleStartEdit(acc)}
                            title={"Редактировать"}
                          >
                            <EditIcon />
                          </button>
                          <button
                            className="deleteBtn"
                            onClick={() => handleDelete(acc.id)}
                            title={"Удалить"}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                        <div className="acc-proxy-text">{acc.proxy || "Прямое соединение"}</div>
                        <div className="flex-between align-end">
                          <div className="flex-wrap gap-6 flex-1">
                            {[
                              { field: 'activeParserAccountIds', label: "Для профилей" },
                              { field: 'activeIndexAccountIds', label: "Для доноров" },
                              { field: 'activeServerAccountIds', label: "Сендер" },
                              { field: 'activeCheckerAccountIds', label: "Чекер" },
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
                            {"Логин"}
                          </button>
                          <button
                            onClick={() => handleOpenBrowser(acc.id, true)}
                            className="btn-acc-action btn-acc-browser"
                          >
                            {"Браузер"}
                          </button>
                          <button
                            onClick={() => handleWarmup(acc.id)}
                            className="btn-acc-action btn-acc-warmup"
                          >
                            {"Прогрев"}
                          </button>
                          <button
                            onClick={() => handleInstagramCooldown(acc.id)}
                            className="btn-acc-action btn-acc-warmup"
                          >
                            {"Отдохнуть"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
  );
}
