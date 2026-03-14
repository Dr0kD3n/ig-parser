import React, { useState } from 'react';
import { LOCAL_API_BASE } from '../config';

function SkeletonCard() {
    return (
        <div className="profile-card" style={{ height: '400px', animation: 'pulse 1.5s infinite ease-in-out' }}>
            <div style={{ height: '70%', background: 'hsla(0, 0%, 100%, 0.05)' }} />
            <div style={{ padding: '20px' }}>
                <div style={{ height: '20px', width: '60%', background: 'hsla(0, 0%, 100%, 0.05)', borderRadius: '4px', marginBottom: '10px' }} />
                <div style={{ height: '14px', width: '40%', background: 'hsla(0, 0%, 100%, 0.05)', borderRadius: '4px' }} />
            </div>
        </div>
    );
}

function ProfileCard({ g, votes, failedImages, onVote, onOpen, onSendDM, onImageError, useProxyImages, tr, onTgCheck, onDeleteProfile, onSaveAsDonor, authFetch, token }) {
    const vote = votes[g.url];
    const imgUrl = useProxyImages ? `${LOCAL_API_BASE}/api/proxy-image?url=${encodeURIComponent(g.photo)}&token=${token}` : g.photo;
    const isFailed = failedImages.has(g.url);

    return (
        <div className={`profile-card ${g.viewed ? 'viewed' : ''} ${vote === 'dislike' ? 'disliked' : ''}`}>
            <div className="profile-image-wrapper">
                {(!g.photo || isFailed) ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--bg-panel)', color: 'var(--text-dim)' }}>
                        NO PHOTO
                    </div>
                ) : (
                    <img className="profile-image" src={imgUrl} alt={g.name} onError={() => onImageError(g.url)} loading="lazy" />
                )}

                <div className="profile-overlay">
                    <div className="profile-name">@{g.name}</div>
                    <div className="profile-meta">
                        {g.tg_status === 'valid' && (
                            <span style={{ color: 'hsl(var(--success))', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
                                Telegram
                            </span>
                        )}
                        <span>{new Date(g.timestamp).toLocaleDateString()}</span>
                    </div>
                </div>
            </div>

            <div className="card-controls" style={{ padding: '16px', display: 'flex', flexWrap: 'wrap', gap: '8px', background: 'var(--bg-panel)' }}>
                <button className="btn btn-secondary" style={{ flex: 1, padding: '8px' }} onClick={() => onOpen(g.url)}>
                    OPEN
                </button>
                <div style={{ display: 'flex', gap: '4px', width: '100%' }}>
                    <button className={`btn`} style={{ flex: 1, background: vote === 'like' ? 'hsl(var(--success))' : 'hsla(var(--success), 0.1)', color: vote === 'like' ? '#fff' : 'hsl(var(--success))', padding: '8px' }} onClick={() => onVote(g.url, 'like')}>
                        LIKE
                    </button>
                    <button className={`btn`} style={{ flex: 1, background: vote === 'dislike' ? 'hsl(var(--danger))' : 'hsla(var(--danger), 0.1)', color: vote === 'dislike' ? '#fff' : 'hsl(var(--danger))', padding: '8px' }} onClick={() => onVote(g.url, 'dislike')}>
                        NO
                    </button>
                </div>
                <button className={`btn ${g.dmSent ? 'btn-secondary' : 'btn-primary'}`} style={{ width: '100%', padding: '8px' }} onClick={() => onSendDM(g.url)}>
                    {g.dmSent ? 'DM SENT' : 'SEND DM'}
                </button>

                <div style={{ display: 'flex', gap: '8px', width: '100%', marginTop: '4px' }}>
                    <button className="btn btn-secondary" style={{ flex: 1, padding: '4px', fontSize: '10px' }} title="Check TG" onClick={() => onTgCheck(g.name)}>TG</button>
                    <button className="btn btn-secondary" style={{ flex: 1, padding: '4px', fontSize: '10px' }} title="Save as Donor" onClick={() => onSaveAsDonor(g.url)}>DONOR</button>
                    <button className="btn btn-secondary" style={{ flex: 1, padding: '4px', fontSize: '10px', color: 'hsl(var(--danger))' }} title="Delete" onClick={() => onDeleteProfile(g.url)}>DEL</button>
                </div>
            </div>
        </div>
    );
}

export default function ProfilesTab({ girls, votes, tr, onVote, onDeleteProfile, onSaveAsDonor, useProxyImages, isLoading, failedImages, onImageError, onOpen, onSendDM, onTgCheck, onRefresh, authFetch, token, checkingAllTg, onCheckAllTg, restoreStatus, onRestorePhotos }) {
    const [filterText, setFilterText] = useState('');
    const [filterDonor, setFilterDonor] = useState('all');
    const [donors, setDonors] = useState([]);
    const [filterStatus, setFilterStatus] = useState('active');
    const [filterTgStatus, setFilterTgStatus] = useState('all');

    const [hideNoImage, setHideNoImage] = useState(() => JSON.parse(localStorage.getItem('ig_hide_no_image') || 'true'));
    const [hideViewed, setHideViewed] = useState(() => JSON.parse(localStorage.getItem('ig_hide_viewed') || 'true'));
    const [showOnlyCity, setShowOnlyCity] = useState(() => JSON.parse(localStorage.getItem('ig_show_only_city') || 'false'));

    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 24;

    React.useEffect(() => {
        localStorage.setItem('ig_hide_no_image', JSON.stringify(hideNoImage));
        localStorage.setItem('ig_hide_viewed', JSON.stringify(hideViewed));
        localStorage.setItem('ig_show_only_city', JSON.stringify(showOnlyCity));
    }, [hideNoImage, hideViewed, showOnlyCity]);

    React.useEffect(() => {
        authFetch(`/api/donors-collected`)
            .then(res => res.json())
            .then(setDonors)
            .catch(err => console.error('Failed to fetch donors', err));
    }, [girls.length, authFetch]);

    const filtered = (girls || []).filter(g => {
        if (!g || !g.name) return false;
        const nameVal = (g.name || '').toLowerCase();
        const searchVal = (filterText || '').toLowerCase();
        if (searchVal && !nameVal.includes(searchVal)) return false;

        if (filterStatus === 'active' && votes[g.url] === 'dislike') return false;
        if (filterStatus === 'unopened' && g.viewed) return false;
        if (filterStatus === 'like' && votes[g.url] !== 'like') return false;
        if (filterStatus === 'like_no_dm' && (votes[g.url] !== 'like' || g.dmSent)) return false;
        if (filterStatus === 'dislike' && votes[g.url] !== 'dislike') return false;
        if (filterStatus === 'tg' && votes[g.url] !== 'tg') return false;
        if (filterStatus === 'no_status' && votes[g.url]) return false;
        if (filterStatus === 'dm_sent' && !g.dmSent) return false;

        if (filterTgStatus === 'yes' && g.tg_status !== 'valid') return false;
        if (filterTgStatus === 'none' && g.tg_status) return false;
        if (filterTgStatus === 'no' && g.tg_status !== 'invalid') return false;

        if (filterDonor !== 'all' && g.donor !== filterDonor) return false;

        if (hideNoImage && (!g.photo || failedImages.has(g.url))) return false;
        if (hideViewed && (g.viewed || votes[g.url] === 'tg')) return false;
        if (showOnlyCity && g.isInCity !== 1) return false;

        return true;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
    const current = Math.min(currentPage, totalPages);
    const pageData = filtered.slice((current - 1) * ITEMS_PER_PAGE, current * ITEMS_PER_PAGE);

    return (
        <div className="tab-container">
            <div className="toolbar" style={{ background: 'var(--glass)', backdropFilter: 'var(--glass-blur)', border: '1px solid var(--glass-border)', padding: '20px', borderRadius: 'var(--radius-lg)', marginBottom: '24px', display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center', boxShadow: 'var(--shadow-md)' }}>
                <div style={{ flex: 2, minWidth: '200px' }}>
                    <input className="text-input" style={{ width: '100%' }} placeholder={tr('search_placeholder')} value={filterText} onChange={e => { setFilterText(e.target.value); setCurrentPage(1); }} />
                </div>

                <div style={{ flex: 1, minWidth: '150px' }}>
                    <select className="text-input" style={{ width: '100%' }} value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setCurrentPage(1); }}>
                        <option value="all">{tr('filter_all')}</option>
                        <option value="active">{tr('filter_active')}</option>
                        <option value="no_status">{tr('filter_no_status')}</option>
                        <option value="like">{tr('filter_like')}</option>
                        <option value="like_no_dm">{tr('filter_like_no_dm')}</option>
                        <option value="dislike">{tr('filter_dislike')}</option>
                        <option value="tg">{tr('filter_tg')}</option>
                        <option value="dm_sent">{tr('filter_dm_sent')}</option>
                        <option value="unopened">{tr('filter_unopened')}</option>
                    </select>
                </div>

                <div style={{ flex: 1, minWidth: '150px' }}>
                    <select className="text-input" style={{ width: '100%' }} value={filterTgStatus} onChange={e => { setFilterTgStatus(e.target.value); setCurrentPage(1); }}>
                        <option value="all">{tr('filter_tg_all')}</option>
                        <option value="yes">{tr('filter_tg_yes')}</option>
                        <option value="none">{tr('filter_tg_none')}</option>
                        <option value="no">{tr('filter_tg_no')}</option>
                    </select>
                </div>

                <div style={{ flex: 1, minWidth: '150px' }}>
                    <select className="text-input" style={{ width: '100%' }} value={filterDonor} onChange={e => { setFilterDonor(e.target.value); setCurrentPage(1); }}>
                        <option value="all">{tr('filter_donor_all')}</option>
                        {donors.map(d => (<option key={d} value={d}>{d}</option>))}
                    </select>
                </div>

                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                    <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-muted)' }}>
                        <input type="checkbox" checked={hideNoImage} onChange={e => { setHideNoImage(e.target.checked); setCurrentPage(1); }} />
                        <span>{tr('hide_no_photo')}</span>
                    </label>

                    <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-muted)' }}>
                        <input type="checkbox" checked={hideViewed} onChange={e => { setHideViewed(e.target.checked); setCurrentPage(1); }} />
                        <span>{tr('hide_viewed')}</span>
                    </label>

                    <label className="checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-muted)' }}>
                        <input type="checkbox" checked={showOnlyCity} onChange={e => { setShowOnlyCity(e.target.checked); setCurrentPage(1); }} />
                        <span>{tr('filter_only_city')}</span>
                    </label>
                </div>
            </div>

            <div className="profile-grid">
                {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
                ) : (
                    pageData.map(g => (
                        <ProfileCard key={g.url} g={g} votes={votes} failedImages={failedImages} onVote={onVote} onOpen={onOpen} onSendDM={onSendDM} onImageError={onImageError} useProxyImages={useProxyImages} tr={tr} onTgCheck={onTgCheck} onDeleteProfile={onDeleteProfile} onSaveAsDonor={onSaveAsDonor} authFetch={authFetch} token={token} />
                    ))
                )}
                {!isLoading && pageData.length === 0 && (
                    <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '120px 0', color: 'var(--text-dim)', fontSize: '18px', fontFamily: 'Space Grotesk' }}>
                        No profiles match your filters.
                    </div>
                )}
            </div>

            {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '24px', marginTop: '48px', padding: '24px', borderTop: '1px solid var(--border)' }}>
                    <button className="btn btn-secondary" style={{ minWidth: '120px' }} disabled={current === 1} onClick={() => { setCurrentPage(p => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                        {tr('prev')}
                    </button>
                    <span className="page-info" style={{ fontFamily: 'Space Grotesk', fontWeight: '600', fontSize: '16px' }}>
                        {current} <span style={{ color: 'var(--text-dim)', fontWeight: '400' }}>/</span> {totalPages}
                    </span>
                    <button className="btn btn-secondary" style={{ minWidth: '120px' }} disabled={current === totalPages} onClick={() => { setCurrentPage(p => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                        {tr('next')}
                    </button>
                </div>
            )}
        </div>
    );
}
