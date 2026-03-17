import React, { useState, memo } from 'react';
import {
  HeartIcon,
  XIcon,
  InstagramIcon,
  TelegramIcon,
  HelpIcon,
  SendIcon,
  TrashIcon,
  SaveIcon,
} from './Icons';
import { toast } from 'react-hot-toast';
function parseSmartBio(text, username) {
  if (!text) return { bio: ' ', stats: [] };
  // 1. Remove mentions of the username and pipes
  let clean = text.replace(new RegExp(`^${username}\\s*`, 'i'), '').replace(/\|/g, ' ');
  // 2. Extract stats (followers/posts)
  const stats = [];
  const followersMatch = clean.match(/(\d[\d\s]*\s*подписчиков)/i);
  const postsMatch = clean.match(/(\d[\d\s]*\s*публикаций)/i);
  if (followersMatch) stats.push(followersMatch[0]);
  if (postsMatch) stats.push(postsMatch[0]);
  // 3. Remove "more", stats, and redundant pipes/junk
  let bio = clean
    .replace(/(\d[\d\s]*\s*(подписчиков|публикаций|подписок|посты))/gi, '')
    .replace(/more\s*\|\s*\w+/gi, '')
    .replace(/\.\.\.\s*more\s*\w*/gi, '')
    .replace(new RegExp(`${username}$`, 'i'), '')
    .replace(/\s+/g, ' ') // Collapse spaces
    .trim();
  // 4. Forceful Deduplication: split by common separators and check for repetitions
  const segments = bio.split(/[\.!\?]\s+/);
  if (segments.length > 2) {
    const unique = [];
    segments.forEach((s) => {
      if (!unique.some((u) => u.includes(s.substring(0, 20)) || s.includes(u.substring(0, 20)))) {
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
        <div className="skeleton skeleton-btn w-full" style={{ marginTop: 4 }} />
      </div>
    </div>
  );
});
const ProfileCard = memo(function ProfileCard({
  g,
  votes,
  failedImages,
  onVote,
  onOpen,
  onSendDM,
  onTagTg,
  onDeleteProfile,
  onSaveAsDonor,
  onImageError,
  useProxyImages,
  tr,
  onTgCheck,
  authFetch,
  token,
}) {
  const { bio, stats } = parseSmartBio(g.bio, g.name);
  const isLiked = votes[g.url] === 'like';
  const isDisliked = votes[g.url] === 'dislike';
  const [checkingTg, setCheckingTg] = useState(false);
  const photoSrc = g.photo
    ? useProxyImages
      ? `/api/proxy-image?url=${encodeURIComponent(g.photo)}&token=${token}`
      : `https://images.weserv.nl/?url=${encodeURIComponent(g.photo)}`
    : null;
  const donorPhotoSrc = g.donor_photo
    ? useProxyImages
      ? `/api/proxy-image?url=${encodeURIComponent(g.donor_photo)}&token=${token}`
      : `https://images.weserv.nl/?url=${encodeURIComponent(g.donor_photo)}`
    : null;
  const handleTgClick = async (e) => {
    e.stopPropagation();
    const tgUrl = `https://t.me/${g.name}`;
    if (g.tg_status === 'valid') {
      window.open(tgUrl, '_blank');
      return;
    }
    const popup = window.open(tgUrl, '_blank', 'width=600,height=800');
    setCheckingTg(true);
    try {
      const resp = await authFetch(`/api/check-telegram?url=${encodeURIComponent(g.name)}`);
      const data = await resp.json();
      if (data.success) {
        if (data.status === 'invalid' && popup) popup.close();
        if (onTgCheck) onTgCheck(g.url, data.status);
      }
    } catch (err) {
    } finally {
      setCheckingTg(false);
    }
  };
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
          <div
            style={{
              width: '100%',
              height: '100%',
              background: '#1a1a1e',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#333',
              fontSize: 12,
            }}
          >
            No Photo
          </div>
        )}
        <div className="overlay" />
        <div className="statusStack">
          {g.matchScore !== undefined && (
            <div className={`badge ${g.matchScore > 80 ? 'badge-match-high' : 'badge-match-low'}`}>
              🎯 {g.matchScore}%
            </div>
          )}
          {isLiked && <div className="badge likedTag">{tr('badge_like')}</div>}
          {isDisliked && <div className="badge dislikedTag">{tr('badge_skip')}</div>}
          {g.viewed && <div className="badge viewedTag">{tr('badge_viewed')}</div>}
          {g.dmSent && <div className="badge dmTag">{tr('badge_sent_dm')}</div>}
          {g.tgTagged && <div className="badge tgTag">{tr('badge_tg_tagged')}</div>}
        </div>
        <div className="linksStack">
          {g.tg_status !== 'invalid' && (
            <div
              className={`socialBtn ${g.tg_status === 'valid' ? 'tg-valid' : ''} ${checkingTg ? 'loading' : ''}`}
              title="Telegram"
              onClick={handleTgClick}
            >
              <TelegramIcon />
              {!g.tg_status && !checkingTg && (
                <div className="status-badge-mini-help">
                  <HelpIcon />
                </div>
              )}
            </div>
          )}
          <div className="socialBtn" title="Instagram" onClick={() => onOpen(g)}>
            <InstagramIcon />
          </div>
        </div>

        <div className="card-overlay-corner">
          <button
            className="socialBtn mini-btn"
            onClick={() => onSaveAsDonor(g.url)}
            title="Save as Donor"
          >
            <SaveIcon />
          </button>
          <button
            className="socialBtn mini-btn mini-btn-danger"
            onClick={() => onDeleteProfile(g.url)}
            title="Delete Profile"
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      <div className="cardBody">
        <div className="name-row">
          <div className="name">
            <span>{g.name}</span>
            <span className="timestamp">{new Date(g.timestamp).toLocaleDateString()}</span>
          </div>
          {g.username && g.username !== g.name && <div className="username-sub">@{g.username}</div>}
        </div>

        {g.donor && (
          <div className="donor-info">
            <span className="donor-label">донор:</span>
            <span className="donor-value">@{g.donor}</span>
            <div className="donor-popover">
              <div className="donor-popover-header">
                {donorPhotoSrc && <img src={donorPhotoSrc} className="donor-popover-img" alt="" />}
                <div>
                  <div className="donor-popover-name">{g.donor_name || g.donor}</div>
                  <div className="donor-popover-username">@{g.donor}</div>
                </div>
              </div>
              <div className="donor-popover-stats">
                {g.donor_followers_count > 0 && (
                  <span>👥 {g.donor_followers_count.toLocaleString()}</span>
                )}
                {(g.donor_posts_count > 0 && (
                  <span>📸 {g.donor_posts_count.toLocaleString()}</span>
                )) ||
                  (g.donor_publications_count > 0 && (
                    <span>📸 {g.donor_publications_count.toLocaleString()}</span>
                  ))}
              </div>
              {g.donor_bio && <div className="donor-popover-bio">{g.donor_bio}</div>}
            </div>
          </div>
        )}

        <div className="bio-container">
          <div className="bio-text" title={g.bio}>
            {bio}
          </div>
          <div className="profile-stats-row">
            {g.followers_count > 0 && (
              <span className="followers-text">👥 {g.followers_count.toLocaleString()}</span>
            )}
            {g.following_count > 0 && (
              <span className="followers-text">👣 {g.following_count.toLocaleString()}</span>
            )}
            {g.publications_count > 0 && (
              <span className="followers-text">📸 {g.publications_count.toLocaleString()}</span>
            )}
            {!g.followers_count &&
              stats.length > 0 &&
              stats.map((s, i) => (
                <span key={i} className="followers-text">
                  {s}
                </span>
              ))}
          </div>
        </div>
        <div className="actions">
          <button
            className={`actionBtn likeBtn${isLiked ? ' active' : ''}`}
            onClick={() => onVote(g, 'like')}
            title={tr('badge_like')}
          >
            <HeartIcon filled={isLiked} />
          </button>
          <button
            className={`actionBtn dislikeBtn${isDisliked ? ' active' : ''}`}
            onClick={() => onVote(g, 'dislike')}
            title={tr('badge_skip')}
          >
            <XIcon />
          </button>
          <button
            className={`actionBtn tgBtn${g.tgTagged ? ' active' : ''}`}
            onClick={() => onTagTg(g)}
            title={tr('btn_tag_tg')}
          >
            <TelegramIcon />
          </button>
        </div>
        <button className="btn-primary full-send-btn" onClick={() => onSendDM(g)}>
          <SendIcon /> {tr('badge_send_dm')}
        </button>
      </div>
    </div>
  );
});
export default function ProfilesTab({
  girls,
  votes,
  viewed,
  sentDM,
  failedImages,
  onVote,
  onOpen,
  onSendDM,
  onTagTg,
  onDeleteProfile,
  onSaveAsDonor,
  onImageError,
  onRefresh,
  useProxyImages,
  tr,
  onTgCheck,
  isLoading,
  authFetch,
  token,
}) {
  const [filterText, setFilterText] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterTgStatus, setFilterTgStatus] = useState('all');
  const [sortOption, setSortOption] = useState('newest');
  const [hideNoImage, setHideNoImage] = useState(false);
  const [hideViewed, setHideViewed] = useState(false);
  const [cityOnly, setCityOnly] = useState(false);
  const [filterDonor, setFilterDonor] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [checkingAllTg, setCheckingAllTg] = useState(false);
  const ITEMS_PER_PAGE = 24;
  const handleCheckAllTg = async () => {
    const toCheck = girls.filter((g) => !g.tg_status).map((g) => g.name);
    if (toCheck.length === 0) {
      toast.error('Нет профилей без статуса для проверки');
      return;
    }
    if (!confirm(`Проверить ${toCheck.length} профилей? Это может занять время.`)) return;
    setCheckingAllTg(true);
    try {
      const resp = await authFetch('/api/check-telegram-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: toCheck }),
      });
      const data = await resp.json();
      if (data.success) {
        if (onRefresh) await onRefresh();
      }
    } catch (err) {
      console.error('Batch TG check failed', err);
    } finally {
      setCheckingAllTg(false);
    }
  };
  const uniqueDonors = Array.from(new Set(girls.map((g) => g.donor).filter(Boolean))).sort();

  const filtered = girls
    .filter((g) => {
      const matchesName = g.name.toLowerCase().includes(filterText.toLowerCase());
      let matchesStatus = false;
      if (filterStatus === 'all') matchesStatus = true;
      else if (filterStatus === 'unopened') matchesStatus = !g.viewed;
      else if (filterStatus === 'like') matchesStatus = votes[g.url] === 'like';
      else if (filterStatus === 'like_no_dm') matchesStatus = votes[g.url] === 'like' && !g.dmSent;
      else if (filterStatus === 'dislike') matchesStatus = votes[g.url] === 'dislike';
      else if (filterStatus === 'no_status') matchesStatus = !votes[g.url];
      else if (filterStatus === 'active') matchesStatus = votes[g.url] !== 'dislike';
      else if (filterStatus === 'dm_sent') matchesStatus = g.dmSent;
      let matchesTg = true;
      if (filterTgStatus === 'yes') matchesTg = g.tg_status === 'valid';
      else if (filterTgStatus === 'none') matchesTg = !g.tg_status;
      const matchesViewed = !hideViewed || !g.viewed;
      const matchesCity = !cityOnly || g.isInCity;
      const imgOk = !hideNoImage || (g.photo && !failedImages.has(g.url));
      const matchesDonor = filterDonor === 'all' || g.donor === filterDonor;
      return (
        matchesName &&
        matchesStatus &&
        matchesTg &&
        matchesViewed &&
        matchesCity &&
        imgOk &&
        matchesDonor
      );
    })
    .sort((a, b) => {
      if (sortOption === 'oldest')
        return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      if (sortOption === 'match') {
        const scoreA = a.matchScore !== undefined ? a.matchScore : 50;
        const scoreB = b.matchScore !== undefined ? b.matchScore : 50;
        if (scoreB !== scoreA) return scoreB - scoreA;
      }
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const page = Math.min(currentPage, totalPages);
  const pageData = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);
  return (
    <div className="tab-content-fade">
      <div className="toolbar">
        <input
          className="search-input"
          placeholder={tr('search_placeholder')}
          value={filterText}
          onChange={(e) => {
            setFilterText(e.target.value);
            setCurrentPage(1);
          }}
        />
        <select
          className="select-input"
          value={filterStatus}
          onChange={(e) => {
            setFilterStatus(e.target.value);
            setCurrentPage(1);
          }}
        >
          <option value="all">{tr('filter_all')}</option>
          <option value="no_status">{tr('filter_no_status')}</option>
          <option value="active">{tr('filter_active')}</option>
          <option value="like">{tr('filter_like')}</option>
          <option value="like_no_dm">{tr('filter_like_no_dm')}</option>
          <option value="dislike">{tr('filter_dislike')}</option>
          <option value="dm_sent">{tr('filter_dm_sent')}</option>
          <option value="unopened">{tr('filter_unopened')}</option>
        </select>
        <select
          className="select-input"
          value={filterTgStatus}
          onChange={(e) => {
            setFilterTgStatus(e.target.value);
            setCurrentPage(1);
          }}
        >
          <option value="all">{tr('filter_tg_all')}</option>
          <option value="yes">{tr('filter_tg_yes')}</option>
          <option value="none">{tr('filter_tg_none')}</option>
        </select>

        <select
          className="select-input"
          value={filterDonor}
          onChange={(e) => {
            setFilterDonor(e.target.value);
            setCurrentPage(1);
          }}
        >
          <option value="all">
            {tr('filter_donor')}: {tr('filter_all')}
          </option>
          {uniqueDonors.map((d) => (
            <option key={d} value={d}>
              @{d}
            </option>
          ))}
        </select>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={hideNoImage}
            onChange={(e) => {
              setHideNoImage(e.target.checked);
              setCurrentPage(1);
            }}
          />
          {tr('hide_no_photo')}
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={hideViewed}
            onChange={(e) => {
              setHideViewed(e.target.checked);
              setCurrentPage(1);
            }}
          />
          {tr('filter_viewed')}
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={cityOnly}
            onChange={(e) => {
              setCityOnly(e.target.checked);
              setCurrentPage(1);
            }}
          />
          {tr('filter_city')}
        </label>
        <span className="count-badge ml-auto">{filtered.length} профилей</span>
      </div>

      <main className="grid">
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
          : pageData.map((g) => (
              <ProfileCard
                key={g.url}
                g={g}
                votes={votes}
                failedImages={failedImages}
                onVote={onVote}
                onOpen={onOpen}
                onSendDM={onSendDM}
                onTagTg={onTagTg}
                onDeleteProfile={onDeleteProfile}
                onSaveAsDonor={onSaveAsDonor}
                onImageError={onImageError}
                useProxyImages={useProxyImages}
                tr={tr}
                onTgCheck={onTgCheck}
                authFetch={authFetch}
                token={token}
              />
            ))}
        {!isLoading && pageData.length === 0 && (
          <div className="empty-state-msg">Нет профилей по выбранным фильтрам</div>
        )}
      </main>

      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="pageBtn"
            disabled={page === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            {tr('prev')}
          </button>
          <span className="page-info">
            {tr('page_info')
              .replace('{current}', String(page))
              .replace('{total}', String(totalPages))}
          </span>
          <button
            className="pageBtn"
            disabled={page === totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            {tr('next')}
          </button>
        </div>
      )}
    </div>
  );
}
