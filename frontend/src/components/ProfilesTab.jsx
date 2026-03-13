import React, { useState, memo } from 'react';
import { HeartIcon, XIcon, InstagramIcon, TelegramIcon, HelpIcon, SendIcon, InfoIcon, PlusIcon } from './Icons';
import { toast } from 'react-hot-toast';

function parseSmartBio(text, username) {
    if (!text)
        return { bio: ' ', stats: [] };
    // 1. Remove mentions of the username and pipes
    let clean = text.replace(new RegExp(`^${username}\\s*`, 'i'), '').replace(/\|/g, ' ');
    // 2. Extract stats (followers/posts)
    const stats = [];
    const followersMatch = clean.match(/(\d[\d\s]*\s*(подписчиков|followers))/i);
    const postsMatch = clean.match(/(\d[\d\s]*\s*(публикаций|posts))/i);
    if (followersMatch)
        stats.push(followersMatch[0]);
    if (postsMatch)
        stats.push(postsMatch[0]);
    // 3. Remove "more", stats, and redundant pipes/junk
    let bio = clean
        .replace(/(\d[\d\s]*\s*(подписчиков|followers|публикаций|posts|подписок|following|посты))/gi, '')
        .replace(/more\s*\|\s*\w+/gi, '')
        .replace(/\.\.\.\s*more\s*\w*/gi, '')
        .replace(new RegExp(`${username}$`, 'i'), '')
        .replace(/\s+/g, ' ') // Collapse spaces
        .trim();
    // 4. Forceful Deduplication: split by common separators and check for repetitions
    const segments = bio.split(/[\.!\?]\s+/);
    if (segments.length > 2) {
        const unique = [];
        segments.forEach(s => {
            if (!unique.some(u => u.includes(s.substring(0, 20)) || s.includes(u.substring(0, 20)))) {
                unique.push(s);
            }
        });
        bio = unique.join('. ');
    }
    return { bio: bio || ' ', stats };
}

const SkeletonCard = memo(function SkeletonCard() {
    return (
        <div className="card skeleton-card">
            <div className="skeleton skeleton-img" />
            <div className="skeleton-body">
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line short" />
                <div className="skeleton-actions">
                    <div className="skeleton skeleton-btn" />
                    <div className="skeleton skeleton-btn" />
                    <div className="skeleton skeleton-btn" />
                </div>
            </div>
        </div>
    );
});

const ProfileCard = memo(function ProfileCard({
    g,
    votes = {},
    failedImages = new Set(),
    onVote,
    onOpen,
    onSendDM,
    onImageError,
    useProxyImages,
    tr = (k) => k,
    onTgCheck,
    onDeleteProfile,
    onSaveAsDonor
}) {
    const [checkingTg, setCheckingTg] = useState(false);
    const [showDetails, setShowDetails] = useState(false);

    try {
        if (!g || !g.url) {
            console.warn('ProfileCard: missing g or g.url', g);
            return null;
        }

        const { bio, stats } = parseSmartBio(g.bio, g.name || '');
        const isLiked = (votes || {})[g.url] === 'like';
        const isDisliked = (votes || {})[g.url] === 'dislike';
        const isTg = (votes || {})[g.url] === 'tg';

        const photoSrc = g.photo
            ? (useProxyImages
                ? `/api/proxy-image?url=${encodeURIComponent(g.photo)}`
                : `https://images.weserv.nl/?url=${encodeURIComponent(g.photo)}`)
            : null;

        const handleTgClick = async (e) => {
            e.stopPropagation();
            const tgUrl = `https://t.me/${g.name}`;
            if (g.tg_status === 'valid') {
                window.open(tgUrl, '_blank');
                if (onVote && (votes[g.url] !== 'tg')) {
                    onVote(g.url, 'tg');
                }
                return;
            }
            const popup = window.open(tgUrl, '_blank', 'width=600,height=800');
            setCheckingTg(true);
            try {
                const resp = await fetch(`/api/check-telegram?url=${encodeURIComponent(g.name)}`);
                const data = await resp.json();
                if (data.success) {
                    if (data.status === 'invalid') {
                        if (popup) popup.close();
                    } else if (data.status === 'valid') {
                        if (onVote && (votes[g.url] !== 'tg')) {
                            onVote(g.url, 'tg');
                        }
                    }
                    if (onTgCheck) onTgCheck(g.url, data.status);
                }
            }
            catch (err) {
                console.error('TG check failed', err);
            }
            finally {
                setCheckingTg(false);
            }
        };

        const donorPhotoSrc = g.donor_photo
            ? (useProxyImages
                ? `/api/proxy-image?url=${encodeURIComponent(g.donor_photo)}`
                : `https://images.weserv.nl/?url=${encodeURIComponent(g.donor_photo)}`)
            : null;

        return (
            <div className={`card ${isLiked ? 'status-like' : isDisliked ? 'status-dislike' : isTg ? 'status-tg' : ''}`}>
                <div className={`profileDetailsPopover ${showDetails ? 'visible' : ''}`} onMouseEnter={() => setShowDetails(true)} onMouseLeave={() => setShowDetails(false)}>
                    <button
                        className="popoverDeleteBtn"
                        title={tr('delete')}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (onDeleteProfile) onDeleteProfile(g.url);
                        }}
                    >
                        <XIcon />
                    </button>
                    {donorPhotoSrc && (
                        <div className="donorPopoverPhoto">
                            <img src={donorPhotoSrc} alt={g.donor_name} referrerPolicy="no-referrer" />
                        </div>
                    )}
                    <div className="detailRow">
                        <div className="detailLabel">{tr('donor_info_title')}</div>
                        <div className="detailValue" style={{ fontWeight: 800, color: 'hsl(var(--primary))' }}>@{g.donor}</div>
                    </div>
                    <div className="detailRow">
                        <div className="detailLabel">{tr('donor_name')}</div>
                        <div className="detailValue">{g.donor_name || '—'}</div>
                    </div>
                    <div className="detailRow">
                        <div className="detailLabel">{tr('donor_followers')}</div>
                        <div className="detailValue">{g.donor_followers_count ? g.donor_followers_count.toLocaleString() : '—'}</div>
                    </div>
                    <div className="detailRow">
                        <div className="detailLabel">{tr('donor_posts')}</div>
                        <div className="detailValue">{g.donor_posts_count ? g.donor_posts_count.toLocaleString() : '—'}</div>
                    </div>
                    <div className="detailRow">
                        <div className="detailLabel">{tr('donor_bio')}</div>
                        <div className="detailValue" style={{ whiteSpace: 'pre-wrap', fontSize: '13px', maxHeight: '100px', overflowY: 'auto' }}>{g.donor_bio || '—'}</div>
                    </div>
                </div>
                <div className="photoWrap">
                    {photoSrc && !failedImages.has(g.url) ? (
                        <img src={photoSrc} referrerPolicy="no-referrer" loading="lazy" decoding="async" onError={() => onImageError(g.url)} alt={g.name} />
                    ) : (
                        <div style={{ width: '100%', height: '100%', background: '#1a1a1e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 12 }}>
                            No Photo
                        </div>
                    )}
                    <div className="overlay" />
                    <div className="statusStack">
                        {g.matchScore !== undefined && (
                            <div className="badge matchTag" style={{ background: g.matchScore > 80 ? 'hsla(var(--primary), 0.8)' : 'hsla(var(--text-dim), 0.2)' }}>
                                🎯 {g.matchScore}%
                            </div>
                        )}
                        {isLiked && <div className="badge likedTag">{tr('badge_like')}</div>}
                        {isDisliked && <div className="badge dislikedTag">{tr('badge_skip')}</div>}
                        {isTg && <div className="badge tgTag">{tr('badge_tg')}</div>}
                        {g.viewed && <div className="badge viewedTag">{tr('badge_viewed')}</div>}
                        {g.dmSent && <div className="badge dmTag">{tr('badge_dm_sent')}</div>}
                    </div>
                    <div className="linksStack">
                        {(g.donor_name || g.donor_bio || g.donor_followers_count) && (
                            <div className="socialBtn" title="Details"
                                onMouseEnter={() => setShowDetails(true)}
                                onMouseLeave={() => setShowDetails(false)}>
                                <InfoIcon />
                            </div>
                        )}
                        {g.tg_status !== 'invalid' && (
                            <div className={`socialBtn ${g.tg_status === 'valid' ? 'tg-valid' : ''} ${checkingTg ? 'loading' : ''}`} title="Telegram" onClick={handleTgClick} style={{ position: 'relative' }}>
                                <TelegramIcon />
                                {!g.tg_status && !checkingTg && (
                                    <div className="status-badge-mini" style={{ position: 'absolute', top: -4, right: -4, background: 'orange', borderRadius: '50%', width: 12, height: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid white' }}>
                                        <HelpIcon />
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="socialBtn" title="Instagram" onClick={() => onOpen(g)}>
                            <InstagramIcon />
                        </div>
                    </div>
                </div>
                <div className="cardBody">
                    <div className="name">
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                            {g.name}
                            {g.donor && <span className="donorTag">{g.donor}</span>}
                        </span>
                        <span className="timestamp">{new Date(g.timestamp).toLocaleDateString()}</span>
                    </div>
                    <div className="bio-container">
                        <div className="bio-text" title={g.bio}>{bio}</div>
                        <div className="stats-container" style={{ marginTop: 'auto', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            {g.followers_count > 0 && (
                                <span className="followers-text">👥 {g.followers_count.toLocaleString()}</span>
                            )}
                            {g.publications_count > 0 && (
                                <span className="followers-text">📝 {g.publications_count.toLocaleString()}</span>
                            )}
                            {stats.length > 0 && g.followers_count === 0 && g.publications_count === 0 && (
                                stats.map((s, i) => <span key={i} className="followers-text">{s}</span>)
                            )}
                        </div>
                    </div>
                    <div className={`actions ${g.tg_status === 'valid' ? 'has-tg' : 'no-tg'}`}>
                        <button className={`actionBtn likeBtn${isLiked ? ' active' : ''}`} onClick={() => onVote(g.url, 'like')} title={tr('badge_like')}>
                            <HeartIcon filled={isLiked} />
                        </button>
                        <button className={`actionBtn dislikeBtn${isDisliked ? ' active' : ''}`} onClick={() => onVote(g.url, 'dislike')} title={tr('badge_skip')}>
                            <XIcon />
                        </button>
                        {g.tg_status === 'valid' && (
                            <button className={`actionBtn tgBtn${isTg ? ' active' : ''}`} onClick={() => onVote(g.url, 'tg')} title={tr('filter_tg')}>
                                <TelegramIcon />
                            </button>
                        )}
                        <button className="actionBtn sendBtn" onClick={() => onSendDM(g)} title={tr('modal_send_dm')}>
                            <span>{tr('modal_send_dm')}</span>
                        </button>
                    </div>
                    <button className="donorBtn" onClick={() => onSaveAsDonor(g.url)} title={tr('btn_save_as_donor')}>
                        <PlusIcon /> {tr('btn_save_as_donor')}
                    </button>
                </div>
            </div>
        );
    } catch (err) {
        console.error('ProfileCard render crash', err, g);
        return <div className="card">Error rendering card</div>;
    }
});

export default function ProfilesTab({
    girls = [],
    votes = {},
    viewed = [],
    sentDM = [],
    failedImages = new Set(),
    onVote,
    onOpen,
    onSendDM,
    onImageError,
    onRefresh,
    useProxyImages,
    tr = (k) => k,
    onTgCheck,
    isLoading,
    onDeleteProfile,
    onSaveAsDonor
}) {
    const [filterDonor, setFilterDonor] = useState('all');
    const [donors, setDonors] = useState([]);
    const [filterText, setFilterText] = useState('');
    const [filterStatus, setFilterStatus] = useState('active');
    const [filterTgStatus, setFilterTgStatus] = useState('all');
    const [hideNoImage, setHideNoImage] = useState(() => {
        try {
            const stored = localStorage.getItem('ig_hide_no_image');
            return stored !== null ? JSON.parse(stored) : true;
        } catch (e) { return true; }
    });
    const [hideViewed, setHideViewed] = useState(() => {
        try {
            const stored = localStorage.getItem('ig_hide_viewed');
            return stored !== null ? JSON.parse(stored) : true;
        } catch (e) { return true; }
    });
    const [showOnlyCity, setShowOnlyCity] = useState(() => {
        try {
            const stored = localStorage.getItem('ig_show_only_city');
            return stored !== null ? JSON.parse(stored) : true;
        } catch (e) { return true; }
    });

    React.useEffect(() => {
        localStorage.setItem('ig_hide_no_image', JSON.stringify(hideNoImage));
    }, [hideNoImage]);

    React.useEffect(() => {
        localStorage.setItem('ig_hide_viewed', JSON.stringify(hideViewed));
    }, [hideViewed]);

    React.useEffect(() => {
        localStorage.setItem('ig_show_only_city', JSON.stringify(showOnlyCity));
    }, [showOnlyCity]);
    const [currentPage, setCurrentPage] = useState(1);
    const [checkingAllTg, setCheckingAllTg] = useState(false);
    const ITEMS_PER_PAGE = 24;

    React.useEffect(() => {
        fetch(`/api/donors-collected`)
            .then(res => res.json())
            .then(setDonors)
            .catch(err => console.error('Failed to fetch donors', err));
    }, [girls.length]);

    const handleCheckAllTg = async () => {
        const toCheck = girls.filter(g => !g.tg_status).map(g => g.name);
        if (toCheck.length === 0) {
            toast.error('Нет профилей без статуса для проверки');
            return;
        }
        setCheckingAllTg(true);
        try {
            const resp = await fetch(`/api/check-telegram-batch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: toCheck })
            });
            const data = await resp.json();
            if (data.success) {
                if (onRefresh) await onRefresh();
            }
        }
        catch (err) {
            console.error('Batch TG check failed', err);
        }
        finally {
            setCheckingAllTg(false);
        }
    };

    const filtered = (girls || []).filter(g => {
        if (!g || !g.name) return false;
        const matchesName = (g.name || '').toLowerCase().includes((filterText || '').toLowerCase());
        let matchesStatus = false;
        if (filterStatus === 'all')
            matchesStatus = true;
        else if (filterStatus === 'active')
            matchesStatus = votes[g.url] !== 'dislike';
        else if (filterStatus === 'unopened')
            matchesStatus = !g.viewed;
        else if (filterStatus === 'like')
            matchesStatus = votes[g.url] === 'like';
        else if (filterStatus === 'like_no_dm')
            matchesStatus = votes[g.url] === 'like' && !g.dmSent;
        else if (filterStatus === 'dislike')
            matchesStatus = votes[g.url] === 'dislike';
        else if (filterStatus === 'tg')
            matchesStatus = votes[g.url] === 'tg';
        else if (filterStatus === 'no_status')
            matchesStatus = !votes[g.url];
        else if (filterStatus === 'dm_sent')
            matchesStatus = g.dmSent;

        let matchesTg = true;
        if (filterTgStatus === 'yes')
            matchesTg = g.tg_status === 'valid';
        else if (filterTgStatus === 'none')
            matchesTg = !g.tg_status;
        else if (filterTgStatus === 'no')
            matchesTg = g.tg_status === 'invalid';

        let matchesDonor = true;
        if (filterDonor !== 'all') {
            matchesDonor = g.donor === filterDonor;
        }

        const imgOk = !hideNoImage || (g.photo && !failedImages.has(g.url));
        const viewedOk = !hideViewed || (!g.viewed && votes[g.url] !== 'tg');
        const cityOk = !showOnlyCity || g.isInCity === 1;
        return matchesName && matchesStatus && matchesTg && imgOk && matchesDonor && viewedOk && cityOk;
    });

    const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
    const page = Math.min(currentPage, totalPages);
    const pageData = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

    return (
        <div className="tab-content-fade">
            <div className="toolbar">
                <div className="toolbar-group horizontal-group">
                    <input className="search-input" placeholder={tr('search_placeholder')} value={filterText} onChange={e => { setFilterText(e.target.value); setCurrentPage(1); }} />

                    <select className="select-input" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setCurrentPage(1); }}>
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

                    <select className="select-input" value={filterTgStatus} onChange={e => { setFilterTgStatus(e.target.value); setCurrentPage(1); }}>
                        <option value="all">{tr('filter_tg_all')}</option>
                        <option value="yes">{tr('filter_tg_yes')}</option>
                        <option value="none">{tr('filter_tg_none')}</option>
                        <option value="no">{tr('filter_tg_no')}</option>
                    </select>

                    <select className="select-input" title={tr('donor_filter_label')} value={filterDonor} onChange={e => { setFilterDonor(e.target.value); setCurrentPage(1); }}>
                        <option value="all">{tr('filter_donor_all')}</option>
                        {donors.map(d => (<option key={d} value={d}>{d}</option>))}
                    </select>

                    <label className="checkbox-label">
                        <input type="checkbox" checked={hideNoImage} onChange={e => { setHideNoImage(e.target.checked); setCurrentPage(1); }} />
                        <span>{tr('hide_no_photo')}</span>
                    </label>

                    <label className="checkbox-label">
                        <input type="checkbox" checked={hideViewed} onChange={e => { setHideViewed(e.target.checked); setCurrentPage(1); }} />
                        <span>{tr('hide_viewed')}</span>
                    </label>

                    <label className="checkbox-label">
                        <input type="checkbox" checked={showOnlyCity} onChange={e => { setShowOnlyCity(e.target.checked); setCurrentPage(1); }} />
                        <span>{tr('filter_only_city')}</span>
                    </label>


                </div>

                <div className="toolbar-actions">
                    <button className="btn-primary check-tg-btn" onClick={handleCheckAllTg} disabled={checkingAllTg}>
                        {checkingAllTg ? (<span className="loading-spinner-mini" />) : (<TelegramIcon style={{ width: 16, height: 16 }} />)}
                        {checkingAllTg ? 'Checking...' : tr('btn_check_all_tg')}
                    </button>
                </div>
            </div>

            <main className="grid">
                {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
                ) : (
                    pageData.map(g => (
                        <ProfileCard key={g.url} g={g} votes={votes} failedImages={failedImages} onVote={onVote} onOpen={onOpen} onSendDM={onSendDM} onImageError={onImageError} useProxyImages={useProxyImages} tr={tr} onTgCheck={onTgCheck} onDeleteProfile={onDeleteProfile} onSaveAsDonor={onSaveAsDonor} />
                    ))
                )}
                {!isLoading && pageData.length === 0 && (
                    <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '100px 0', color: 'hsl(var(--text-dim))', fontSize: '16px' }}>
                        Нет профилей по выбранным фильтрам
                    </div>
                )}
            </main>

            {totalPages > 1 && (
                <div className="pagination">
                    <button className="pageBtn" disabled={page === 1} onClick={() => setCurrentPage(p => p - 1)}>{tr('prev')}</button>
                    <span className="page-info">{tr('page_info').replace('{current}', String(page)).replace('{total}', String(totalPages))}</span>
                    <button className="pageBtn" disabled={page === totalPages} onClick={() => setCurrentPage(p => p + 1)}>{tr('next')}</button>
                </div>
            )}
        </div>
    );
}
