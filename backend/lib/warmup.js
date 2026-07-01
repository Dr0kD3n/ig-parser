const { createBrowserContext } = require('./browser');
const { getDB } = require('./db');
const {
  wait,
  humanClick,
  humanHover,
  humanMouseMove,
  humanMove,
  humanScroll,
  humanMouseLeave,
  humanOverscroll,
  humanSelection,
  parseProxyString,
  asyncPool,
  pickRandom,
} = require('./utils');
const http = require('http');
const { decrypt } = require('./encryption');
const IG = require('./ig-selectors');
const {
  CLICK_OPTS,
  closeOverlays,
  clickGoHome,
  performIdleAction,
  waitWithActivity,
  createMessengerSession,
} = require('./anti-fraud');

const GLOBAL_SITES = [
  'https://www.google.com',
  'https://www.youtube.com',
  'https://www.facebook.com',
  'https://www.wikipedia.org',
  'https://www.amazon.com',
  'https://www.reddit.com',
  'https://www.twitter.com',
  'https://www.linkedin.com',
  'https://www.netflix.com',
  'https://www.bing.com',
  'https://www.yahoo.com',
  'https://www.pinterest.com',
  'https://www.tiktok.com',
  'https://www.twitch.tv',
  'https://www.tumblr.com',
  'https://www.quora.com',
  'https://www.medium.com',
  'https://www.bbc.com',
  'https://www.reuters.com',
  'https://www.theguardian.com',
  'https://www.forbes.com',
  'https://www.bloomberg.com',
  'https://www.wired.com',
  'https://www.techcrunch.com',
  'https://www.theverge.com',
  'https://www.nationalgeographic.com',
  'https://www.history.com',
  'https://www.ebay.com',
  'https://www.etsy.com',
  'https://www.walmart.com',
  'https://www.target.com',
  'https://www.bestbuy.com',
  'https://www.ikea.com',
  'https://www.booking.com',
  'https://www.airbnb.com',
  'https://www.tripadvisor.com',
  'https://www.expedia.com',
  'https://www.zillow.com',
  'https://www.imdb.com',
  'https://www.rottentomatoes.com',
  'https://www.github.com',
  'https://www.stackoverflow.com',
  'https://www.discord.com',
  'https://www.zoom.us',
  'https://www.slack.com',
  'https://www.microsoft.com',
  'https://www.apple.com',
  'https://www.adobe.com',
  'https://www.dropbox.com',
  'https://www.spotify.com',
  'https://www.twitch.tv',
];

const REGIONAL_SITES = {
  RU: [
    'https://www.yandex.ru',
    'https://www.vk.com',
    'https://www.ok.ru',
    'https://www.mail.ru',
    'https://www.avito.ru',
    'https://www.wildberries.ru',
    'https://www.ozon.ru',
    'https://www.rbc.ru',
    'https://www.lenta.ru',
    'https://www.rambler.ru',
    'https://www.dns-shop.ru',
    'https://www.mvideo.ru',
    'https://www.gosuslugi.ru',
    'https://www.hh.ru',
    'https://www.kinopoisk.ru',
    'https://www.pikabu.ru',
    'https://www.sports.ru',
    'https://www.habr.com',
    'https://www.vc.ru',
    'https://www.auto.ru',
    'https://www.championat.com',
    'https://www.gismeteo.ru',
    'https://www.ria.ru',
    'https://www.tass.ru',
    'https://www.gazeta.ru',
    'https://www.kommersant.ru',
    'https://www.forbes.ru',
    'https://www.drom.ru',
    'https://www.cian.ru',
    'https://www.domofond.ru',
    'https://www.banki.ru',
    'https://www.sberbank.ru',
    'https://www.tinkoff.ru',
    'https://www.ivi.ru',
    'https://www.okko.tv',
    'https://www.megafon.ru',
    'https://www.mts.ru',
    'https://www.beeline.ru',
    'https://www.tele2.ru',
    'https://www.eldorado.ru',
    'https://www.citilink.ru',
    'https://www.lamoda.ru',
    'https://www.kupivip.ru',
    'https://www.superjob.ru',
    'https://www.yaplakal.com',
  ],
  FR: [
    'https://www.lemonde.fr',
    'https://www.orange.fr',
    'https://www.leboncoin.fr',
    'https://www.allocine.fr',
    'https://www.fnac.com',
    'https://www.cdiscount.com',
    'https://www.lequipe.fr',
    'https://www.caf.fr',
    'https://www.ameli.fr',
    'https://www.doctissimo.fr',
    'https://www.lefigaro.fr',
    'https://www.darty.com',
  ],
  DE: [
    'https://www.spiegel.de',
    'https://www.bild.de',
    'https://www.web.de',
    'https://www.ebay.de',
    'https://www.mobile.de',
    'https://www.t-online.de',
    'https://www.focus.de',
    'https://www.chip.de',
    'https://www.welt.de',
    'https://www.dhl.de',
    'https://www.otto.de',
    'https://www.adac.de',
  ],
  ES: [
    'https://www.elmundo.es',
    'https://www.elpais.com',
    'https://www.marca.com',
    'https://www.as.com',
    'https://www.wallapop.com',
    'https://www.milanuncios.com',
    'https://www.rtve.es',
    'https://www.abc.es',
    'https://www.idealista.com',
    'https://www.pccomponentes.com',
    'https://www.elcorteingles.es',
  ],
  US: [
    'https://www.cnn.com',
    'https://www.nytimes.com',
    'https://www.walmart.com',
    'https://www.target.com',
    'https://www.homedepot.com',
    'https://www.craigslist.org',
    'https://www.bestbuy.com',
    'https://www.zillow.com',
    'https://www.foxnews.com',
    'https://www.ebay.com',
    'https://www.etsy.com',
    'https://www.chase.com',
  ],
};

async function getRegionFromProxy(proxy) {
  if (!proxy || !proxy.server) return 'GLOBAL';

  console.log(`🌍 [WARMUP] Detecting region for proxy: ${proxy.server}`);

  return new Promise((resolve) => {
    const url = new URL(proxy.server);
    const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');

    const options = {
      host: url.hostname,
      port: url.port || 80,
      path: 'http://ip-api.com/json',
      headers: {
        Host: 'ip-api.com',
        'Proxy-Authorization': `Basic ${auth}`,
      },
    };

    const req = http.get(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log(`🌍 [WARMUP] Proxy region detected: ${json.countryCode} (${json.country})`);
          resolve(json.countryCode);
        } catch (e) {
          resolve('GLOBAL');
        }
      });
    });

    req.on('error', () => resolve('GLOBAL'));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve('GLOBAL');
    });
  });
}

async function getNumericSetting(db, key, fallback, min = 1) {
  const row = await db.get(`SELECT value FROM settings WHERE key = ?`, [key]).catch(() => null);
  const value = parseInt(row?.value, 10);
  return Number.isFinite(value) ? Math.max(min, value) : fallback;
}

async function startWarmup(accountId, progressCallback = (p) => { }) {
  console.log(`🔥 [WARMUP] Starting for account: ${accountId}`);

  const db = await getDB();
  const acc = await db.get('SELECT * FROM accounts WHERE id = ?', [accountId]);
  if (!acc) throw new Error('Account not found');

  const config = {
    id: accountId,
    proxy: parseProxyString(acc.proxy),
    fingerprint: acc.fingerprint ? JSON.parse(acc.fingerprint) : null,
    cookies: acc.cookies ? JSON.parse(acc.cookies) : null,
    local_storage: acc.local_storage,
  };

  const countryCode = await getRegionFromProxy(config.proxy);
  const regionalSites = REGIONAL_SITES[countryCode] || [];

  const showBrowserRow = await db.get(`SELECT value FROM settings WHERE key = 'showBrowser'`);
  const showBrowser = showBrowserRow?.value === 'true';
  const headless = !showBrowser;


  let sitePool = [...GLOBAL_SITES];
  if (regionalSites.length > 0) {
    sitePool = [...sitePool, ...regionalSites, ...regionalSites];
  }

  const warmupSitesLimit = await getNumericSetting(db, 'warmupSitesLimit', 40);
  const warmupConcurrency = await getNumericSetting(db, 'warmupConcurrency', 12);
  const sitesToVisit = sitePool.sort(() => Math.random() - 0.5).slice(0, warmupSitesLimit);


  const { browser, context } = await createBrowserContext(
    {
      ...config,
      countryCode,
      fingerprint: {
        ...(config.fingerprint || {}),
        locale: 'en-US',
        extraHTTPHeaders: {
          ...(config.fingerprint?.extraHTTPHeaders || {}),
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
    },
    headless
  );

  try {
    let completed = 0;
    await db.run('UPDATE accounts SET warmup_running = 1, warmup_progress = 0 WHERE id = ?', [
      accountId,
    ]);

    await asyncPool(sitesToVisit, warmupConcurrency, async (currentSite) => {

      const page = await context.newPage();
      try {
        console.log(`🔥 [WARMUP] Visiting [${countryCode}]: ${currentSite}`);
        await page.goto(currentSite, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const applyCookieConsent = async () => {
          try {
            const cookieButtons = [
              'Accept', 'Allow', 'Agree', 'I accept', 'Accept all', 'Allow all', 'I agree', 'Accept cookies', 'Accept everything',
              'Принять', 'Согласен', 'Разрешить', 'Принять все', 'ОК', 'OK', 'OK, accept', 'Принять куки', 'Да, согласен',
              'Aceptar', 'Permitir', 'Acepto', 'Aceptar todo', 'Aceptar cookies',
              'Accepter', 'Autoriser', 'J\'accepte', 'Tout accepter', 'Accepter les cookies',
              'Annehmen', 'Zustimmen', 'Akzeptieren', 'Alle akzeptieren', 'Cookies akzeptieren', 'Save settings'
            ];

            const commonSelectors = [
              '#onetrust-accept-btn-handler', '#cookie-accept', '.cookie-accept', '.accept-cookies', '#accept-all-cookies',
              'button[id*="accept" i]', 'button[class*="accept" i]', 'button[id*="cookie" i]', 'button[class*="cookie" i]'
            ];

            const tryAccept = async (frame) => {
              for (const selector of commonSelectors) {
                const handle = await frame.$(selector).catch(() => null);
                if (handle && (await handle.isVisible())) {
                  await humanClick(page, handle, { timeout: 2000 }).catch(() => { });
                  console.log(`🍪 [WARMUP] Clicked selector in frame: "${selector}" on ${currentSite}`);
                  return true;
                }
              }
              for (const text of cookieButtons) {
                const handle = await frame.$(`button:has-text("${text}"), a:has-text("${text}"), [role="button"]:has-text("${text}")`).catch(() => null);
                if (handle && (await handle.isVisible())) {
                  await humanClick(page, handle, { timeout: 2000 }).catch(() => { });
                  console.log(`🍪 [WARMUP] Clicked button in frame: "${text}" on ${currentSite}`);
                  return true;
                }
              }
              return false;
            };

            if (await tryAccept(page)) return true;
            const frames = page.frames();
            for (const frame of frames) {
              if (frame === page.mainFrame()) continue;
              if (await tryAccept(frame)) return true;
            }
          } catch (e) { }
          return false;
        };

        const matched = await applyCookieConsent();

        if (!matched) {
          await wait(1500);
          if (Math.random() > 0.3) await applyCookieConsent();
        }

        await wait(Math.random() * 2000 + 1000);

        if (Math.random() > 0.4) {
          const scrollAmount = Math.random() * 600 + 400;
          await page.mouse.wheel(0, scrollAmount);
          await wait(Math.random() * 1000);
        }


        if (Math.random() > 0.6) await humanSelection(page);
        if (Math.random() > 0.7) await humanMouseLeave(page);

        if (Math.random() > 0.4) {
          const links = await page.$$('a');
          const validLinks = [];
          for (const link of links) {
            const href = await link.getAttribute('href');
            if (href && (href.startsWith('/') || href.includes(new URL(currentSite).hostname))) {
              if (await link.isVisible()) validLinks.push(link);
            }
          }
          if (validLinks.length > 0) {
            const randomLink = pickRandom(validLinks);
            console.log(`🔗 [WARMUP] Navigating deeper into ${currentSite}`);
            await humanClick(page, randomLink, { timeout: 3000 }).catch(() => { });
            await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => { });
            await wait(Math.random() * 4000 + 3000);
          }
        }
      } catch (e) {
        console.warn(`⚠️ [WARMUP] Failed site ${currentSite}: ${e.message}`);
      } finally {
        await page.close();
        completed++;
        const currentProgress = Math.round((completed / sitesToVisit.length) * 100);
        await db.all('UPDATE accounts SET warmup_progress = ? WHERE id = ?', [
          currentProgress,
          accountId,
        ]);
        progressCallback({ current: completed, total: sitesToVisit.length, site: currentSite });
      }
    });

    const cookies = await context.cookies();
    const lastPage = await context.newPage();
    let localStorage = '{}';
    try {
      await lastPage.goto('https://www.google.com', {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });
      localStorage = await lastPage.evaluate(() => {
        const data = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          data[key] = window.localStorage.getItem(key);
        }
        return JSON.stringify(data);
      });
    } catch (e) {
      console.warn(`⚠️ [WARMUP] Could not collect localStorage: ${e.message}`);
    }

    const warmupScore = Math.round((completed / sitesToVisit.length) * 100);
    const lastWarmup = new Date().toISOString();

    await db.run(
      'UPDATE accounts SET cookies = ?, local_storage = ?, warmup_score = ?, last_warmup = ?, warmup_running = 0, warmup_progress = 0 WHERE id = ?',
      [JSON.stringify(cookies), localStorage, warmupScore, lastWarmup, accountId]
    );

    console.log(`✅ [WARMUP] Completed for ${accountId} (${countryCode})`);
    return { success: true };
  } catch (error) {
    console.error(`❌ [WARMUP] Error: ${error.message}`);
    await db
      .run('UPDATE accounts SET warmup_running = 0 WHERE id = ?', [accountId])
      .catch(() => { });
    return { success: false, error: error.message };
  } finally {
    await context.close();
    await browser.close();
  }
}

async function startInstagramCooldown(accountId, progressCallback = (p) => { }) {
  console.log(`🔥 [WARMUP] Starting for account: ${accountId}`);

  const db = await getDB();
  const acc = await db.get('SELECT * FROM accounts WHERE id = ?', [accountId]);
  if (!acc) throw new Error('Account not found');

  const safeDecrypt = (value) => {
    if (!value) return '';
    try {
      return decrypt(value);
    } catch {
      return value;
    }
  };

  const parseJsonSafe = (value, fallback) => {
    if (!value) return fallback;
    try {
      return JSON.parse(safeDecrypt(value));
    } catch {
      return fallback;
    }
  };

  const parseInstagramCookies = (value) => {
    const raw = safeDecrypt(value);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch { }

    const cookies = [];
    const names = [
      'csrftoken',
      'datr',
      'ds_user_id',
      'ig_did',
      'mid',
      'sessionid',
      'rur',
      'wd',
      'ig_nrcb',
    ];

    for (const name of names) {
      const regex = new RegExp(`(?:^|\\s|;|:)${name}(?:\\s*[:=]\\s*|\\s+)([^;\\n\\r]+)`, 'i');
      const match = raw.match(regex);
      if (!match?.[1]) continue;

      let cookieValue = match[1].trim();
      if (cookieValue.includes('.instagram.com')) cookieValue = cookieValue.split('.instagram.com')[0].trim();
      if (cookieValue.includes(' ')) cookieValue = cookieValue.split(' ')[0].trim();
      if (!cookieValue) continue;

      cookies.push({
        name,
        value: cookieValue,
        domain: '.instagram.com',
        path: '/',
        secure: true,
        sameSite: 'None',
      });
    }

    return cookies.length > 0 ? cookies : null;
  };

  const config = {
    id: accountId,
    proxy: parseProxyString(safeDecrypt(acc.proxy)),
    fingerprint: acc.fingerprint ? JSON.parse(acc.fingerprint) : null,
    cookies: parseInstagramCookies(acc.cookies),
    local_storage: acc.local_storage,
  };

  const countryCode = await getRegionFromProxy(config.proxy);

  const showBrowserRow = await db.get(`SELECT value FROM settings WHERE key = 'showBrowser'`);
  const showBrowser = showBrowserRow?.value === 'true';
  const headless = !showBrowser;

  const { browser, context } = await createBrowserContext(
    {
      ...config,
      countryCode,
      fingerprint: {
        ...(config.fingerprint || {}),
        locale: 'en-US',
        extraHTTPHeaders: {
          ...(config.fingerprint?.extraHTTPHeaders || {}),
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
    },
    headless
  );

  const warmupPlan = [
    'home_feed',
    'home_feed',
    'explore',
    'post_open',
    'profile_visit',
    'notifications',
    'reels',
    'profile_visit',
    'post_open',
    'search',
    'home_feed',
    'explore',
  ].sort(() => Math.random() - 0.5);

  const reportProgress = async (completed, total, action) => {
    const currentProgress = Math.round((completed / total) * 100);
    await db.run('UPDATE accounts SET warmup_progress = ? WHERE id = ?', [
      currentProgress,
      accountId,
    ]);
    progressCallback({ current: completed, total, site: action, progress: currentProgress });
  };

  const moveAround = async (page) => {
    const viewport = page.viewportSize();
    if (!viewport) return;
    const x = 80 + Math.random() * Math.max(120, viewport.width - 160);
    const y = 80 + Math.random() * Math.max(120, viewport.height - 160);
    await humanMove(page, x, y).catch(() => { });
    if (Math.random() < 0.35) {
      await humanMouseMove(
        page,
        x + (Math.random() - 0.5) * 140,
        y + (Math.random() - 0.5) * 100
      ).catch(() => { });
    }
  };

  const saveInstagramStorage = async (page) => {
    const cookies = await context.cookies();
    let localStorage = '{}';
    try {
      localStorage = await page.evaluate(() => {
        const data = {};
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          data[key] = window.localStorage.getItem(key);
        }
        return JSON.stringify(data);
      });
    } catch (e) {
      console.warn(`⚠️ [WARMUP] Could not collect Instagram localStorage: ${e.message}`);
    }
    return { cookies, localStorage };
  };

  const dismissInstagramPopups = async (page) => {
    const buttons = [
      'button:has-text("Not Now")',
      'button:has-text("Не сейчас")',
      'button:has-text("Allow all cookies")',
      'button:has-text("Разрешить все cookie")',
      'button:has-text("Accept")',
      'button:has-text("Принять")',
    ];
    for (const selector of buttons) {
      const btn = page.locator(selector).first();
      if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
        await humanClick(page, btn, CLICK_OPTS).catch(() => { });
        await wait(500 + Math.random() * 500);
      }
    }
  };

  const collectVisibleProfileLinks = async (page) => {
    const links = await page.locator('main a[href^="/"]:not([href*="/p/"]):not([href*="/reel/"]):not([href*="/stories/"])').all();
    const result = [];
    for (const link of links.slice(0, 40)) {
      const href = await link.getAttribute('href').catch(() => '');
      if (!href || !/^\/[^/]+\/?$/.test(href)) continue;
      if (await link.isVisible().catch(() => false)) result.push(link);
    }
    return result;
  };

  const openRandomPost = async (page) => {
    const posts = await page.locator('main a[href*="/p/"], main a[href*="/reel/"]').all();
    if (posts.length === 0) {
      await humanScroll(page, null, 'down', 500 + Math.random() * 600).catch(() => { });
      await waitWithActivity(page, 1200 + Math.random() * 1200);
      return;
    }

    const post = pickRandom(posts.slice(0, Math.min(posts.length, 12)));
    if (!(await post.isVisible().catch(() => false))) return;
    await humanHover(page, post).catch(() => { });
    await wait(300 + Math.random() * 500);
    await humanClick(page, post, CLICK_OPTS).catch(() => { });
    await waitWithActivity(page, 1800 + Math.random() * 2200);

    if (Math.random() < 0.45) {
      await humanScroll(page, null, 'down', 120 + Math.random() * 260).catch(() => { });
      await wait(500 + Math.random() * 700);
    }

    const closeBtn = await IG.findFirstVisible(page, IG.POST_CLOSE);
    if (closeBtn) {
      await humanClick(page, await IG.resolveClickable(closeBtn), CLICK_OPTS).catch(() => { });
    } else {
      await page.keyboard.press('Escape').catch(() => { });
    }
    await wait(500 + Math.random() * 700);
  };

  const browseHomeFeed = async (page, session) => {
    console.log('🔥 [WARMUP] Instagram: главная лента');
    await clickGoHome(page, session);
    for (let i = 0; i < 4 + Math.floor(Math.random() * 4); i++) {
      await moveAround(page);
      await performIdleAction(page);
      if (Math.random() < 0.22) await openRandomPost(page);
      if (Math.random() < 0.18) await humanSelection(page).catch(() => { });
      await humanScroll(page, null, Math.random() < 0.86 ? 'down' : 'up', 280 + Math.random() * 620).catch(() => { });
      await waitWithActivity(page, 900 + Math.random() * 1800);
    }
  };

  const browseExplore = async (page) => {
    console.log('🔥 [WARMUP] Instagram: explore');
    const clicked = await IG.clickFirst(page, IG.EXPLORE_NAV, humanClick, CLICK_OPTS).catch(() => false);
    if (!clicked) {
      await clickGoHome(page, { allowGotoFallback: false }).catch(() => { });
      return;
    }
    await waitWithActivity(page, 1800 + Math.random() * 1800);
    for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
      await moveAround(page);
      if (Math.random() < 0.55) await openRandomPost(page);
      await humanScroll(page, null, 'down', 450 + Math.random() * 700).catch(() => { });
      await waitWithActivity(page, 1100 + Math.random() * 1800);
    }
  };

  const browseReels = async (page) => {
    console.log('🔥 [WARMUP] Instagram: reels');
    const clicked = await IG.clickFirst(page, IG.REELS_NAV, humanClick, CLICK_OPTS).catch(() => false);
    if (!clicked) {
      await clickGoHome(page, { allowGotoFallback: false }).catch(() => { });
      return;
    }
    await waitWithActivity(page, 2000 + Math.random() * 2500);
    for (let i = 0; i < 3 + Math.floor(Math.random() * 4); i++) {
      await moveAround(page);
      await page.keyboard.press(Math.random() < 0.8 ? 'ArrowDown' : 'Space').catch(() => { });
      await wait(120 + Math.random() * 220);
      if (Math.random() < 0.2) await page.keyboard.press('Space').catch(() => { });
      await waitWithActivity(page, 1700 + Math.random() * 2600);
    }
  };

  const visitProfile = async (page, session) => {
    console.log('🔥 [WARMUP] Instagram: профиль из ленты');
    await clickGoHome(page, session);
    await waitWithActivity(page, 1000 + Math.random() * 1000);
    const links = await collectVisibleProfileLinks(page);
    if (links.length === 0) {
      await humanScroll(page, null, 'down', 700 + Math.random() * 700).catch(() => { });
      return;
    }

    const link = pickRandom(links);
    await humanHover(page, link).catch(() => { });
    await wait(250 + Math.random() * 450);
    await humanClick(page, link, CLICK_OPTS).catch(() => { });
    await page.waitForSelector('header', { timeout: 12000 }).catch(() => { });
    await waitWithActivity(page, 1400 + Math.random() * 1800);

    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      await moveAround(page);
      if (Math.random() < 0.35) await openRandomPost(page);
      await humanScroll(page, null, Math.random() < 0.72 ? 'down' : 'up', 260 + Math.random() * 480).catch(() => { });
      await waitWithActivity(page, 800 + Math.random() * 1400);
    }
  };

  const useSearch = async (page, session) => {
    console.log('🔥 [WARMUP] Instagram: поиск');
    const queries = ['travel', 'food', 'fitness', 'design', 'music', 'cars', 'art', 'nature'];
    await clickGoHome(page, session);
    const searchInput = await IG.findFirstVisible(page, IG.SEARCH_INPUT) || page.locator(IG.SEARCH_INPUT).first();
    if ((await searchInput.count()) === 0) {
      await IG.clickFirst(page, IG.SEARCH_NAV, humanClick, CLICK_OPTS).catch(() => false);
      await wait(700 + Math.random() * 600);
    }

    const input = await IG.findFirstVisible(page, IG.SEARCH_INPUT);
    if (!input) return;

    await humanClick(page, input, CLICK_OPTS).catch(() => { });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => { });
    await page.keyboard.type(pickRandom(queries), { delay: 70 + Math.random() * 80 }).catch(() => { });
    await waitWithActivity(page, 1800 + Math.random() * 1800);

    const links = await collectVisibleProfileLinks(page);
    if (links.length > 0 && Math.random() < 0.65) {
      await humanClick(page, pickRandom(links.slice(0, 8)), CLICK_OPTS).catch(() => { });
      await page.waitForSelector('header', { timeout: 12000 }).catch(() => { });
      await waitWithActivity(page, 2200 + Math.random() * 2200);
    }

    await closeOverlays(page);
  };

  const openNotifications = async (page) => {
    console.log('🔥 [WARMUP] Instagram: уведомления');
    const clicked = await IG.clickFirst(page, IG.NOTIFICATIONS_NAV, humanClick, CLICK_OPTS).catch(() => false);
    if (!clicked) return;
    await waitWithActivity(page, 1800 + Math.random() * 2200);
    await humanScroll(page, null, 'down', 180 + Math.random() * 260).catch(() => { });
    await waitWithActivity(page, 900 + Math.random() * 1200);
    await closeOverlays(page);
  };

  const runAction = async (page, action, session) => {
    await dismissInstagramPopups(page);
    if (action === 'home_feed') return browseHomeFeed(page, session);
    if (action === 'explore') return browseExplore(page);
    if (action === 'reels') return browseReels(page);
    if (action === 'profile_visit') return visitProfile(page, session);
    if (action === 'post_open') return openRandomPost(page);
    if (action === 'search') return useSearch(page, session);
    if (action === 'notifications') return openNotifications(page);
  };

  try {
    let completed = 0;
    await db.run('UPDATE accounts SET warmup_running = 1, warmup_progress = 0 WHERE id = ?', [
      accountId,
    ]);

    const page = await context.newPage();
    const session = createMessengerSession();
    session.allowGotoFallback = false;
    try {
      await page.goto('https://www.instagram.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await dismissInstagramPopups(page);
      await waitWithActivity(page, 2500 + Math.random() * 2500);

      for (const action of warmupPlan) {
        try {
          await runAction(page, action, session);
        } catch (e) {
          console.warn(`⚠️ [WARMUP] Instagram action failed (${action}): ${e.message}`);
          await closeOverlays(page).catch(() => { });
        } finally {
          completed++;
          await reportProgress(completed, warmupPlan.length, action);
        }
      }

      if (Math.random() < 0.5) await humanMouseLeave(page).catch(() => { });
      await waitWithActivity(page, 2000 + Math.random() * 3000);
    } finally {
      const { cookies, localStorage } = await saveInstagramStorage(page);
      const warmupScore = Math.round((completed / warmupPlan.length) * 100);
      const lastWarmup = new Date().toISOString();

      await db.run(
        'UPDATE accounts SET cookies = ?, local_storage = ?, warmup_score = ?, last_warmup = ?, warmup_running = 0, warmup_progress = 0 WHERE id = ?',
        [JSON.stringify(cookies), localStorage, warmupScore, lastWarmup, accountId]
      );

      await page.close().catch(() => { });
    }

    console.log(`✅ [WARMUP] Completed for ${accountId} (${countryCode})`);
    return { success: true };
  } catch (error) {
    console.error(`❌ [WARMUP] Error: ${error.message}`);
    await db
      .run('UPDATE accounts SET warmup_running = 0 WHERE id = ?', [accountId])
      .catch(() => { });
    return { success: false, error: error.message };
  } finally {
    await context.close();
    await browser.close();
  }
}

exports.startWarmup = startWarmup;
exports.startInstagramCooldown = startInstagramCooldown;
