/** Хелперы E2E против реального dist/ig-bot.exe */

const fs = require('fs');
const { DIST_DIR, DIST_EXE, PROJECT_ROOT } = require('./dist-paths');

const BACKEND_URL = process.env.E2E_BACKEND_URL || `http://127.0.0.1:${process.env.E2E_PORT || '5000'}`;
const PROFILES_TARGET = Number(process.env.E2E_PROFILES_TARGET || 5);
const MIN_DONORS_ADDED = Number(process.env.E2E_MIN_DONORS || 1);

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function assertDistExists() {
  if (!fs.existsSync(DIST_EXE)) {
    throw new Error(
      `dist/ig-bot.exe не найден: ${DIST_EXE}\n` +
        `Ожидается: ${DIST_DIR}\n` +
        'Собери: build.bat, затем dist\\install.bat'
    );
  }
}

async function apiGet(request, urlPath, token) {
  const res = await request.get(`${BACKEND_URL}${urlPath}`, { headers: authHeaders(token) });
  if (!res.ok()) throw new Error(`GET ${urlPath} → ${res.status()}: ${await res.text()}`);
  return res.json();
}

async function apiPost(request, urlPath, token, body = {}) {
  const res = await request.post(`${BACKEND_URL}${urlPath}`, {
    headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
    data: body,
  });
  if (!res.ok()) throw new Error(`POST ${urlPath} → ${res.status()}: ${await res.text()}`);
  return res.json();
}

async function login(page) {
  await page.goto('/');

  const emailInput = page.locator('input[type="email"]');
  const needsLogin = await emailInput.isVisible({ timeout: 15000 }).catch(() => false);

  if (needsLogin) {
    const email = process.env.E2E_EMAIL || 'admin@igbot.com';
    const password = process.env.E2E_PASSWORD || 'admin123';
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    await page.click(
      'button:has-text("INITIALIZE SESSION"), button:has-text("Войти"), button:has-text("Sign in")'
    );
    await page.waitForSelector('.header, nav .tab-btn', { timeout: 30000 });
  } else {
    await page.waitForSelector('.header, nav .tab-btn', { timeout: 30000 });
  }

  const token = await page.evaluate(() => localStorage.getItem('ig_token'));
  if (!token || token === 'null') {
    throw new Error('Не удалось получить ig_token после логина. Задай E2E_EMAIL / E2E_PASSWORD.');
  }
  return token;
}

function hasCookies(cookies) {
  if (cookies == null) return false;
  if (Array.isArray(cookies)) return cookies.length > 0;
  if (typeof cookies === 'string') {
    const raw = cookies.trim();
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.length > 0;
      if (parsed && typeof parsed === 'object') return Object.keys(parsed).length > 0;
    } catch (_) {
      /* сырая строка cookies — ок */
    }
    return raw.length > 0;
  }
  return false;
}

function accountInRoleList(accountId, roleIds) {
  const id = String(accountId);
  return (roleIds || []).some((rid) => String(rid) === id);
}

async function requireConfiguredAccounts(request, token) {
  const settings = await apiGet(request, '/api/settings', token);
  const accounts = settings.accounts || [];

  const pick = (roleIds) =>
    accounts.filter((a) => accountInRoleList(a.id, roleIds) && hasCookies(a.cookies));

  const parserAccs = pick(settings.activeParserAccountIds);
  const indexAccs = pick(settings.activeIndexAccountIds);
  const serverAccs = pick(settings.activeServerAccountIds);

  const missing = [];
  if (!parserAccs.length) missing.push('active_parser + cookies');
  if (!indexAccs.length) missing.push('active_index + cookies');
  if (!serverAccs.length) missing.push('active_server + cookies');

  if (missing.length) {
    const debug =
      process.env.E2E_DEBUG === '1'
        ? `\nDebug: accounts=${accounts.length}, parserIds=${JSON.stringify(settings.activeParserAccountIds)}, indexIds=${JSON.stringify(settings.activeIndexAccountIds)}, serverIds=${JSON.stringify(settings.activeServerAccountIds)}`
        : '';
    throw new Error(
      `В dist/config не настроены аккаунты для E2E: ${missing.join(', ')}. ` +
        'Назначь роли Parser / Index / Sender в настройках dist и авторизуй аккаунты.' +
        debug
    );
  }
}

async function getProfiles(request, token) {
  return apiGet(request, '/api/girls', token);
}

async function getDonorsCount(request, token) {
  const settings = await apiGet(request, '/api/settings', token);
  return (settings.donors || []).length;
}

async function startBot(request, token, type) {
  return apiPost(request, '/api/bot/start', token, { type });
}

async function stopBot(request, token, type) {
  return apiPost(request, '/api/bot/stop', token, { type });
}

async function waitForBotRunning(request, token, type, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await apiGet(request, '/api/bot/status', token);
    if (status[type]) return true;
    await sleep(500);
  }
  throw new Error(`Бот "${type}" не запустился за ${timeoutMs / 1000}с`);
}

function formatProfileLog(p, idx, total) {
  const uname = p.username ? `@${p.username}` : '—';
  const donor = p.donor ? ` донор:${p.donor}` : '';
  return `  [${idx}/${total}] ${p.name || '?'} (${uname})${donor} — ${p.url}`;
}

async function waitForProfilesDelta(request, token, baseline, delta, timeoutMs, baselineUrls = null) {
  const known = baselineUrls instanceof Set ? baselineUrls : new Set(baselineUrls || []);
  const seenNew = new Set();
  const startedAt = Date.now();
  let poll = 0;
  const target = baseline + delta;

  console.log(`  ждём +${delta} профилей (было ${baseline}, цель ${target})…`);

  while (Date.now() - startedAt < timeoutMs) {
    poll++;
    const profiles = await getProfiles(request, token);

    for (const p of profiles) {
      if (known.has(p.url) || seenNew.has(p.url)) continue;
      seenNew.add(p.url);
      console.log(formatProfileLog(p, seenNew.size, delta));
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    if (profiles.length >= target) {
      console.log(`  ✓ профилей в базе: ${profiles.length} (+${seenNew.size} новых), ${elapsed}с`);
      return profiles;
    }

    let botHint = '';
    try {
      const bot = await apiGet(request, '/api/bot/status', token);
      botHint = `, index=${bot.index ? 'run' : 'stop'}`;
    } catch (_) {}

    console.log(
      `  … poll #${poll}: ${profiles.length}/${target} всего, новых ${seenNew.size}/${delta}, ${elapsed}с${botHint}`
    );
    await sleep(5000);
  }

  const profiles = await getProfiles(request, token);
  throw new Error(
    `Ожидали +${delta} профилей (было ${baseline}, стало ${profiles.length}, новых ${seenNew.size}) за ${timeoutMs / 1000}с`
  );
}

async function waitForDonorsDelta(request, token, baseline, delta, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const count = await getDonorsCount(request, token);
    if (count >= baseline + delta) return count;
    await sleep(5000);
  }
  const count = await getDonorsCount(request, token);
  throw new Error(
    `Ожидали +${delta} доноров (было ${baseline}, стало ${count}) за ${timeoutMs / 1000}с`
  );
}

async function requireSenderAccount(request, token) {
  const settings = await apiGet(request, '/api/settings', token);
  const accounts = settings.accounts || [];
  const serverAccs = accounts.filter(
    (a) => accountInRoleList(a.id, settings.activeServerAccountIds) && hasCookies(a.cookies)
  );
  if (!serverAccs.length) {
    throw new Error(
      'Нет sender-аккаунта (active_server + cookies). Назначь роль «Сендер» и авторизуй аккаунт в dist.'
    );
  }
  console.log(`Sender: ${serverAccs[0].name} (${serverAccs[0].id})`);
  return serverAccs[0];
}

async function getVotes(request, token) {
  return apiGet(request, '/api/votes', token);
}

async function voteProfile(request, token, url, status) {
  await apiPost(request, '/api/vote', token, { url, status });
}

/** Цель рассылки (лайк, без dmSent) + контрольный профиль (не лайк) */
async function prepareMassDmTargets(request, token) {
  const profiles = await getProfiles(request, token);
  const votes = await getVotes(request, token);

  let target =
    profiles.find((p) => !p.dmSent && votes[p.url] === 'like') ||
    profiles.find((p) => !p.dmSent && !votes[p.url]);

  if (!target) {
    throw new Error('Нет профилей без dmSent для теста рассылки');
  }

  if (votes[target.url] !== 'like') {
    await voteProfile(request, token, target.url, 'like');
    votes[target.url] = 'like';
    console.log(`Лайкнули цель: ${target.name} (@${target.username || '?'})`);
  }

  let control = profiles.find(
    (p) => p.url !== target.url && !p.dmSent && votes[p.url] !== 'like'
  );
  if (!control) {
    control = profiles.find((p) => p.url !== target.url && !p.dmSent);
  }
  if (control && votes[control.url] !== 'dislike') {
    await voteProfile(request, token, control.url, 'dislike');
    console.log(`Контроль (дизлайк): ${control.name} (@${control.username || '?'})`);
  }

  return { target, control, profiles };
}

async function waitForMassMessagingDone(request, token, timeoutMs) {
  const startedAt = Date.now();
  let sawRunning = false;
  let poll = 0;

  console.log(`  ждём завершения массовой рассылки (до ${timeoutMs / 1000}с)…`);

  while (Date.now() - startedAt < timeoutMs) {
    poll++;
    const res = await request.get(`${BACKEND_URL}/api/mass-messages/status`, {
      headers: authHeaders(token),
    });
    const status = await res.json();
    const elapsed = Math.round((Date.now() - startedAt) / 1000);

    if (status.running) sawRunning = true;

    if (poll === 1 || status.running || poll % 10 === 0) {
      console.log(
        `  … mass poll #${poll}: ${status.status || '?'} ${status.current || 0}/${status.total || '?'}, ${elapsed}с`
      );
    }

    if (sawRunning && !status.running) {
      console.log(`  ✓ рассылка завершена: ${status.status}, sent ${status.current}/${status.total}, ${elapsed}с`);
      return status;
    }
    if (!status.running && status.status === 'Done') {
      console.log(`  ✓ рассылка Done, ${elapsed}с`);
      return status;
    }

    await sleep(1000);
  }

  throw new Error(`Массовая рассылка не завершилась за ${timeoutMs / 1000}с`);
}

async function setDmLimit(request, token, limit) {
  await apiPost(request, '/api/settings', token, { dmLimit: limit });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Сброс фильтров + обновление списка профилей в UI */
async function gotoProfilesFresh(page) {
  await page.evaluate(() => {
    localStorage.setItem('ig_filter_text', '');
    localStorage.setItem('ig_filter_status', 'all');
    localStorage.setItem('ig_filter_tg', 'all');
    localStorage.setItem('ig_filter_donor', 'all');
    localStorage.setItem('ig_hide_no_img', 'false');
    localStorage.setItem('ig_hide_viewed', 'false');
    localStorage.setItem('ig_city_only', 'false');
    localStorage.setItem('ig_except_city', 'false');
    localStorage.setItem('ig_followers_min', '');
    localStorage.setItem('ig_followers_max', '');
  });

  await page.click('button:has-text("Профили"), button:has-text("Profiles")');

  const refreshBtn = page.locator('nav .nav-extra-actions button[title="Обновить"]');
  const girlsPromise = page.waitForResponse(
    (r) => r.url().includes('/api/girls') && r.request().method() === 'GET',
    { timeout: 60000 }
  );
  await refreshBtn.click();
  await girlsPromise;

  await page.locator('select.select-input').first().selectOption('all');
  await page.locator('input.search-input').fill('');
  await sleep(300);
}

/** Найти карточку профиля через поиск (имя/username из API) */
async function locateProfileCard(page, profile, timeoutMs = 30000) {
  const searchInput = page.locator('input.search-input');
  // UI фильтрует только по g.name, не по username
  const query =
    (profile.name && profile.name.split(/\s+/)[0]) ||
    profile.username ||
    profile.url.split('/').filter(Boolean).pop();

  await searchInput.fill('');
  await sleep(200);
  await searchInput.fill(query);
  await sleep(400);

  let card = page.locator('.card');
  if (profile.username) {
    card = card.filter({ hasText: `@${profile.username}` });
  } else if (profile.name) {
    card = card.filter({ hasText: profile.name });
  }

  await card.first().waitFor({ state: 'visible', timeout: timeoutMs });
  return card.first();
}

module.exports = {
  BACKEND_URL,
  PROJECT_ROOT,
  DIST_DIR,
  DIST_EXE,
  PROFILES_TARGET,
  MIN_DONORS_ADDED,
  assertDistExists,
  login,
  requireConfiguredAccounts,
  requireSenderAccount,
  getProfiles,
  getVotes,
  voteProfile,
  prepareMassDmTargets,
  getDonorsCount,
  startBot,
  stopBot,
  waitForBotRunning,
  waitForProfilesDelta,
  waitForDonorsDelta,
  waitForMassMessagingDone,
  setDmLimit,
  apiGet,
  gotoProfilesFresh,
  locateProfileCard,
};
