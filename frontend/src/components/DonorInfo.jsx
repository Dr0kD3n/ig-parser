import { getProfilePhotoSrc } from '../utils/profile';

function formatDonorSearchMeta({ city, keyword, niche }) {
  const cityStr = String(city || '').trim();
  const kw = String(keyword || '').trim() || String(niche || '').trim();
  if (cityStr && kw) return `${cityStr} · ${kw}`;
  return cityStr || kw || '';
}

export default function DonorInfo({
  donor,
  donorName,
  donorPhoto,
  donorPhotoLocal,
  donorBio,
  donorFollowersCount,
  donorPostsCount,
  city,
  keyword,
  niche,
  variant = 'profile',
}) {
  if (!donor) return null;

  const photoSrc = getProfilePhotoSrc(donorPhotoLocal, donorPhoto);
  const searchMeta = formatDonorSearchMeta({ city, keyword, niche });

  return (
    <div className={`donor-info${variant === 'stats' ? ' donor-info-stats' : ''}`}>
      {variant === 'profile' ? (
        <>
          <span className="donor-label">донор:</span>
          <a href={`https://instagram.com/${donor}`} target="_blank" rel="noopener noreferrer"><span className="donor-value">@{donor}</span></a>
        </>
      ) : (
        <div className="donor-stats-main">
          <a href={`https://instagram.com/${donor}`} target="_blank" rel="noopener noreferrer"><span className="donor-value">@{donor}</span></a>
          {searchMeta ? <span className="donor-stats-meta"> · {searchMeta}</span> : null}
        </div>
      )}
      <div className="donor-popover">
        <div className="donor-popover-header">
          {photoSrc && <img src={photoSrc} className="donor-popover-img" alt="" />}
          <div>
            <div className="donor-popover-name">{donorName || donor}</div>
            <div className="donor-popover-username">@{donor}</div>
          </div>
        </div>
        {searchMeta ? <div className="donor-popover-search">{searchMeta}</div> : null}
        <div className="donor-popover-stats">
          {donorFollowersCount > 0 && (
            <span>👥 {donorFollowersCount.toLocaleString()}</span>
          )}
          {donorPostsCount > 0 && (
            <span>📸 {donorPostsCount.toLocaleString()}</span>
          )}
        </div>
        {donorBio ? <div className="donor-popover-bio">{donorBio}</div> : null}
      </div>
    </div>
  );
}
