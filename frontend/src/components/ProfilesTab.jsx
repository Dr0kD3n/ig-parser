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
import {
  getProfilePhotoSrc,
  getDmErrorLabel,
  getTelegramUsername,
  getTelegramUrl,
  hasTelegram,
} from '../utils/profile';
import { filterProfiles } from '../utils/profileFilters';
import { usePersistedFilters } from '../hooks/usePersistedFilters';

const ITEMS_PER_PAGE = 60;

const SkeletonCard = memo(function SkeletonCard() {
  return (
    <div className="card profile-card skeleton-card">
      <div className="photoWrap profile-photo-wrap">
        <div className="skeleton skeleton-img" />
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
  const isLiked = votes[g.url] === 'like';
  const isDisliked = votes[g.url] === 'dislike';
  const [checkingTg, setCheckingTg] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const photoSrc = getProfilePhotoSrc(g.photo_local, g.photo);

  const handleTgClick = async (e) => {
    e.stopPropagation();
    setMenuOpen(false);
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
    <div
      className={`card profile-card ${isLiked ? 'status-like' : isDisliked ? 'status-dislike' : ''}`}
      tabIndex={0}
      role="group"
      aria-label={`Профиль ${g.name}`}
    >
      <div className="photoWrap profile-photo-wrap">
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
        <div className="overlay profile-card-overlay" />
        <div className="profile-card-controls">
          <div className="statusStack">
            {g.matchScore !== undefined && (
              <div
                className={`badge ${g.matchScore > 80 ? 'badge-match-high' : 'badge-match-low'}`}
              >
                🎯 {g.matchScore}%
              </div>
            )}
            {isLiked && <div className="badge likedTag">Лайк</div>}
            {isDisliked && <div className="badge dislikedTag">Скип</div>}
            {g.viewed && <div className="badge viewedTag">Чекалась</div>}
            {g.dmSent && !g.dmError && !g.dm_status && <div className="badge dmTag">Написал</div>}
            {g.dm_status === 'replied' && (
              <div className="badge dmTag" style={{ background: 'hsl(var(--success))' }}>
                ✨ Ответил
              </div>
            )}
            {g.dm_status === 'liked' && <div className="badge likedTag">❤️ Лайкнул</div>}
            {g.dm_status === 'ignored' && <div className="badge ignoredTag">Игнор</div>}
            {g.dm_status === 'drain' && <div className="badge drainTag">Слив</div>}
            {g.tg_status === 'valid' && <div className="badge tgTag">TG</div>}
            {g.tg_status === 'channel' && <div className="badge tgChannelTag">TG канал</div>}
            {g.dmError && (
              <div className="badge tgNotSentTag" title={getDmErrorLabel(g.dmError)}>
                ⚠️ Не написал в тг
              </div>
            )}
          </div>
          <div
            className="profile-card-menu"
            onMouseEnter={() => setMenuOpen(true)}
            onMouseLeave={() => setMenuOpen(false)}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) setMenuOpen(false);
            }}
          >
            <button
              type="button"
              className="profile-card-menu-trigger"
              aria-label="Другие действия"
              aria-expanded={menuOpen}
              title="Другие действия"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <span />
              <span />
              <span />
            </button>
            <div
              className={`profile-card-menu-popover${menuOpen ? ' open' : ''}`}
              aria-hidden={!menuOpen}
            >
              {getTelegramUsername(g) && g.tg_status !== 'invalid' ? (
                <button type="button" onClick={handleTgClick} disabled={checkingTg}>
                  <TelegramIcon />
                  <span>{g.tg_status ? 'Открыть Telegram' : 'Проверить Telegram'}</span>
                  {!g.tg_status && !checkingTg ? <HelpIcon /> : null}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpen(g);
                }}
              >
                <InstagramIcon />
                <span>Открыть Instagram</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onSaveAsDonor(g.url);
                }}
              >
                <SaveIcon />
                <span>Сохранить как донора</span>
              </button>
              <button
                type="button"
                className={`profile-card-menu-tg${g.tgTagged === 1 ? ' active' : ''}`}
                onClick={() => {
                  setMenuOpen(false);
                  onTagTg(g);
                }}
              >
                <TelegramIcon />
                <span>Написал в Telegram</span>
              </button>
              <button
                type="button"
                className="profile-card-menu-danger"
                onClick={() => {
                  setMenuOpen(false);
                  onDeleteProfile(g.url);
                }}
              >
                <TrashIcon />
                <span>Удалить профиль</span>
              </button>
            </div>
          </div>
          <div className="profile-card-bottom">
            <div className="profile-card-identity">
              <strong>{g.name}</strong>
              {g.username && g.username !== g.name ? <span>@{g.username}</span> : null}
            </div>
            <div className="actions profile-card-actions">
              <button
                type="button"
                className="actionBtn send-action"
                onClick={() => onSendDM(g)}
                title="Написать"
              >
                <SendIcon />
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
                className={`actionBtn likeBtn${isLiked ? ' active' : ''}`}
                onClick={() => onVote(g, 'like')}
                title="Лайк"
              >
                <HeartIcon filled={isLiked} />
              </button>
            </div>
          </div>
        </div>
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
  exceptCity,
  setExceptCity,
  matchesProfileCity,
  matchesWordsBlacklist,
}) {
  const filters = usePersistedFilters();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [primaryFiltersOpen, setPrimaryFiltersOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const filtersRef = useRef(null);
  const primaryFiltersRef = useRef(null);

  const resetPage = () => setCurrentPage(1);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (filtersRef.current && !filtersRef.current.contains(event.target)) setFiltersOpen(false);
      if (primaryFiltersRef.current && !primaryFiltersRef.current.contains(event.target)) {
        setPrimaryFiltersOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const uniqueDonors = Array.from(new Set(girls.map((g) => g.donor).filter(Boolean))).sort();

  const filtered = filterProfiles(girls, {
    votes,
    failedImages,
    cityOnly,
    exceptCity,
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
        <div className="profile-primary-filters" ref={primaryFiltersRef}>
          <button
            type="button"
            className="compact-menu-trigger profile-primary-filter-trigger"
            onClick={() => setPrimaryFiltersOpen((open) => !open)}
            aria-expanded={primaryFiltersOpen}
          >
            Поиск и фильтры
          </button>
          <div className={`profile-primary-filter-fields${primaryFiltersOpen ? ' open' : ''}`}>
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
          </div>
        </div>
        <div className="profile-toolbar-meta">
          <span className="count-badge">
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
                    const checked = e.target.checked;
                    setCityOnly(checked);
                    if (checked) setExceptCity(false);
                    resetPage();
                  }}
                />
                Только город
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={exceptCity}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setExceptCity(checked);
                    if (checked) setCityOnly(false);
                    resetPage();
                  }}
                />
                Кроме города
              </label>
            </div>
          )}
          </div>
        </div>
      </div>

      <main className="grid profiles-grid">
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
