import React, { useState, memo } from 'react';
import { EditIcon, TrashIcon } from './Icons';
import { toast } from 'react-hot-toast';

const SkeletonSettings = memo(function SkeletonSettings() {
    return (<div className="settings-wrap tab-content-fade">
        <div className="settings-header">
            <div className="skeleton" style={{ width: 400, height: 40, borderRadius: 12 }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '32px', padding: '0 32px' }}>
            <div>
                <div className="skeleton-item skeleton" style={{ height: 200 }} />
                <div className="skeleton-item skeleton" style={{ height: 200 }} />
            </div>
            <div>
                <div className="skeleton-item skeleton" style={{ height: 400 }} />
            </div>
        </div>
    </div>);
});

export default function SettingsTab({ settingsData, onSettingsChange, tr, isLoading }) {
    const [settingsTab, setSettingsTab] = useState('accounts');
    const [draggedItem, setDraggedItem] = useState(null);
    const [editingAccount, setEditingAccount] = useState(null);
    const [editForm, setEditForm] = useState({ name: '', proxy: '', cookies: '', fingerprint: '' });

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
            await fetch(`/api/accounts/${id}`, {
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
            const res = await fetch(`/api/accounts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ regenerateFingerprint: true })
            });
            const data = await res.json();
            if (data.success) {
                if (editingAccount === id) {
                    const settingsRes = await fetch('/api/settings');
                    const settings = await settingsRes.json();
                    onSettingsChange(settings);
                    const acc = settings.accounts.find(a => a.id === id);
                    const fp = typeof acc.fingerprint === 'object' ? JSON.stringify(acc.fingerprint, null, 2) : acc.fingerprint;
                    setEditForm(prev => ({ ...prev, fingerprint: fp }));
                }
                else {
                    const settingsRes = await fetch('/api/settings');
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
            const res = await fetch(`/api/accounts/${id}/authorize/start`, { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                toast.success(tr('browser_opened'));
            } else {
                toast.error(data.error || 'Error opening browser');
            }
        } catch (e) {
            toast.error('Error opening browser');
        }
    };

    const handleOpenBrowser = async (id) => {
        try {
            const res = await fetch(`/api/accounts/${id}/browser/start`, { method: 'POST' });
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
        return (<div className="task-setup-section" style={{ marginBottom: '24px', padding: '20px', background: 'hsl(var(--bg-card))', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
            <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 700, color: 'hsl(var(--primary))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</h4>
            <div className="active-accounts-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {activeAccounts.length === 0 && <div style={{ color: 'hsl(var(--text-dim))', fontSize: '13px', textAlign: 'center', padding: '12px', border: '1px dashed hsl(var(--border))', borderRadius: '10px' }}>{tr('no_accounts_selected')}</div>}
                {activeAccounts.map((acc, idx) => (<div key={acc.id} draggable onDragStart={(e) => onDragStart(e, idx, field)} onDragOver={(e) => onDragOver(e, idx, field)} style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '10px 14px',
                    background: 'hsl(var(--bg-elevated) / 0.5)',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '10px',
                    cursor: 'grab',
                    userSelect: 'none',
                    transition: 'all 0.2s'
                }} onMouseEnter={(e) => e.currentTarget.style.borderColor = 'hsl(var(--primary))'} onMouseLeave={(e) => e.currentTarget.style.borderColor = 'hsl(var(--border))'}>
                    <span style={{ marginRight: '12px', color: 'hsl(var(--text-dim))', fontSize: '14px' }}>☰</span>
                    <span style={{ fontWeight: '600', fontSize: '14px' }}>{acc.name}</span>
                    <button onClick={() => toggleAccountForTask(field, acc.id)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'hsl(var(--danger))', cursor: 'pointer', padding: '4px', opacity: 0.7, transition: 'opacity 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.opacity = '1'} onMouseLeave={(e) => e.currentTarget.style.opacity = '0.7'}>
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
                {['accounts', 'names', 'cities', 'niches', 'donors'].map(tab => (<button key={tab} className={`tab-btn${settingsTab === tab ? ' active' : ''}`} onClick={() => setSettingsTab(tab)}>
                    {tr(`tab_${tab}`)}
                </button>))}
            </div>
        </div>

        {settingsTab === 'accounts' && (<div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '32px', padding: '0 32px' }}>
            <div className="tasks-columns">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    {renderTaskSection('activeParserAccountIds', tr('task_parser'))}
                    {renderTaskSection('activeIndexAccountIds', tr('task_scraper'))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                    {renderTaskSection('activeServerAccountIds', tr('task_sender'))}
                    {renderTaskSection('activeProfilesAccountIds', tr('task_profiles'))}
                </div>
                <div className="add-account-form" style={{ marginTop: '32px', padding: '24px', background: 'hsl(var(--bg-card))', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                    <h4 style={{ margin: '0 0 20px 0', fontSize: '18px' }}>{tr('add_account')}</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                        <input type="text" id="new-acc-name" placeholder={tr('name_placeholder')} className="search-input" />
                        <input type="text" id="new-acc-proxy" placeholder={tr('proxy_placeholder')} className="search-input" />
                    </div>
                    <textarea id="new-acc-cookies" placeholder={tr('cookies_placeholder_new')} className="msg-textarea" style={{ height: 100, marginBottom: '20px' }} />
                    <button className="btn-primary" style={{ width: '100%' }} onClick={handleAdd}>
                        {tr('btn_add')}
                    </button>
                </div>
            </div>

            <div className="all-accounts-column">
                <h4 style={{ marginBottom: '20px', fontSize: '18px' }}>{tr('all_accounts')}</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {settingsData.accounts.map(acc => (<div key={acc.id} className="account-card">
                        {editingAccount === acc.id ? (<div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <input type="text" className="search-input" placeholder={tr('edit_name')} value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} style={{ fontSize: '14px' }} />
                            <input type="text" className="search-input" placeholder={tr('edit_proxy')} value={editForm.proxy} onChange={e => setEditForm({ ...editForm, proxy: e.target.value })} style={{ fontSize: '13px', fontFamily: 'monospace' }} />
                            <textarea className="msg-textarea" placeholder={tr('edit_cookies')} value={editForm.cookies} onChange={e => setEditForm({ ...editForm, cookies: e.target.value })} style={{ height: '80px', fontSize: '12px', fontFamily: 'monospace' }} />
                            <div style={{ position: 'relative' }}>
                                <textarea className="msg-textarea" placeholder={tr('edit_fingerprint')} value={editForm.fingerprint} onChange={e => setEditForm({ ...editForm, fingerprint: e.target.value })} style={{ height: '120px', fontSize: '11px', fontFamily: 'monospace' }} />
                                <button onClick={() => handleRegenerateFingerprint(acc.id)} style={{
                                    position: 'absolute',
                                    top: '8px',
                                    right: '8px',
                                    padding: '4px 8px',
                                    fontSize: '10px',
                                    background: 'hsl(var(--bg-elevated))',
                                    border: '1px solid hsl(var(--border))',
                                    borderRadius: '4px',
                                    color: 'hsl(var(--text-muted))',
                                    cursor: 'pointer'
                                }}>
                                    {tr('btn_regenerate')}
                                </button>
                                <button
                                    onClick={() => {
                                        const text = prompt('Вставьте данные профиля:');
                                        if (text) parsePasteData(text);
                                    }}
                                    style={{
                                        position: 'absolute',
                                        top: '8px',
                                        right: '110px',
                                        padding: '4px 8px',
                                        fontSize: '10px',
                                        background: 'hsl(var(--primary))',
                                        border: '1px solid hsl(var(--primary))',
                                        borderRadius: '4px',
                                        color: 'white',
                                        cursor: 'pointer'
                                    }}
                                >
                                    {tr('btn_paste_data')}
                                </button>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button className="btn-primary" style={{ flex: 1, fontSize: '12px', padding: '6px 12px', background: 'hsl(var(--success))' }} onClick={() => handleSaveEdit(acc.id)}>
                                    {tr('save_changes')}
                                </button>
                                <button className="btn-primary" style={{ flex: 1, fontSize: '12px', padding: '6px 12px', background: 'transparent', border: '1px solid hsl(var(--border))', color: 'hsl(var(--text-muted))' }} onClick={() => setEditingAccount(null)}>
                                    {tr('cancel')}
                                </button>
                            </div>
                        </div>) : (<>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                <div style={{ fontWeight: '700', fontSize: '15px' }}>{acc.name}</div>
                                <button className="actionBtn editBtn" onClick={() => handleStartEdit(acc)} title={tr('edit_title')}>
                                    <EditIcon />
                                </button>
                            </div>
                            <div style={{ fontSize: '12px', color: 'hsl(var(--text-dim))', marginBottom: '12px', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                                {acc.proxy || 'Direct Connection'}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                <button className="actionBtn" onClick={() => handleLoginBrowser(acc.id)} style={{
                                    padding: '4px 8px',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    color: 'white',
                                    background: 'hsl(var(--primary))',
                                    borderColor: 'hsl(var(--primary))',
                                    width: '100%',
                                    marginBottom: '4px'
                                }}>
                                    🌐 {tr('btn_login_browser')}
                                </button>
                                <button className="actionBtn" onClick={() => handleOpenBrowser(acc.id)} style={{
                                    padding: '4px 8px',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    color: 'white',
                                    background: 'hsl(var(--success))',
                                    borderColor: 'hsl(var(--success))',
                                    width: '100%',
                                    marginBottom: '4px'
                                }}>
                                    🌐 {tr('btn_open_browser')}
                                </button>
                                {[
                                    { field: 'activeParserAccountIds', label: tr('task_parser') },
                                    { field: 'activeIndexAccountIds', label: tr('task_scraper') },
                                    { field: 'activeServerAccountIds', label: tr('task_sender') },
                                    { field: 'activeProfilesAccountIds', label: tr('task_profiles') },
                                ].map(t => {
                                    const isActive = (settingsData[t.field] || []).includes(acc.id);
                                    return (<button key={t.field} onClick={() => toggleAccountForTask(t.field, acc.id)} className="actionBtn" style={{
                                        padding: '4px 8px',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        color: isActive ? 'hsl(var(--primary))' : 'hsl(var(--text-dim))',
                                        borderColor: isActive ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                                        background: isActive ? 'hsla(var(--primary), 0.1)' : 'transparent'
                                    }}>
                                        {t.label}
                                    </button>);
                                })}
                                <button className="actionBtn deleteBtn" onClick={() => handleDelete(acc.id)} title={tr('delete_title')}>
                                    <TrashIcon />
                                </button>
                            </div>
                        </>)}
                    </div>))}
                </div>
            </div>
        </div>)}

        {settingsTab === 'names' && (<textarea className="msg-textarea" style={{ height: 500 }} value={(settingsData.names || []).join('\n')} onChange={e => onSettingsChange({ ...settingsData, names: e.target.value.split('\n') })} />)}
        {settingsTab === 'cities' && (<textarea className="msg-textarea" style={{ height: 500 }} value={(settingsData.cities || []).join('\n')} onChange={e => onSettingsChange({ ...settingsData, cities: e.target.value.split('\n') })} />)}
        {settingsTab === 'niches' && (<textarea className="msg-textarea" style={{ height: 500 }} value={(settingsData.niches || []).join('\n')} onChange={e => onSettingsChange({ ...settingsData, niches: e.target.value.split('\n') })} />)}
        {settingsTab === 'donors' && (<textarea className="msg-textarea" style={{ height: 500 }} value={(settingsData.donors || []).join('\n')} onChange={e => onSettingsChange({ ...settingsData, donors: e.target.value.split('\n') })} />)}
    </div>);
}
