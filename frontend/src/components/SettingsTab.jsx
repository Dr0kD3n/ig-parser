import React, { useState, memo } from 'react';
import { EditIcon, TrashIcon } from './Icons';
import { toast } from 'react-hot-toast';

const SkeletonSettings = memo(function SkeletonSettings() {
    return (<div className="settings-wrap tab-content-fade">
        <div className="settings-header">
            <div className="skeleton skeleton-header-box" />
        </div>
        <div className="settings-main-grid">
            <div>
                <div className="skeleton-item skeleton skeleton-item-200" />
                <div className="skeleton-item skeleton skeleton-item-200" />
            </div>
            <div>
                <div className="skeleton-item skeleton skeleton-item-400" />
            </div>
        </div>
    </div>);
});

const DonorsInput = memo(function DonorsInput({ settingsData, onSettingsChange }) {
    const donorsText = (settingsData.donors || []).join('\n');
    const checkedDonors = settingsData.checkedDonors || [];
    const backdropRef = React.useRef(null);

    const handleScroll = (e) => {
        if (backdropRef.current) {
            backdropRef.current.scrollTop = e.target.scrollTop;
        }
    };

    const renderBackdropText = () => {
        return (settingsData.donors || []).map((line, i) => {
            const normLine = line.trim().replace(/\/$/, '');
            const isChecked = checkedDonors.some(cd => cd.replace(/\/$/, '') === normLine);
            return (
                <span key={i} className={`highlighted-line${isChecked ? ' checked' : ''}`}>
                    {line}{'\n'}
                </span>
            );
        });
    };

    return (
        <div className="highlighter-container">
            <div ref={backdropRef} className="highlighter-backdrop">
                {renderBackdropText()}
            </div>
            <textarea
                className="highlighter-textarea"
                value={donorsText}
                spellCheck="false"
                onScroll={handleScroll}
                onChange={e => onSettingsChange({ ...settingsData, donors: e.target.value.split('\n') })}
            />
        </div>
    );
});

export default function SettingsTab({ settingsData, onSettingsChange, tr, isLoading, authFetch }) {
    const [settingsTab, setSettingsTab] = useState(() => localStorage.getItem('ig_settings_tab') || 'accounts');
    const [draggedItem, setDraggedItem] = useState(null);
    const [editingAccount, setEditingAccount] = useState(null);
    const [editForm, setEditForm] = useState({ name: '', proxy: '', cookies: '', fingerprint: '' });
    const [dolphinProfiles, setDolphinProfiles] = useState([]);
    const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
    const [warmupProgress, setWarmupProgress] = useState({}); // { accountId: { running, percent, site } }
    const [presets, setPresets] = useState([]);
    const [currentPreset, setCurrentPreset] = useState(() => localStorage.getItem('ig_settings_current_preset') || '');
    const [isAddingPreset, setIsAddingPreset] = useState(false);
    const [newPresetName, setNewPresetName] = useState('');

    React.useEffect(() => {
        localStorage.setItem('ig_settings_tab', settingsTab);
    }, [settingsTab]);

    React.useEffect(() => {
        localStorage.setItem('ig_settings_current_preset', currentPreset);
    }, [currentPreset]);

    React.useEffect(() => {
        fetchPresets();
    }, []);

    const fetchPresets = async () => {
        try {
            const res = await authFetch(`/api/presets`);
            const data = await res.json();
            setPresets(data);
        } catch (e) {
            console.error('Error fetching presets:', e);
        }
    };

    const handleSavePreset = async () => {
        let name = currentPreset;
        if (isAddingPreset) {
            name = newPresetName.trim();
        }

        if (!name) {
            toast.error(tr('error_name_required') || 'Имя обязательно');
            return;
        }

        const presetData = {
            names: settingsData.names,
            cities: settingsData.cities,
            niches: settingsData.niches,
            donors: settingsData.donors,
            activeParserAccountIds: settingsData.activeParserAccountIds,
            activeIndexAccountIds: settingsData.activeIndexAccountIds,
            activeServerAccountIds: settingsData.activeServerAccountIds,
            activeProfilesAccountIds: settingsData.activeProfilesAccountIds
        };

        try {
            const res = await authFetch(`/api/presets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, data: presetData })
            });
            const result = await res.json();
            if (result.success) {
                toast.success(tr('preset_saved') || 'Пресет сохранен');
                fetchPresets();
                setCurrentPreset(name);
                setIsAddingPreset(false);
                setNewPresetName('');
            }
        } catch (e) {
            toast.error('Ошибка сохранения пресета');
        }
    };

    const handleLoadPreset = (name) => {
        const preset = presets.find(p => p.name === name);
        if (!preset) return;

        onSettingsChange({
            ...settingsData,
            ...preset.data
        });
        setCurrentPreset(name);
        toast.success(tr('preset_loaded') || `Пресет "${name}" загружен`);
    };

    const handleDeletePreset = async () => {
        if (!currentPreset) return;
        if (!confirm(tr('confirm_delete_preset') || `Удалить пресет "${currentPreset}"?`)) return;

        try {
            const res = await authFetch(`/api/presets/${encodeURIComponent(currentPreset)}`, {
                method: 'DELETE'
            });
            const result = await res.json();
            if (result.success) {
                toast.success(tr('preset_deleted') || 'Пресет удален');
                fetchPresets();
                setCurrentPreset('');
            }
        } catch (e) {
            toast.error('Ошибка удаления пресета');
        }
    };

    React.useEffect(() => {
        const interval = setInterval(async () => {
            const runningIds = Object.keys(warmupProgress).filter(id => warmupProgress[id]?.running);
            // Also check all accounts for "running" state initially or if we missed any
            const accountsToCheck = settingsData.accounts.filter(a => warmupProgress[a.id]?.running || !warmupProgress[a.id]);

            for (const acc of accountsToCheck) {
                try {
                    const res = await authFetch(`/api/accounts/${acc.id}/warmup/status`);
                    const data = await res.json();
                    if (data.running) {
                        setWarmupProgress(prev => ({
                            ...prev,
                            [acc.id]: {
                                running: true,
                                percent: Math.round((data.current / data.total) * 100),
                                site: data.site
                            }
                        }));
                    } else if (warmupProgress[acc.id]?.running) {
                        // Just stopped
                        setWarmupProgress(prev => ({
                            ...prev,
                            [acc.id]: { running: false }
                        }));
                        // Refresh settings to get final score
                        const sRes = await authFetch(`/api/settings`);
                        onSettingsChange(await sRes.json());
                    }
                } catch (e) { }
            }
        }, 3000);
        return () => clearInterval(interval);
    }, [settingsData.accounts, warmupProgress]);

    const setAccounts = (accounts) => onSettingsChange({ ...settingsData, accounts });

    const handleAdd = () => {
        const nameEl = document.getElementById('new-acc-name');
        const proxyEl = document.getElementById('new-acc-proxy');
        const cookiesEl = document.getElementById('new-acc-cookies');
        const name = nameEl.value.trim();
        if (!name) {
            toast.error(tr('error_name_required'));
            return;
        }
        setAccounts([...settingsData.accounts, { id: Date.now().toString(), name, proxy: proxyEl.value.trim(), cookies: cookiesEl.value.trim() }]);
        nameEl.value = '';
        proxyEl.value = '';
        cookiesEl.value = '';
    };

    const handleDelete = (id) => {
        const newAccs = settingsData.accounts.filter(a => a.id !== id);
        const updateArr = (field) => {
            const arr = settingsData[field];
            if (Array.isArray(arr)) {
                return arr.filter(aid => aid !== id);
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
        const newArr = arr.includes(id) ? arr.filter(aid => aid !== id) : [...arr, id];
        onSettingsChange({ ...settingsData, [field]: newArr });
    };

    const parsePasteData = (text) => {
        const lines = text.split('\n');
        const data = {};
        lines.forEach(line => {
            const separatorIndex = line.indexOf(' ');
            if (separatorIndex !== -1) {
                const key = line.substring(0, separatorIndex).trim();
                const value = line.substring(separatorIndex).trim();
                if (key && value) data[key] = value;
            }
        });

        const newForm = { ...editForm };
        if (data.Name) newForm.name = data.Name;
        if (data.Proxy) newForm.proxy = data.Proxy;

        // Parse advanced fields into fingerprint
        const fp = editForm.fingerprint ? JSON.parse(editForm.fingerprint) : {};
        if (data.UserAgent) fp.userAgent = data.UserAgent;
        if (data.Platform) fp.platform = data.Platform;
        if (data.Cpu) fp.cpu = data.Cpu;
        if (data.Memory) fp.memory = data.Memory;
        if (data.Timezone) fp.timezoneId = data.Timezone;
        if (data.Language) fp.locale = data.Language;

        // WebGL Info parsing (multi-line or specific keys)
        if (data.WebGL) fp.webgl = data.WebGL;

        newForm.fingerprint = JSON.stringify(fp, null, 2);
        setEditForm(newForm);
        toast.success('Данные успешно вставлены!');
    };

    const handleStartEdit = (acc) => {
        setEditingAccount(acc.id);
        const fp = typeof acc.fingerprint === 'object' ? JSON.stringify(acc.fingerprint, null, 2) : acc.fingerprint;
        setEditForm({ name: acc.name, proxy: acc.proxy || '', cookies: acc.cookies || '', fingerprint: fp || '' });
    };

    const handleSaveEdit = async (id) => {
        try {
            let fpParsed = editForm.fingerprint;
            try {
                if (editForm.fingerprint)
                    fpParsed = JSON.parse(editForm.fingerprint);
            }
            catch (e) {
                toast.error('Invalid Fingerprint JSON');
                return;
            }
            const payload = {
                name: editForm.name,
                proxy: editForm.proxy,
                cookies: editForm.cookies,
                fingerprint: typeof fpParsed === 'object' ? JSON.stringify(fpParsed) : fpParsed
            };
            await authFetch(`/api/accounts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            // Update local state
            const updatedAccounts = settingsData.accounts.map(a => a.id === id ? { ...a, ...payload } : a);
            onSettingsChange({ ...settingsData, accounts: updatedAccounts });
            setEditingAccount(null);
            toast.success(tr('save_changes'));
        }
        catch (e) {
            console.error('Error saving account:', e);
            toast.error('Error saving account');
        }
    };

    const handleRegenerateFingerprint = async (id) => {
        try {
            const res = await authFetch(`/api/accounts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ regenerateFingerprint: true })
            });
            const data = await res.json();
            if (data.success) {
                if (editingAccount === id) {
                    const settingsRes = await authFetch(`/api/settings`);
                    const settings = await settingsRes.json();
                    onSettingsChange(settings);
                    const acc = settings.accounts.find(a => a.id === id);
                    const fp = typeof acc.fingerprint === 'object' ? JSON.stringify(acc.fingerprint, null, 2) : acc.fingerprint;
                    setEditForm(prev => ({ ...prev, fingerprint: fp }));
                }
                else {
                    const settingsRes = await authFetch(`/api/settings`);
                    const settings = await settingsRes.json();
                    onSettingsChange(settings);
                }
                toast.success(tr('btn_regenerate'));
            }
        }
        catch (e) {
            console.error('Error regenerating fingerprint:', e);
            toast.error('Error regenerating fingerprint');
        }
    };

    const handleLoginBrowser = async (id) => {
        try {
            const res = await authFetch(`/api/accounts/${id}/authorize/start`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                toast.success(tr('browser_opened'));

                // Poll for authorization status to refresh when browser closes
                let pollCount = 0;
                const pollInterval = setInterval(async () => {
                    pollCount++;
                    try {
                        const statusRes = await authFetch(`/api/accounts/${id}/authorize/status`);
                        const statusData = await statusRes.json();

                        if (!statusData.active || pollCount > 600) { // Stop after 10 mins or if closed
                            clearInterval(pollInterval);
                            // Refresh settings to get new cookies
                            const settingsRes = await authFetch(`/api/settings`);
                            const settings = await settingsRes.json();
                            onSettingsChange(settings);
                        }
                    } catch (e) {
                        clearInterval(pollInterval);
                    }
                }, 1000);
            } else {
                toast.error(data.error || 'Error opening browser');
            }
        } catch (e) {
            toast.error('Error opening browser');
        }
    };

    const handleOpenBrowser = async (id) => {
        try {
            const res = await authFetch(`/api/accounts/${id}/browser/start`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                toast.success(tr('browser_opened_generic'));
            } else {
                toast.error(data.error || 'Error opening browser');
            }
        } catch (e) {
            toast.error('Error opening browser');
        }
    };

    const handleWarmup = async (id) => {
        try {
            const res = await authFetch(`/api/accounts/${id}/warmup`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                toast.success('Прогрев запущен в фоновом режиме');
            } else {
                toast.error(data.error || 'Ошибка запуска прогрева');
            }
        } catch (e) {
            toast.error('Ошибка сервера');
        }
    };

    const fetchDolphinProfiles = async () => {
        setIsLoadingProfiles(true);
        try {
            const tokenDolphin = settingsData.dolphinToken || '';
            const res = await authFetch(`/api/dolphin/profiles?token=${encodeURIComponent(tokenDolphin)}`);
            const data = await res.json();
            if (data.success) {
                setDolphinProfiles(data.data);
                toast.success('Профили Dolphin обновлены');
            }
            else {
                toast.error(data.error || 'Ошибка загрузки профилей');
            }
        }
        catch (e) {
            toast.error('Ошибка сервера при загрузке профилей');
        }
        finally {
            setIsLoadingProfiles(false);
        }
    };

    const onDragStart = (e, index, field) => {
        setDraggedItem({ index, field });
        e.dataTransfer.effectAllowed = 'move';
    };

    const onDragOver = (e, index, field) => {
        e.preventDefault();
        if (!draggedItem || draggedItem.field !== field)
            return;
        if (draggedItem.index === index)
            return;
        const arr = [...settingsData[field]];
        const item = arr.splice(draggedItem.index, 1)[0];
        arr.splice(index, 0, item);
        onSettingsChange({ ...settingsData, [field]: arr });
        setDraggedItem({ ...draggedItem, index });
    };

    const renderTaskSection = (field, label) => {
        const activeIds = settingsData[field] || [];
        const activeAccounts = activeIds.map(id => settingsData.accounts.find(a => a.id === id)).filter((a) => !!a);
        return (<div className="task-setup-section">
            <h4 className="task-section-title">{label}</h4>
            <div className="active-accounts-list flex-col-gap-8">
                {activeAccounts.length === 0 && <div className="no-accounts-placeholder">{tr('no_accounts_selected')}</div>}
                {activeAccounts.map((acc, idx) => (<div key={acc.id} draggable onDragStart={(e) => onDragStart(e, idx, field)} onDragOver={(e) => onDragOver(e, idx, field)} className="account-drag-item">
                    <span className="account-drag-handle">☰</span>
                    <span className="account-name-badge">{acc.name}</span>
                    <button onClick={() => toggleAccountForTask(field, acc.id)} className="account-remove-btn">
                        ✕
                    </button>
                </div>))}
            </div>
        </div>);
    };

    if (isLoading)
        return <SkeletonSettings />;

    return (<div className="settings-wrap tab-content-fade">
        <div className="settings-header">
            <div className="settings-nested-tabs">
                {['accounts', 'names', 'cities', 'niches', 'donors', 'dolphin'].map(tab => (<button key={tab} className={`tab-btn${settingsTab === tab ? ' active' : ''}`} onClick={() => setSettingsTab(tab)}>
                    {tr(`tab_${tab}`)}
                </button>))}
            </div>

            <div className="presets-controls">
                {isAddingPreset ? (
                    <div className="preset-add-group">
                        <input
                            type="text"
                            className="search-input preset-name-input"
                            placeholder={tr('name_placeholder')}
                            value={newPresetName}
                            onChange={(e) => setNewPresetName(e.target.value)}
                            autoFocus
                        />
                        <button className="btn-primary" onClick={handleSavePreset}>
                            {tr('save_preset')}
                        </button>
                        <button className="btn-primary btn-danger" onClick={() => { setIsAddingPreset(false); setNewPresetName(''); }}>
                            ✕
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="preset-select-group">
                            <select
                                className="search-input preset-select"
                                value={currentPreset}
                                onChange={(e) => handleLoadPreset(e.target.value)}
                            >
                                <option value="" disabled>{tr('select_preset') || 'Выберите пресет...'}</option>
                                {presets.map(p => (
                                    <option key={p.name} value={p.name}>{p.name}</option>
                                ))}
                            </select>
                            <button
                                className="actionBtn editBtn btn-add-preset"
                                onClick={() => setIsAddingPreset(true)}
                                title={tr('add_preset') || 'Добавить пресет'}
                            >
                                +
                            </button>
                        </div>
                        {currentPreset && (
                            <>
                                <button className="btn-primary" onClick={handleSavePreset} title={tr('save_preset') || 'Сохранить пресет'}>
                                    {tr('save_preset')}
                                </button>
                                <button className="btn-primary btn-danger" onClick={handleDeletePreset} title={tr('delete_preset') || 'Удалить пресет'}>
                                    <TrashIcon />
                                </button>
                            </>
                        )}
                    </>
                )}
            </div>
        </div>

        {settingsTab === 'accounts' && (<div className="settings-main-grid">
            <div className="tasks-columns">
                <div className="two-column-grid">
                    {renderTaskSection('activeParserAccountIds', tr('task_parser'))}
                    {renderTaskSection('activeIndexAccountIds', tr('task_scraper'))}
                </div>
                <div className="two-column-grid">
                    {renderTaskSection('activeServerAccountIds', tr('task_sender'))}
                    {renderTaskSection('activeProfilesAccountIds', tr('task_profiles'))}
                </div>
                <div className="add-account-form">
                    <h4 className="add-account-title">{tr('add_account')}</h4>
                    <div className="add-account-grid">
                        <input type="text" id="new-acc-name" placeholder={tr('name_placeholder')} className="search-input" />
                        <input type="text" id="new-acc-proxy" placeholder={tr('proxy_placeholder')} className="search-input" />
                    </div>
                    <textarea id="new-acc-cookies" placeholder={tr('cookies_placeholder_new')} className="msg-textarea new-acc-cookies-textarea" />
                    <button className="btn-primary full-width-btn" onClick={handleAdd}>
                        {tr('btn_add')}
                    </button>
                </div>
            </div>

            <div className="all-accounts-column">
                <h4 className="all-accounts-title">{tr('all_accounts')}</h4>
                <div className="flex-col-gap-12">
                    {settingsData.accounts.map(acc => (<div key={acc.id} className="account-card">
                        {editingAccount === acc.id ? (<div className="flex-col-gap-10">
                            <input type="text" className="search-input edit-acc-name-input" placeholder={tr('edit_name')} value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                            <input type="text" className="search-input edit-acc-proxy-input" placeholder={tr('edit_proxy')} value={editForm.proxy} onChange={e => setEditForm({ ...editForm, proxy: e.target.value })} />
                            <div className="config-relative-wrap">

                                <div className="fingerprint-config-grid">
                                    <div className="config-col-item">
                                        <label className="config-label-text">CPU Cores</label>
                                        <select
                                            value={(() => { try { return JSON.parse(editForm.fingerprint).hardware?.cpuCores || 8 } catch (e) { return 8 } })()}
                                            onChange={e => {
                                                const fp = JSON.parse(editForm.fingerprint || '{}');
                                                if (!fp.hardware) fp.hardware = {};
                                                fp.hardware.cpuCores = parseInt(e.target.value);
                                                setEditForm({ ...editForm, fingerprint: JSON.stringify(fp, null, 2) });
                                            }}
                                            className="search-input config-input-small"
                                        >
                                            {[2, 4, 6, 8, 12, 16, 32, 64].map(v => <option key={v} value={v}>{v} cores</option>)}
                                        </select>
                                    </div>
                                    <div className="config-col-item">
                                        <label className="config-label-text">Memory GB</label>
                                        <select
                                            value={(() => { try { return JSON.parse(editForm.fingerprint).hardware?.memoryGB || 8 } catch (e) { return 8 } })()}
                                            onChange={e => {
                                                const fp = JSON.parse(editForm.fingerprint || '{}');
                                                if (!fp.hardware) fp.hardware = {};
                                                fp.hardware.memoryGB = parseInt(e.target.value);
                                                setEditForm({ ...editForm, fingerprint: JSON.stringify(fp, null, 2) });
                                            }}
                                            className="search-input config-input-small"
                                        >
                                            {[2, 4, 8, 16, 32, 64, 128].map(v => <option key={v} value={v}>{v} GB</option>)}
                                        </select>
                                    </div>
                                    <div className="config-col-item config-col-span-2">
                                        <label className="config-label-text">WebGL Renderer</label>
                                        <input
                                            type="text"
                                            className="search-input config-input-renderer"
                                            value={(() => { try { return JSON.parse(editForm.fingerprint).webgl?.renderer || '' } catch (e) { return '' } })()}
                                            onChange={e => {
                                                const fp = JSON.parse(editForm.fingerprint || '{}');
                                                if (!fp.webgl) fp.webgl = {};
                                                fp.webgl.renderer = e.target.value;
                                                setEditForm({ ...editForm, fingerprint: JSON.stringify(fp, null, 2) });
                                            }}
                                            placeholder="Renderer string..."
                                        />
                                    </div>
                                    <div className="config-col-item">
                                        <label className="config-label-text">Dolphin Token</label>
                                        <input
                                            type="password"
                                            className="search-input config-input-renderer"
                                            value={(() => { try { return JSON.parse(editForm.fingerprint).dolphinToken || '' } catch (e) { return '' } })()}
                                            onChange={e => {
                                                let fp = {};
                                                try { fp = JSON.parse(editForm.fingerprint || '{}'); } catch (err) { }
                                                fp.dolphinToken = e.target.value;
                                                setEditForm({ ...editForm, fingerprint: JSON.stringify(fp, null, 2) });
                                            }}
                                            placeholder="Token..."
                                        />
                                    </div>
                                    <div className="config-col-item">
                                        <label className="config-label-text">Profile ID</label>
                                        <input
                                            type="text"
                                            className="search-input config-input-renderer"
                                            value={(() => { try { return JSON.parse(editForm.fingerprint).dolphinProfileId || '' } catch (e) { return '' } })()}
                                            onChange={e => {
                                                let fp = {};
                                                try { fp = JSON.parse(editForm.fingerprint || '{}'); } catch (err) { }
                                                fp.dolphinProfileId = e.target.value;
                                                setEditForm({ ...editForm, fingerprint: JSON.stringify(fp, null, 2) });
                                            }}
                                            placeholder="Profile ID..."
                                        />
                                    </div>
                                </div>
                                <div className="fingerprint-config-grid">
                                    <textarea className="msg-textarea edit-acc-cookies-textarea" placeholder={tr('edit_cookies')} value={editForm.cookies} onChange={e => setEditForm({ ...editForm, cookies: e.target.value })} />
                                    <div className="edit-data-actions">
                                        <button
                                            onClick={() => {
                                                const text = prompt('Вставьте данные профиля:');
                                                if (text) parsePasteData(text);
                                            }}
                                            className="btn-paste-data"
                                        >
                                            {tr('btn_paste_data')}
                                        </button>
                                        <button onClick={() => handleRegenerateFingerprint(acc.id)} className="btn-regenerate-fp">
                                            {tr('btn_regenerate')}
                                        </button>
                                    </div>
                                    <textarea className="msg-textarea edit-acc-fingerprint-textarea" placeholder={tr('edit_fingerprint')} value={editForm.fingerprint} onChange={e => setEditForm({ ...editForm, fingerprint: e.target.value })} />
                                </div>
                            </div>

                            <div className="flex-row-gap-8">
                                <button className="btn-primary save-edit-btn" onClick={() => handleSaveEdit(acc.id)}>
                                    {tr('save_changes')}
                                </button>
                                <button className="btn-primary cancel-edit-btn" onClick={() => setEditingAccount(null)}>
                                    {tr('cancel')}
                                </button>
                            </div>
                        </div>) : (<div className="flex-col-gap-10">
                            <div className="account-card-header">
                                <div className="account-card-name">{acc.name}</div>
                                <div className="account-card-actions">
                                    <button className="actionBtn editBtn" onClick={() => handleStartEdit(acc)} title={tr('edit_title')}>
                                        <EditIcon />
                                    </button>
                                    <button className="actionBtn deleteBtn" onClick={() => handleDelete(acc.id)} title={tr('delete_title')}>
                                        <TrashIcon />
                                    </button>
                                </div>
                            </div>
                            <div className="account-card-proxy">
                                {acc.proxy || 'Direct Connection'}
                            </div>
                            <div className="account-action-row">
                                <button className="btn-premium-action btn-premium-login" onClick={() => handleLoginBrowser(acc.id)}>
                                    {tr('btn_login_browser')}
                                </button>
                                <button className="btn-premium-action btn-premium-open" onClick={() => handleOpenBrowser(acc.id)}>
                                    ОТКРЫТЬ
                                </button>
                                <button className="btn-premium-action btn-premium-warmup" onClick={() => handleWarmup(acc.id)}>
                                    ПРОГРЕВ
                                </button>

                                <div className="warmup-progress-inline" title={acc.last_warmup ? `Last: ${new Date(acc.last_warmup).toLocaleDateString()}` : ''}>
                                    {warmupProgress[acc.id]?.running ? (
                                        <>
                                            <div className="warmup-pulse" />
                                            {warmupProgress[acc.id].percent}%
                                        </>
                                    ) : (
                                        <>🔥 {acc.warmup_score || 0}%</>
                                    )}
                                </div>
                            </div>

                            <div className="account-action-row task-toggles-row">
                                {[
                                    { field: 'activeParserAccountIds', label: tr('task_parser') },
                                    { field: 'activeIndexAccountIds', label: tr('task_scraper') },
                                    { field: 'activeServerAccountIds', label: tr('task_sender') },
                                    { field: 'activeProfilesAccountIds', label: tr('task_profiles') },
                                ].map(t => {
                                    const isActive = (settingsData[t.field] || []).includes(acc.id);
                                    return (<button key={t.field} onClick={() => toggleAccountForTask(t.field, acc.id)} className={`actionBtn btn-task-toggle ${isActive ? 'active' : 'inactive'}`}>
                                        {t.label}
                                    </button>);
                                })}
                            </div>
                        </div>)}
                    </div>))}
                </div>
            </div>
        </div>)}

        {settingsTab === 'names' && (<textarea className="msg-textarea settings-list-textarea" value={(settingsData.names || []).join('\n')} onChange={e => onSettingsChange({ ...settingsData, names: e.target.value.split('\n') })} />)}
        {settingsTab === 'cities' && (<textarea className="msg-textarea settings-list-textarea" value={(settingsData.cities || []).join('\n')} onChange={e => onSettingsChange({ ...settingsData, cities: e.target.value.split('\n') })} />)}
        {settingsTab === 'niches' && (<textarea className="msg-textarea settings-list-textarea" value={(settingsData.niches || []).join('\n')} onChange={e => onSettingsChange({ ...settingsData, niches: e.target.value.split('\n') })} />)}
        {settingsTab === 'donors' && (<DonorsInput settingsData={settingsData} onSettingsChange={onSettingsChange} />)}
        {settingsTab === 'dolphin' && (<div className="flex-col-gap-20">
            <div className="add-account-form dolphin-settings-container">
                <h4 className="add-account-title">Настройки Dolphin Anty</h4>
                <div className="flex-col-gap-10">
                    <label className="config-label-text">API Token</label>
                    <input type="password" placeholder="Dolphin API Token..." className="search-input" value={settingsData.dolphinToken || ''} onChange={e => onSettingsChange({ ...settingsData, dolphinToken: e.target.value })} />
                    <div className="flex-row-gap-8 dolphin-refresh-btn-wrap">
                        <button className="btn-primary" onClick={fetchDolphinProfiles} disabled={isLoadingProfiles}>
                            {isLoadingProfiles ? 'Загрузка...' : 'Получить список профилей'}
                        </button>
                    </div>
                </div>
            </div>

            {dolphinProfiles.length > 0 && (<div className="dolphin-accounts-column">
                <h4 className="all-accounts-title">Найдено профилей: {dolphinProfiles.length}</h4>
                <div className="flex-col-gap-10">
                    {dolphinProfiles.map(p => (<div key={p.id} className="account-card dolphin-account-card">
                        <div className="dolphin-card-row">
                            <div>
                                <div className="dolphin-card-name">{p.name}</div>
                                <div className="dolphin-card-details">ID: {p.id} | Proxy: {p.proxy?.host || 'No proxy'}</div>
                            </div>
                            <div className="dolphin-card-time">
                                {p.lastStartTime || 'Никогда не запускался'}
                            </div>
                        </div>
                    </div>))}
                </div>
            </div>)}
        </div>)}
    </div>);
}
