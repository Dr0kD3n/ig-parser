import { useEffect, useRef, useState, memo } from 'react';
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
import { plural } from '../utils/text';
import { parseSmartBio, getProfilePhotoSrc, getDmErrorLabel, getTelegramUsername, getTelegramUrl, hasTelegram } from '../utils/profile';
import { filterProfiles } from '../utils/profileFilters';
import { usePersistedFilters } from '../hooks/usePersistedFilters';

const ITEMS_PER_PAGE = 60;

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
  onTgCheck,
  authFetch,
}) {
  const { bio, stats } = parseSmartBio(g.bio, g.name);
  const isLiked = votes[g.url] === 'like';
  const isDisliked = votes[g.url] === 'dislike';
  const [checkingTg, setCheckingTg] = useState(false);
  const photoSrc = getProfilePhotoSrc(g.photo_local, g.photo);
  const donorPhotoSrc = getProfilePhotoSrc(g.donor_photo_local, g.donor_photo);

  const handleTgClick = async (e) => {
    e.stopPropagation();
    const tgUser = getTelegramUsername(g);
    if (!tgUser) return;
    const tgUrl = getTelegramUrl(g);

    if (hasTelegram(g.tg_status)) {
      window.open(tgUrl, '_blank');
      return;
    }

    const popup = window.open(tgUrl, '_blank', 'width=600,height=800');
    setCheckingTg(true);

    try {
      const qs = new URLSearchParams({
        username: tgUser,
        profileUrl: g.url,
      });
      const resp = await authFetch(`/api/check-telegram?${qs}`);
      const data = await resp.json();
      if (data.success) {
        if (data.status === 'invalid' && popup) popup.close();
        onTgCheck?.(g.url, data.status);
      }
    } catch {
      /* сеть — статус не меняем */
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
          <div className="no-photo-placeholder">No Photo</div>
        )}
        <div className="overlay" />
        <div className="statusStack">
          {g.matchScore !== undefined && (
            <div className={`badge ${g.matchScore > 80 ? 'badge-match-high' : 'badge-match-low'}`}>
              🎯 {g.matchScore}%
            </div>
          )}
          {isLiked && <div className="badge likedTag">Лайк</div>}
          {isDisliked && <div className="badge dislikedTag">Скип</div>}
          {g.viewed && <div className="badge viewedTag">Чекалась</div>}
          {g.dmSent && !g.dmError && !g.dm_status && <div className="badge dmTag">Написал</div>}
          {g.dm_status === 'replied' && (
            <div className="badge dmTag" style={{ background: 'hsl(var(--success))' }}>✨ Ответил</div>
          )}
          {g.dm_status === 'liked' && <div className="badge likedTag">❤️ Лайкнул</div>}
          {g.tg_status === 'valid' && <div className="badge tgTag">TG</div>}
          {g.tg_status === 'channel' && <div className="badge tgChannelTag">TG канал</div>}
          {g.dmError && (
            <div className="badge tgNotSentTag" title={getDmErrorLabel(g.dmError)}>
              ⚠️ Не написал в тг
            </div>
          )}
        </div>
        <div className="linksStack">
          {getTelegramUsername(g) && g.tg_status !== 'invalid' && (
            <div
              className={`socialBtn ${g.tg_status === 'valid' ? 'tg-valid' : ''} ${g.tg_status === 'channel' ? 'tg-channel' : ''} ${checkingTg ? 'loading' : ''}`}
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
            type="button"
            className="socialBtn mini-btn"
            onClick={() => onSaveAsDonor(g.url)}
            title="Save as Donor"
          >
            <SaveIcon />
          </button>
          <button
            type="button"
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
              stats.map((s, i) => (
                <span key={i} className="followers-text">
                  {s}
                </span>
              ))}
          </div>
        </div>

        <div className="actions">
          <button
            type="button"
            className={`actionBtn likeBtn${isLiked ? ' active' : ''}`}
            onClick={() => onVote(g, 'like')}
            title="Лайк"
          >
            <HeartIcon filled={isLiked} />
          </button>
          <button
            type="button"
            className={`actionBtn dislikeBtn${isDisliked ? ' active' : ''}`}
            onClick={() => onVote(g, 'dislike')}
            title="Скип"
          >
            <XIcon />
          </button>
          <button
            type="button"
            className={`actionBtn tgBtn${g.tgTagged === 1 ? ' active' : ''}`}
            onClick={() => onTagTg(g)}
            title="Написал в тг"
          >
            <TelegramIcon />
          </button>
        </div>

        <button type="button" className="btn-primary full-send-btn" onClick={() => onSendDM(g)}>
          <SendIcon /> Написать
        </button>
      </div>
    </div>
  );
});

export default function ProfilesTab({
  girls,
  votes,
  failedImages,
  onVote,
  onOpen,
  onSendDM,
  onTagTg,
  onDeleteProfile,
  onSaveAsDonor,
  onImageError,
  onTgCheck,
  isLoading,
  authFetch,
  cityOnly,
  setCityOnly,
  matchesProfileCity,
  matchesWordsBlacklist,
}) {
  const filters = usePersistedFilters();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const filtersRef = useRef(null);

  const resetPage = () => setCurrentPage(1);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!filtersRef.current || filtersRef.current.contains(event.target)) return;
      setFiltersOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const uniqueDonors = Array.from(new Set(girls.map((g) => g.donor).filter(Boolean))).sort();

  const filtered = filterProfiles(girls, {
    votes,
    failedImages,
    cityOnly,
    matchesProfileCity,
    matchesWordsBlacklist,
    ...filters,
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const page = Math.min(currentPage, totalPages);
  const pageData = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE);

  return (
    <div className="tab-content-fade">
      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Поиск профилей..."
          value={filters.filterText}
          onChange={(e) => {
            filters.setFilterText(e.target.value);
            resetPage();
          }}
        />
        <select
          className="select-input"
          value={filters.filterStatus}
          onChange={(e) => {
            filters.setFilterStatus(e.target.value);
            resetPage();
          }}
        >
          <option value="all">Все профили</option>
          <option value="no_status">Без статуса</option>
          <option value="active">Активные</option>
          <option value="like">Лайкнутые</option>
          <option value="like_no_dm">Лайкнутые (Без ЛС)</option>
          <option value="dislike">Дизлайкнутые</option>
          <option value="dm_sent">С отправленным ЛС</option>
          <option value="replied">Ответившие</option>
          <option value="unopened">Только скрытые</option>
        </select>
        <select
          className="select-input"
          value={filters.filterTgStatus}
          onChange={(e) => {
            filters.setFilterTgStatus(e.target.value);
            resetPage();
          }}
        >
          <option value="all">Все (TG)</option>
          <option value="yes">Есть Telegram</option>
          <option value="none">Непроверен</option>
        </select>
        <select
          className="select-input"
          value={filters.filterDonor}
          onChange={(e) => {
            filters.setFilterDonor(e.target.value);
            resetPage();
          }}
        >
          <option value="all">Доноры: Все профили</option>
          {uniqueDonors.map((d) => (
            <option key={d} value={d}>
              @{d}
            </option>
          ))}
        </select>
        <span className="count-badge ml-auto">
          {filtered.length} {plural(filtered.length, 'профиль', 'профиля', 'профилей')}
        </span>
        <div className="profile-filters-menu" ref={filtersRef}>
          <button
            type="button"
            className={`profile-filters-btn${filtersOpen ? ' active' : ''}`}
            onClick={() => setFiltersOpen((open) => !open)}
            aria-label="Открыть фильтры"
          >
            <span />
            <span />
            <span />
          </button>
          {filtersOpen && (
            <div className="profile-filters-popover">
              <div className="popover-title">Фильтры</div>
              <div className="followers-filter-row">
                <label>
                  <span>Подписчики от</span>
                  <input
                    type="number"
                    min="0"
                    value={filters.followersMin}
                    onChange={(e) => {
                      filters.setFollowersMin(e.target.value);
                      resetPage();
                    }}
                    placeholder="0"
                  />
                </label>
                <label>
                  <span>до</span>
                  <input
                    type="number"
                    min="0"
                    value={filters.followersMax}
                    onChange={(e) => {
                      filters.setFollowersMax(e.target.value);
                      resetPage();
                    }}
                    placeholder="∞"
                  />
                </label>
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={filters.hideNoImage}
                  onChange={(e) => {
                    filters.setHideNoImage(e.target.checked);
                    resetPage();
                  }}
                />
                Скрыть без фото
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={filters.hideViewed}
                  onChange={(e) => {
                    filters.setHideViewed(e.target.checked);
                    resetPage();
                  }}
                />
                Скрыть чекнутые
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={cityOnly}
                  onChange={(e) => {
                    setCityOnly(e.target.checked);
                    resetPage();
                  }}
                />
                Только город
              </label>
            </div>
          )}
        </div>
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
                onTgCheck={onTgCheck}
                authFetch={authFetch}
              />
            ))}
        {!isLoading && pageData.length === 0 && (
          <div className="empty-state-msg">Нет профилей по выбранным фильтрам</div>
        )}
      </main>

      {totalPages > 1 && (
        <div className="pagination">
          <button
            type="button"
            className="pageBtn"
            disabled={page === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            ← Назад
          </button>
          <span className="page-info">
            Страница {page} из {totalPages}
          </span>
          <button
            type="button"
            className="pageBtn"
            disabled={page === totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            Вперед →
          </button>
        </div>
      )}
    </div>
  );
}
