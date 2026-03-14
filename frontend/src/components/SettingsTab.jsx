import React, { useState, useEffect, useCallback } from 'react';
import { EditIcon, TrashIcon, PlusIcon, XIcon } from './Icons';
import toast from 'react-hot-toast';

function DonorsInput({ settingsData, onSettingsChange }) {
    const [donorInput, setDonorInput] = useState('');
    const handleAdd = () => {
        const d = donorInput.trim();
        if (d && !(settingsData.donors || []).includes(d)) {
            onSettingsChange({ donors: [...(settingsData.donors || []), d] });
            setDonorInput('');
        }
    };
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
                <input className="text-input" style={{ flex: 1 }} placeholder="Instagram URL/Username" value={donorInput} onChange={e => setDonorInput(e.target.value)} />
                <button className="btn btn-primary" onClick={handleAdd}>ADD</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
                {(settingsData.donors || []).map(d => (
                    <div key={d} className="profile-card" style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d}</span>
                        <button className="btn btn-secondary" style={{ padding: '4px', minWidth: '30px' }} onClick={() => onSettingsChange({ donors: settingsData.donors.filter(item => item !== d) })}>
                            <XIcon />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function SettingsTab({ settingsData, onSettingsChange, tr, isLoading, authFetch }) {
    const [settingsTab, setSettingsTab] = useState('accounts');
    const [accounts, setAccounts] = useState([]);
    const [editingAccount, setEditingAccount] = useState(null);
    const [editForm, setEditForm] = useState({});
    const [dolphinProfiles, setDolphinProfiles] = useState([]);
    const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);
    const [warmupProgress, setWarmupProgress] = useState({});

    const fetchAccounts = useCallback(async () => {
        try {
            const res = await authFetch('/api/accounts');
            const data = await res.json();
            setAccounts(data);
        } catch (e) { console.error('Fetch accounts error', e); }
    }, [authFetch]);

    useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

    const handleSaveEdit = async (id) => {
        try {
            const res = await authFetch(`/api/accounts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editForm)
            });
            if (res.ok) {
                toast.success('Account updated');
                setEditingAccount(null);
                fetchAccounts();
            }
        } catch (e) { toast.error('Update failed'); }
    };

    const handleToggleTask = async (field, accountId) => {
        const current = settingsData[field] || [];
        const next = current.includes(accountId)
            ? current.filter(id => id !== accountId)
            : [...current, accountId];
        onSettingsChange({ ...settingsData, [field]: next });
    };

    if (isLoading) return <div className="loading-spinner" />;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
            {/* Sub-navigation */}
            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px' }}>
                {[
                    { id: 'accounts', label: 'ACCOUNTS' },
                    { id: 'donors', label: 'DONORS' },
                    { id: 'names', label: 'FILTER NAMES' },
                    { id: 'cities', label: 'FILTER CITIES' },
                    { id: 'niches', label: 'FILTER NICHES' },
                    { id: 'dolphin', label: 'DOLPHIN ANTY' }
                ].map(t => (
                    <button
                        key={t.id}
                        className={`tab-trigger ${settingsTab === t.id ? 'active' : ''}`}
                        onClick={() => setSettingsTab(t.id)}
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            <div className="settings-content fade-in-up">
                {settingsTab === 'accounts' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(450px, 1fr))', gap: '24px' }}>
                        {accounts.map(acc => {
                            const isEditing = editingAccount === acc.id;
                            return (
                                <div key={acc.id} className="profile-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div>
                                            <h4 style={{ fontFamily: 'Space Grotesk', fontSize: '18px', fontWeight: '700' }}>{acc.name}</h4>
                                            <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>ID: {acc.id}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button className="btn btn-secondary" style={{ padding: '8px' }} onClick={() => { setEditingAccount(acc.id); setEditForm(acc); }}>
                                                <EditIcon style={{ width: '16px', height: '16px' }} />
                                            </button>
                                            <button className="btn btn-secondary" style={{ padding: '8px', color: 'hsl(var(--danger))' }}>
                                                <TrashIcon style={{ width: '16px', height: '16px' }} />
                                            </button>
                                        </div>
                                    </div>

                                    {isEditing ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            <input className="text-input" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                                            <input className="text-input" value={editForm.proxy} placeholder="Proxy (host:port:user:pass)" onChange={e => setEditForm({ ...editForm, proxy: e.target.value })} />
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => handleSaveEdit(acc.id)}>SAVE</button>
                                                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setEditingAccount(null)}>CANCEL</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div style={{ padding: '12px', background: 'hsla(0, 0%, 100%, 0.02)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', fontSize: '13px', color: 'var(--text-muted)' }}>
                                                {acc.proxy || 'Direct Connection'}
                                            </div>

                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                {['activeIndexAccountIds', 'activeParserAccountIds', 'activeServerAccountIds'].map(task => {
                                                    const isActive = (settingsData[task] || []).includes(acc.id);
                                                    const labels = { activeIndexAccountIds: 'SCRAPER', activeParserAccountIds: 'PARSER', activeServerAccountIds: 'SENDER' };
                                                    return (
                                                        <button
                                                            key={task}
                                                            className="btn"
                                                            style={{ flex: 1, fontSize: '11px', padding: '8px 4px', background: isActive ? 'hsla(var(--primary), 0.2)' : 'transparent', border: `1px solid ${isActive ? 'hsl(var(--primary))' : 'var(--border)'}`, color: isActive ? '#fff' : 'var(--text-dim)' }}
                                                            onClick={() => handleToggleTask(task, acc.id)}
                                                        >
                                                            {labels[task]}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    )}
                                </div>
                            );
                        })}

                        {/* Add Account Card */}
                        <div className="profile-card" style={{ padding: '24px', border: '2px dashed var(--border)', background: 'transparent', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '200px', cursor: 'pointer' }}>
                            <div className="logo-container" style={{ marginBottom: '16px', background: 'var(--border)' }}>
                                <PlusIcon style={{ width: '24px', height: '24px' }} />
                            </div>
                            <span style={{ fontFamily: 'Space Grotesk', fontWeight: '600', color: 'var(--text-muted)' }}>ADD NEW ACCOUNT</span>
                        </div>
                    </div>
                )}

                {(settingsTab === 'names' || settingsTab === 'cities' || settingsTab === 'niches') && (
                    <div className="profile-card" style={{ padding: '32px' }}>
                        <h3 style={{ marginBottom: '16px', fontFamily: 'Space Grotesk' }}>EDIT {settingsTab.toUpperCase()}</h3>
                        <textarea
                            className="text-input"
                            style={{ width: '100%', height: '400px', fontFamily: 'JetBrains Mono', fontSize: '14px', lineHeight: '1.6' }}
                            value={(settingsData[settingsTab] || []).join('\n')}
                            onChange={e => onSettingsChange({ ...settingsData, [settingsTab]: e.target.value.split('\n') })}
                            placeholder="Enter items separated by new line..."
                        />
                        <div style={{ marginTop: '16px', color: 'var(--text-dim)', fontSize: '12px' }}>
                            Changes are saved automatically. One item per line.
                        </div>
                    </div>
                )}

                {settingsTab === 'donors' && <DonorsInput settingsData={settingsData} onSettingsChange={onSettingsChange} />}

                {settingsTab === 'dolphin' && (
                    <div className="profile-card" style={{ padding: '32px', maxWidth: '800px' }}>
                        <h3 style={{ marginBottom: '24px', fontFamily: 'Space Grotesk' }}>DOLPHIN ANTY INTEGRATION</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                            <div className="input-group">
                                <label className="label">API TOKEN</label>
                                <input type="password" className="text-input" value={settingsData.dolphinToken || ''} onChange={e => onSettingsChange({ ...settingsData, dolphinToken: e.target.value })} placeholder="Paste your Dolphin Anty API token..." />
                            </div>
                            <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>FETCH DOLPHIN PROFILES</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
