import { useState } from 'react'
import { EditIcon, TrashIcon } from './Icons.jsx'

export default function SettingsTab({ settingsData, onSettingsChange, tr }) {
    const [settingsTab, setSettingsTab] = useState('accounts')
    const [draggedItem, setDraggedItem] = useState(null)
    const [editingAccount, setEditingAccount] = useState(null)
    const [editForm, setEditForm] = useState({ name: '', proxy: '', cookies: '' })

    const setAccounts = (accounts) => onSettingsChange({ ...settingsData, accounts })

    const handleAdd = () => {
        const nameEl = document.getElementById('new-acc-name')
        const proxyEl = document.getElementById('new-acc-proxy')
        const cookiesEl = document.getElementById('new-acc-cookies')
        const name = nameEl.value.trim()
        const cookies = cookiesEl.value.trim()
        if (!name || !cookies) { alert('Имя и Куки обязательны'); return }
        setAccounts([...settingsData.accounts, { id: Date.now().toString(), name, proxy: proxyEl.value.trim(), cookies }])
        nameEl.value = ''; proxyEl.value = ''; cookiesEl.value = ''
    }

    const handleDelete = (id) => {
        const newAccs = settingsData.accounts.filter(a => a.id !== id)
        const updateArr = (field) => (settingsData[field] || []).filter(aid => aid !== id)

        onSettingsChange({
            ...settingsData,
            accounts: newAccs,
            activeParserAccountIds: updateArr('activeParserAccountIds'),
            activeServerAccountIds: updateArr('activeServerAccountIds'),
            activeIndexAccountIds: updateArr('activeIndexAccountIds'),
            activeProfilesAccountIds: updateArr('activeProfilesAccountIds'),
            activeCheckerAccountIds: updateArr('activeCheckerAccountIds')
        })
    }

    const toggleAccountForTask = (field, id) => {
        const arr = settingsData[field] || []
        const newArr = arr.includes(id) ? arr.filter(aid => aid !== id) : [...arr, id]
        onSettingsChange({ ...settingsData, [field]: newArr })
    }

    const handleStartEdit = (acc) => {
        setEditingAccount(acc.id)
        setEditForm({ name: acc.name, proxy: acc.proxy || '', cookies: acc.cookies || '' })
    }

    const handleSaveEdit = async (id) => {
        try {
            await fetch(`/api/accounts/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editForm)
            })
            // Update local state
            const updatedAccounts = settingsData.accounts.map(a =>
                a.id === id ? { ...a, ...editForm } : a
            )
            onSettingsChange({ ...settingsData, accounts: updatedAccounts })
            setEditingAccount(null)
        } catch (e) {
            console.error('Error saving account:', e)
        }
    }

    const onDragStart = (e, index, field) => {
        setDraggedItem({ index, field })
        e.dataTransfer.effectAllowed = 'move'
    }

    const onDragOver = (e, index, field) => {
        e.preventDefault()
        if (!draggedItem || draggedItem.field !== field) return
        if (draggedItem.index === index) return

        const arr = [...settingsData[field]]
        const item = arr.splice(draggedItem.index, 1)[0]
        arr.splice(index, 0, item)

        onSettingsChange({ ...settingsData, [field]: arr })
        setDraggedItem({ ...draggedItem, index })
    }

    const renderTaskSection = (field, label) => {
        const activeIds = settingsData[field] || []
        const activeAccounts = activeIds.map(id => settingsData.accounts.find(a => a.id === id)).filter(Boolean)

        return (
            <div className="task-setup-section" style={{ marginBottom: '24px', padding: '20px', background: 'hsl(var(--bg-card))', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                <h4 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: 700, color: 'hsl(var(--primary))', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</h4>
                <div className="active-accounts-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {activeAccounts.length === 0 && <div style={{ color: 'hsl(var(--text-dim))', fontSize: '13px', textAlign: 'center', padding: '12px', border: '1px dashed hsl(var(--border))', borderRadius: '10px' }}>Нет выбранных профилей</div>}
                    {activeAccounts.map((acc, idx) => (
                        <div
                            key={acc.id}
                            draggable
                            onDragStart={(e) => onDragStart(e, idx, field)}
                            onDragOver={(e) => onDragOver(e, idx, field)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                padding: '10px 14px',
                                background: 'hsl(var(--bg-elevated) / 0.5)',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '10px',
                                cursor: 'grab',
                                userSelect: 'none',
                                transition: 'all 0.2s'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'hsl(var(--primary))'}
                            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'hsl(var(--border))'}
                        >
                            <span style={{ marginRight: '12px', color: 'hsl(var(--text-dim))', fontSize: '14px' }}>☰</span>
                            <span style={{ fontWeight: '600', fontSize: '14px' }}>{acc.name}</span>
                            <button
                                onClick={() => toggleAccountForTask(field, acc.id)}
                                style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'hsl(var(--danger))', cursor: 'pointer', padding: '4px', opacity: 0.7, transition: 'opacity 0.2s' }}
                                onMouseEnter={(e) => e.currentTarget.style.opacity = 1}
                                onMouseLeave={(e) => e.currentTarget.style.opacity = 0.7}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div className="settings-wrap tab-content-fade">
            <div className="settings-header">
                <div className="settings-nested-tabs">
                    {['accounts', 'names', 'cities', 'niches', 'donors'].map(tab => (
                        <button
                            key={tab}
                            className={`tab-btn${settingsTab === tab ? ' active' : ''}`}
                            onClick={() => setSettingsTab(tab)}
                        >
                            {tab === 'donors' ? tr('tab_donors') : tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    ))}
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '14px', color: 'hsl(var(--text-muted))' }}>
                        <input
                            type="checkbox"
                            checked={settingsData.showBrowser || false}
                            style={{ width: '16px', height: '16px', accentColor: 'hsl(var(--primary))' }}
                            onChange={e => onSettingsChange({ ...settingsData, showBrowser: e.target.checked })}
                        />
                        Показывать браузер
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: 'hsl(var(--text-muted))' }}>
                        Профилей:
                        <input
                            type="number"
                            min="1"
                            max="20"
                            value={settingsData.concurrentProfiles || 3}
                            style={{
                                width: '50px',
                                height: '28px',
                                background: 'hsl(var(--bg-elevated))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '6px',
                                color: 'hsl(var(--text))',
                                textAlign: 'center',
                                fontSize: '13px'
                            }}
                            onChange={e => onSettingsChange({ ...settingsData, concurrentProfiles: parseInt(e.target.value) || 1 })}
                        />
                    </label>
                </div>
            </div>

            {settingsTab === 'accounts' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '32px', padding: '0 32px' }}>
                    <div className="tasks-columns">
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                            {renderTaskSection('activeParserAccountIds', 'Parser')}
                            {renderTaskSection('activeIndexAccountIds', 'Scraper')}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                            {renderTaskSection('activeServerAccountIds', 'Sender')}
                            {renderTaskSection('activeProfilesAccountIds', 'Profiles')}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginTop: '24px' }}>
                            {renderTaskSection('activeCheckerAccountIds', 'Checker')}
                        </div>

                        <div className="add-account-form" style={{ marginTop: '32px', padding: '24px', background: 'hsl(var(--bg-card))', borderRadius: 'var(--radius)', border: '1px solid hsl(var(--border))' }}>
                            <h4 style={{ margin: '0 0 20px 0', fontSize: '18px' }}>{tr('add_account')}</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                                <input type="text" id="new-acc-name" placeholder={tr('name_placeholder')} className="search-input" />
                                <input type="text" id="new-acc-proxy" placeholder={tr('proxy_placeholder')} className="search-input" />
                            </div>
                            <textarea id="new-acc-cookies" placeholder={tr('cookies_placeholder')} className="msg-textarea" style={{ height: 100, marginBottom: '20px' }} />
                            <button className="btn-primary" style={{ width: '100%' }} onClick={handleAdd}>
                                {tr('btn_add')}
                            </button>
                        </div>
                    </div>

                    <div className="all-accounts-column">
                        <h4 style={{ marginBottom: '20px', fontSize: '18px' }}>Все аккаунты</h4>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {settingsData.accounts.map(acc => (
                                <div key={acc.id} className="account-card">
                                    {editingAccount === acc.id ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                            <input
                                                type="text"
                                                className="search-input"
                                                placeholder="Имя"
                                                value={editForm.name}
                                                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                                style={{ fontSize: '14px' }}
                                            />
                                            <input
                                                type="text"
                                                className="search-input"
                                                placeholder="Прокси (host:port:user:pass)"
                                                value={editForm.proxy}
                                                onChange={e => setEditForm({ ...editForm, proxy: e.target.value })}
                                                style={{ fontSize: '13px', fontFamily: 'monospace' }}
                                            />
                                            <textarea
                                                className="msg-textarea"
                                                placeholder="Куки"
                                                value={editForm.cookies}
                                                onChange={e => setEditForm({ ...editForm, cookies: e.target.value })}
                                                style={{ height: '80px', fontSize: '12px', fontFamily: 'monospace' }}
                                            />
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button
                                                    className="btn-primary"
                                                    style={{ flex: 1, fontSize: '12px', padding: '6px 12px', background: 'hsl(var(--success))' }}
                                                    onClick={() => handleSaveEdit(acc.id)}
                                                >
                                                    Сохранить
                                                </button>
                                                <button
                                                    className="btn-primary"
                                                    style={{ flex: 1, fontSize: '12px', padding: '6px 12px', background: 'transparent', border: '1px solid hsl(var(--border))', color: 'hsl(var(--text-muted))' }}
                                                    onClick={() => setEditingAccount(null)}
                                                >
                                                    Отмена
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                                                <div style={{ fontWeight: '700', fontSize: '15px' }}>{acc.name}</div>
                                                <button
                                                    className="actionBtn editBtn"
                                                    onClick={() => handleStartEdit(acc)}
                                                    title="Редактировать"
                                                >
                                                    <EditIcon />
                                                </button>
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'hsl(var(--text-dim))', marginBottom: '12px', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                                                {acc.proxy || 'Direct Connection'}
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                                {[
                                                    { field: 'activeParserAccountIds', label: 'Parser' },
                                                    { field: 'activeIndexAccountIds', label: 'Scraper' },
                                                    { field: 'activeServerAccountIds', label: 'Sender' },
                                                    { field: 'activeProfilesAccountIds', label: 'Profiles' },
                                                    { field: 'activeCheckerAccountIds', label: 'Checker' }
                                                ].map(t => {
                                                    const isActive = (settingsData[t.field] || []).includes(acc.id)
                                                    return (
                                                        <button
                                                            key={t.field}
                                                            onClick={() => toggleAccountForTask(t.field, acc.id)}
                                                            className="actionBtn"
                                                            style={{
                                                                padding: '4px 8px',
                                                                fontSize: '11px',
                                                                fontWeight: 700,
                                                                color: isActive ? 'hsl(var(--primary))' : 'hsl(var(--text-dim))',
                                                                borderColor: isActive ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                                                                background: isActive ? 'hsla(var(--primary), 0.1)' : 'transparent'
                                                            }}
                                                        >
                                                            {t.label}
                                                        </button>
                                                    )
                                                })}
                                                <button
                                                    className="actionBtn deleteBtn"
                                                    onClick={() => handleDelete(acc.id)}
                                                    title="Удалить"
                                                >
                                                    <TrashIcon />
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
                    value={settingsData.names.join('\n')}
                    onChange={e => onSettingsChange({ ...settingsData, names: e.target.value.split('\n') })}
                />
            )}
            {settingsTab === 'cities' && (
                <textarea
                    className="msg-textarea"
                    style={{ height: 500 }}
                    value={settingsData.cities.join('\n')}
                    onChange={e => onSettingsChange({ ...settingsData, cities: e.target.value.split('\n') })}
                />
            )}
            {settingsTab === 'niches' && (
                <textarea
                    className="msg-textarea"
                    style={{ height: 500 }}
                    value={settingsData.niches.join('\n')}
                    onChange={e => onSettingsChange({ ...settingsData, niches: e.target.value.split('\n') })}
                />
            )}
            {settingsTab === 'donors' && (
                <textarea
                    className="msg-textarea"
                    style={{ height: 500 }}
                    value={settingsData.donors.join('\n')}
                    onChange={e => onSettingsChange({ ...settingsData, donors: e.target.value.split('\n') })}
                />
            )}
        </div>
    )
}

