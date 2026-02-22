import { useState } from 'react'

export default function SettingsTab({ settingsData, onSettingsChange, onSave, tr }) {
    const [settingsTab, setSettingsTab] = useState('accounts')

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

    const handleDelete = (id) => setAccounts(settingsData.accounts.filter(a => a.id !== id))
    const setActive = (field, id) => onSettingsChange({ ...settingsData, [field]: id })

    return (
        <div className="settings-wrap tab-content-fade">
            <div className="settings-header">
                <div className="settings-nested-tabs">
                    {['accounts', 'names', 'cities', 'niches'].map(tab => (
                        <button
                            key={tab}
                            className={`tab-btn${settingsTab === tab ? ' active' : ''}`}
                            onClick={() => setSettingsTab(tab)}
                        >
                            {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                    ))}
                </div>
                <button
                    className="btn-primary"
                    style={{ marginLeft: 'auto', background: 'var(--success)', boxShadow: 'none' }}
                    onClick={onSave}
                >
                    {tr('save_all')}
                </button>
            </div>

            {settingsTab === 'accounts' && (
                <div>
                    {settingsData.accounts.map(acc => (
                        <div key={acc.id} className="account-card">
                            <div className="account-card-top">
                                <span className="account-name">{acc.name}</span>
                                <div className="account-actions">
                                    {[
                                        { field: 'activeParserAccountId', label: 'Parser' },
                                        { field: 'activeIndexAccountId', label: 'Scraper' },
                                        { field: 'activeServerAccountId', label: 'Sender' },
                                        { field: 'activeProfilesAccountId', label: 'Profiles' },
                                    ].map(({ field, label }) => (
                                        <button
                                            key={field}
                                            className="actionBtn"
                                            style={{
                                                color: settingsData[field] === acc.id ? 'var(--primary)' : 'var(--text-muted)',
                                                borderColor: settingsData[field] === acc.id ? 'var(--primary)' : 'var(--border)'
                                            }}
                                            onClick={() => setActive(field, acc.id)}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                    <button
                                        className="actionBtn"
                                        style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.2)' }}
                                        onClick={() => handleDelete(acc.id)}
                                    >
                                        {tr('delete')}
                                    </button>
                                </div>
                            </div>
                            <div className="account-meta">Proxy: {acc.proxy || 'Direct'}</div>
                        </div>
                    ))}

                    <div className="add-account-form">
                        <h4>{tr('add_account')}</h4>
                        <input type="text" id="new-acc-name" placeholder={tr('name_placeholder')} className="search-input" />
                        <input type="text" id="new-acc-proxy" placeholder={tr('proxy_placeholder')} className="search-input" />
                        <textarea id="new-acc-cookies" placeholder={tr('cookies_placeholder')} className="msg-textarea" style={{ height: 90 }} />
                        <button className="btn-primary" style={{ width: 'fit-content' }} onClick={handleAdd}>
                            {tr('btn_add')}
                        </button>
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
        </div>
    )
}
