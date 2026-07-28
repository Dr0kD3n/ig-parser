'use strict';

const CYRILLIC_TO_LATIN = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ы: 'y', э: 'e', ю: 'yu', я: 'ya', ь: '', ъ: '',
};

const NICHE_ALIASES = new Map([
  ['кастом', ['custom']],
  ['тату', ['tattoo']],
  ['бьюти', ['beauty']],
  ['нейл', ['nail', 'nails']],
  ['ногти', ['nail', 'nails']],
  ['брови', ['brow', 'brows']],
  ['ресницы', ['lash', 'lashes']],
]);

/**
 * Нормализует текст для строгого сопоставления слов и фраз.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('ru')
    .replace(/[^a-zа-яё0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function transliterate(value) {
  return [...normalizeSearchText(value)]
    .map((char) => CYRILLIC_TO_LATIN[char] ?? char)
    .join('');
}

function splitAliases(value) {
  return String(value || '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
}

function containsPhrase(text, phrase) {
  const normalizedText = ` ${normalizeSearchText(text)} `;
  const normalizedPhrase = normalizeSearchText(phrase);
  if (!normalizedPhrase) return false;
  return normalizedText.includes(` ${normalizedPhrase} `);
}

function keywordAliases(keyword, type) {
  const explicitAliases = splitAliases(keyword);
  const aliases = new Set(explicitAliases);

  for (const alias of explicitAliases) {
    aliases.add(transliterate(alias));
    if (type === 'niche') {
      for (const token of normalizeSearchText(alias).split(' ')) {
        for (const knownAlias of NICHE_ALIASES.get(token) || []) aliases.add(knownAlias);
      }
    }
  }

  return [...aliases].filter(Boolean);
}

function matchesKeyword(text, keyword, type) {
  return keywordAliases(keyword, type).some((alias) =>
    containsPhrase(text, alias) || containsPhrase(transliterate(text), alias)
  );
}

function findBlacklistMatch(text, criteria) {
  const city = (criteria.cityBlacklist || [])
    .find((item) => matchesKeyword(text, item, 'city'));
  if (city) return `city-blacklist:${city}`;

  const word = (criteria.wordsBlacklist || [])
    .find((item) => matchesKeyword(text, item, 'niche'));
  return word ? `word-blacklist:${word}` : '';
}

/**
 * Поднимает вероятно релевантных кандидатов вверх до дорогой загрузки bio.
 * Blacklist в данных выдачи позволяет безопасно не загружать профиль.
 * @param {object[]} candidates
 * @param {object} criteria
 * @returns {object[]}
 */
function rankDonorCandidates(candidates, criteria) {
  return (candidates || [])
    .map((candidate, index) => {
      const text = [candidate?.username, candidate?.fullName].filter(Boolean).join(' ');
      if (findBlacklistMatch(text, criteria)) return null;

      const cityMatch = matchesKeyword(text, criteria.city, 'city');
      const nicheMatch = matchesKeyword(text, criteria.niche, 'niche');
      const score = (cityMatch ? 4 : 0) + (nicheMatch ? 4 : 0) +
        (cityMatch && nicheMatch ? 4 : 0);
      return { candidate, index, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ candidate }) => candidate);
}

/**
 * Проверяет профиль по фактическим данным, а не по позиции в выдаче Instagram.
 * Город и ниша обязательны. Blacklist имеет приоритет.
 * Для ручных синонимов поддерживается формат настройки: `кастом|custom`.
 * @param {object} profile
 * @param {object} criteria
 * @returns {{accepted: boolean, reason: string}}
 */
function evaluateDonor(profile, criteria) {
  const searchableText = [
    profile?.username,
    profile?.fullName,
    profile?.biography,
    profile?.category,
  ].filter(Boolean).join(' ');

  if (!searchableText.trim()) return { accepted: false, reason: 'profile-data-empty' };

  const blacklistMatch = findBlacklistMatch(searchableText, criteria);
  if (blacklistMatch) return { accepted: false, reason: blacklistMatch };

  if (!matchesKeyword(searchableText, criteria.city, 'city')) {
    return { accepted: false, reason: 'city-not-confirmed' };
  }
  if (!matchesKeyword(searchableText, criteria.niche, 'niche')) {
    return { accepted: false, reason: 'niche-not-confirmed' };
  }

  return { accepted: true, reason: 'city-and-niche-confirmed' };
}

module.exports = {
  evaluateDonor,
  normalizeSearchText,
  rankDonorCandidates,
  splitAliases,
};
