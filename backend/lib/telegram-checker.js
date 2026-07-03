'use strict';

const https = require('https');

const DEFAULT_TG_LOGO = /telegram\.org\/img\/t_logo/i;

/** IG/TG username без @ и без URL */
function normalizeTelegramUsername(input) {
  if (!input) return '';
  let s = String(input).trim();
  s = s.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '');
  s = s.replace(/^@/, '').split(/[/?#]/)[0].trim();
  return s.toLowerCase();
}

function extractMeta(html, property) {
  const re = new RegExp(`<meta\\s+property="${property}"\\s+content="([^"]*)"`, 'i');
  const m = html.match(re);
  return m ? m[1] : '';
}

/**
 * Разбор HTML t.me:
 * - valid   — пользователь с реальным профилем
 * - channel — канал / группа (subscribers, View @)
 * - invalid — не найден, редирект на web.telegram.org, страница-призрак
 */
function parseTelegramPage(html, username, finalUrl = '') {
  if (finalUrl.includes('web.telegram.org') && !finalUrl.includes('t.me')) {
    return 'invalid';
  }

  const ogTitle = extractMeta(html, 'og:title');
  const ogImage = extractMeta(html, 'og:image');
  const titleTag = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';

  if (!html.includes('tgme_page') && !ogTitle) {
    return 'invalid';
  }

  // Страница-призрак: Contact @username + дефолтная аватарка Telegram
  if (/^Telegram:\s*Contact\s@/i.test(ogTitle)) return 'invalid';
  if (DEFAULT_TG_LOGO.test(ogImage)) return 'invalid';
  if (/noindex,\s*nofollow/i.test(html) && /Contact\s@/i.test(ogTitle || titleTag)) {
    return 'invalid';
  }

  // Канал / публичная группа
  if (/\bsubscribers\b/i.test(html) || /Telegram:\s*View\s@/i.test(titleTag)) {
    return 'channel';
  }

  // Реальный пользователь: og:title — display name, не шаблон Telegram
  if (ogTitle && !/^Telegram:/i.test(ogTitle) && !DEFAULT_TG_LOGO.test(ogImage)) {
    return 'valid';
  }

  return 'invalid';
}

function fetchTelegramPage(username, userAgent, maxRedirects = 5) {
  const handle = normalizeTelegramUsername(username);
  if (!handle) return Promise.reject(new Error('Empty username'));

  return new Promise((resolve, reject) => {
    const visit = (url, redirectsLeft) => {
      const req = https.get(url, { headers: { 'User-Agent': userAgent } }, (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;

        if ([301, 302, 303, 307, 308].includes(status) && location) {
          if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
          const next = location.startsWith('http') ? location : new URL(location, url).href;
          if (next.includes('web.telegram.org') && !next.includes('t.me')) {
            res.resume();
            return resolve({ html: '', finalUrl: next, status: 'invalid' });
          }
          res.resume();
          return visit(next, redirectsLeft - 1);
        }

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            html: data,
            finalUrl: url,
            status: parseTelegramPage(data, handle, url),
          });
        });
      });

      req.on('error', reject);
      req.setTimeout(20000, () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
    };

    visit(`https://t.me/${handle}`, maxRedirects);
  });
}

async function checkTelegramProfile(username, userAgent) {
  const { status } = await fetchTelegramPage(username, userAgent);
  return status;
}

module.exports = {
  normalizeTelegramUsername,
  parseTelegramPage,
  fetchTelegramPage,
  checkTelegramProfile,
};
