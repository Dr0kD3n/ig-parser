import { useState, useCallback, memo } from 'react'
import { HeartIcon, XIcon, InstagramIcon, TelegramIcon, SendIcon } from './Icons.jsx'

function parseSmartBio(text, username) {
    if (!text) return { bio: ' ', stats: [] }
    let clean = text.replace(new RegExp(`^${username}\\s*`, 'i'), '')
    const followersMatch = clean.match(/(\d[\d\s]*\s*подписчиков)/i)
    const postsMatch = clean.match(/(\d[\d\s]*\s*публикаций)/i)
    const stats = []
    if (followersMatch) stats.push(followersMatch[0])
    if (postsMatch) stats.push(postsMatch[0])
    const bio = clean.replace(/(\d[\d\s]*\s*(подписчиков|публикаций|подписок))/gi, '').trim()
    return { bio: bio || ' ', stats }
}

const ProfileCard = memo(function ProfileCard({ g, votes, failedImages, onVote, onOpen, onSendDM, onImageError, useProxyImages, tr }) {
    const { bio, stats } = parseSmartBio(g.bio, g.name)
    const isLiked = votes[g.url] === 'like'
    const isDisliked = votes[g.url] === 'dislike'

    const photoSrc = g.photo
        ? (useProxyImages
            ? `/api/proxy-image?url=${encodeURIComponent(g.photo)}`
            : `https://images.weserv.nl/?url=${encodeURIComponent(g.photo)}`)
        : null

    return (
        <div className={`card ${isLiked ? 'status-like' : isDisliked ? 'status-dislike' : ''}`}>
            <div className="photoWrap">
                {photoSrc && !failedImages.has(g.url) ? (
                    <img
                        src={photoSrc}
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        decoding="async"
                        onError={() => onImageError(g.url)}
                        alt={g.name}
                    />
                ) : (
                    <div style={{ width: '100%', height: '100%', background: '#1a1a1e', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 12 }}>
                        No Photo
                    </div>
                )}
                <div className="overlay" />
                <div className="statusStack">
                    {isLiked && <div className="badge likedTag">{tr('badge_like')}</div>}
                    {isDisliked && <div className="badge dislikedTag">{tr('badge_skip')}</div>}
                    {g.viewed && <div className="badge viewedTag">{tr('badge_viewed')}</div>}
                    {g.dmSent && <div className="badge dmTag">{tr('badge_dm_sent')}</div>}
                </div>
                <div className="linksStack">
                    <div className="socialBtn" title="Telegram" onClick={() => window.open(`https://t.me/${g.name}`, '_blank')}>
                        <TelegramIcon />
                    </div>
                    <div className="socialBtn" title="Instagram" onClick={() => onOpen(g)}>
                        <InstagramIcon />
                    </div>
                </div>
            </div>
            <div className="cardBody">
                <div className="name">
                    <span>{g.name}</span>
                    <span className="timestamp">{new Date(g.timestamp).toLocaleDateString()}</span>
                </div>
                <div className="bio-container">
                    <div className="bio-text" title={g.bio}>{bio}</div>
                    {stats.map((s, i) => <span key={i} className="followers-text">{s}</span>)}
                </div>
                <div className="actions">
                    <button
                        className={`actionBtn likeBtn${isLiked ? ' active' : ''}`}
                        onClick={() => onVote(g, 'like')}
                        title={tr('badge_like')}
                    >
                        <HeartIcon filled={isLiked} />
                    </button>
                    <button className="actionBtn dislikeBtn" onClick={() => onVote(g, 'dislike')} title={tr('badge_skip')}>
                        <XIcon />
                    </button>
                    <button className="actionBtn sendBtn" onClick={() => onSendDM(g)} title="Send DM">
                        <SendIcon />
                    </button>
                </div>
            </div>
        </div>
    )
})

export default function ProfilesTab({ girls, votes, viewed, sentDM, failedImages, onVote, onOpen, onSendDM, onImageError, useProxyImages, tr, lang }) {
    const [filterText, setFilterText] = useState('')
    const [filterStatus, setFilterStatus] = useState('all')
    const [hideNoImage, setHideNoImage] = useState(false)
    const [currentPage, setCurrentPage] = useState(1)
    const ITEMS_PER_PAGE = 24

    const filtered = girls.filter(g => {
        const matchesName = g.name.toLowerCase().includes(filterText.toLowerCase())
        let matchesStatus = false
        if (filterStatus === 'all') matchesStatus = true
        else if (filterStatus === 'unopened') matchesStatus = !g.viewed
        else if (filterStatus === 'like') matchesStatus = votes[g.url] === 'like'
        else if (filterStatus === 'like_no_dm') matchesStatus = votes[g.url] === 'like' && !g.dmSent
        else if (filterStatus === 'dislike') matchesStatus = votes[g.url] === 'dislike'
        const imgOk = !hideNoImage || (g.photo && !failedImages.has(g.url))
        return matchesName && matchesStatus && imgOk
    }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))

    const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
    const page = Math.min(currentPage, totalPages)
    const pageData = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

    const handleFilterChange = useCallback((setter) => (e) => {
        setter(e.target.value ?? e.target.checked)
        setCurrentPage(1)
    }, [])

    return (
        <div className="tab-content-fade">
            <div className="toolbar">
                <input
                    className="search-input"
                    placeholder={tr('search_placeholder')}
                    value={filterText}
                    onChange={e => { setFilterText(e.target.value); setCurrentPage(1) }}
                />
                <select className="select-input" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setCurrentPage(1) }}>
                    <option value="all">{tr('filter_all')}</option>
                    <option value="unopened">{tr('filter_unopened')}</option>
                    <option value="like">{tr('filter_like')}</option>
                    <option value="like_no_dm">{tr('filter_like_no_dm')}</option>
                    <option value="dislike">{tr('filter_dislike')}</option>
                </select>
                <label className="checkbox-label">
                    <input type="checkbox" checked={hideNoImage} onChange={e => { setHideNoImage(e.target.checked); setCurrentPage(1) }} />
                    {tr('hide_no_photo')}
                </label>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    {filtered.length} профилей
                </span>
            </div>

            <main className="grid">
                {pageData.map(g => (
                    <ProfileCard
                        key={g.url}
                        g={g}
                        votes={votes}
                        failedImages={failedImages}
                        onVote={onVote}
                        onOpen={onOpen}
                        onSendDM={onSendDM}
                        onImageError={onImageError}
                        useProxyImages={useProxyImages}
                        tr={tr}
                    />
                ))}
                {pageData.length === 0 && (
                    <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
                        Нет профилей по выбранным фильтрам
                    </div>
                )}
            </main>

            {totalPages > 1 && (
                <div className="pagination">
                    <button className="pageBtn" disabled={page === 1} onClick={() => setCurrentPage(p => p - 1)}>{tr('prev')}</button>
                    <span className="page-info">{tr('page_info').replace('{current}', page).replace('{total}', totalPages)}</span>
                    <button className="pageBtn" disabled={page === totalPages} onClick={() => setCurrentPage(p => p + 1)}>{tr('next')}</button>
                </div>
            )}
        </div>
    )
}
