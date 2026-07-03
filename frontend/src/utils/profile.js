import { normalizeKeyword } from './text';

export const createCityMatcher = (cities = [], citiesBlacklist = []) => {
  const whitelist = cities.map(normalizeKeyword).filter(Boolean);
  const blacklist = citiesBlacklist.map(normalizeKeyword).filter(Boolean);

  return (profile) => {
    const text = normalizeKeyword(
      `${profile?.name || ''} ${profile?.bio || ''} ${profile?.username || ''}`
    );
    const matchesWhitelist = whitelist.length === 0 || whitelist.some((kw) => text.includes(kw));
    const matchesBlacklist = blacklist.length > 0 && blacklist.some((kw) => text.includes(kw));
    return matchesWhitelist && !matchesBlacklist;
  };
};

export const createWordsBlacklistMatcher = (wordsBlacklist = []) => {
  const blacklist = wordsBlacklist.map(normalizeKeyword).filter(Boolean);
  return (profile) => {
    if (blacklist.length === 0) return false;
    const text = normalizeKeyword(
      `${profile?.name || ''} ${profile?.bio || ''} ${profile?.username || ''}`
    );
    return blacklist.some((kw) => text.includes(kw));
  };
};

/** IG username для проверки Telegram (без @, не display name) */
export function getTelegramUsername(profile) {
  const fromField = String(profile?.username || '')
    .replace(/^@/, '')
    .trim();
  if (fromField) return fromField;
  const match = String(profile?.url || '').match(/instagram\.com\/([^/?#]+)/i);
  const slug = match?.[1]?.toLowerCase();
  const skip = new Set(['p', 'reel', 'reels', 'stories', 'direct', 'explore', 'accounts']);
  return slug && !skip.has(slug) ? slug : '';
}

export function getTelegramUrl(profile) {
  const u = getTelegramUsername(profile);
  return u ? `https://t.me/${u}` : '';
}

/** TG найден (личка или канал) */
export function hasTelegram(status) {
  return status === 'valid' || status === 'channel';
}

export function parseSmartBio(text, username) {
  if (!text) return { bio: ' ', stats: [] };

  let clean = text.replace(new RegExp(`^${username}\\s*`, 'i'), '').replace(/\|/g, ' ');

  const stats = [];
  const followersMatch = clean.match(/(\d[\d\s]*\s*подписчиков)/i);
  const postsMatch = clean.match(/(\d[\d\s]*\s*публикаций)/i);
  if (followersMatch) stats.push(followersMatch[0]);
  if (postsMatch) stats.push(postsMatch[0]);

  let bio = clean
    .replace(/(\d[\d\s]*\s*(подписчиков|публикаций|подписок|посты))/gi, '')
    .replace(/more\s*\|\s*\w+/gi, '')
    .replace(/\.\.\.\s*more\s*\w*/gi, '')
    .replace(new RegExp(`${username}$`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim();

  const segments = bio.split(/[.!?]\s+/);
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

export function getProfilePhotoSrc(localPhoto, remotePhoto) {
  if (localPhoto) return localPhoto;
  if (!remotePhoto) return '';
  return `https://images.weserv.nl/?url=${encodeURIComponent(remotePhoto)}`;
}

/** Текст ошибки DM для tooltip */
export const DM_ERROR_LABELS = {
  history: 'Есть история переписки',
  no_button: 'Личка закрыта или кнопка не найдена',
  no_textbox: 'Поле ввода не найдено (баг IG)',
  error: 'Ошибка при отправке',
};

export const getDmErrorLabel = (dmError) => {
  const key = dmError === 'chat_exists' ? 'history' : dmError || 'error';
  return DM_ERROR_LABELS[key] || DM_ERROR_LABELS.error;
};
