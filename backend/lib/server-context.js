const path = require('path');
const browser = require('./browser');
const utils = require('./utils');
const db = require('./db');
const reporter = require('./reporter');
const { encrypt, decrypt, encryptSafe } = require('./encryption');
const { markDmSentByUsername } = require('./profile-dedup');
const events = require('events');

const CONFIG = {
  timeouts: {
    pageLoad: 60000,
    element: 5000,
    typingDelayMin: 50,
    typingDelayMax: 180,
  },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  selectors: {
    directMessageBtn: [
      // RU
      'button:has-text("Написать")',
      'div[role="button"]:has-text("Написать")',
      'a:has-text("Написать")',
      'button:has-text("Отправить сообщение")',
      'div[role="button"]:has-text("Отправить сообщение")',
      'div[role="button"]:has-text("Сообщение")',
      // EN
      'div[role="button"]:has-text("Message")',
      'button:has-text("Message")',
      'div[role="button"]:has-text("Send Message")',
    ],
    optionsBtn: [
      'svg[aria-label="Параметры"]',
      'svg[aria-label="Options"]',
      'svg[aria-label="More options"]',
      'div[role="button"] > svg',
    ],
    menuMessageBtn: [
      'div[role="dialog"] button:has-text("Отправить сообщение")',
      'div[role="dialog"] button:has-text("Написать")',
      'div[role="dialog"] button:has-text("Send message")',
    ],
    chatInput: 'div[role="textbox"][contenteditable="true"], div[aria-label="Message"], div[aria-label="Напишите сообщение..."], [aria-label="Message"], [aria-label="Напишите сообщение..."]',
    notNowBtn: ['button:has-text("Не сейчас")', 'button:has-text("Not Now")'],
    messageRow: 'div[role="row"], div[role="listitem"]',
  },
};;

async function getSettings() {
  const database = await db.getDB();
  const rows = await database.all(`SELECT * FROM accounts`);
  const accounts = rows.map((r) => ({
    id: r.id,
    name: r.name,
    proxy: decrypt(r.proxy),
    cookies: decrypt(r.cookies),
    fingerprint: r.fingerprint,
    warmup_score: r.warmup_score,
    last_warmup: r.last_warmup,
    warmup_progress: r.warmup_progress || 0,
    warmup_running: !!r.warmup_running,
  }));
  const activeParserIds = rows
    .filter((r) => r.active_parser)
    .sort((a, b) => a.active_parser - b.active_parser)
    .map((r) => r.id);
  const activeServerIds = rows
    .filter((r) => r.active_server)
    .sort((a, b) => a.active_server - b.active_server)
    .map((r) => r.id);
  const activeIndexIds = rows
    .filter((r) => r.active_index)
    .sort((a, b) => a.active_index - b.active_index)
    .map((r) => r.id);
  const activeProfilesIds = rows
    .filter((r) => r.active_profiles)
    .sort((a, b) => a.active_profiles - b.active_profiles)
    .map((r) => r.id);
  const activeCheckerIds = rows
    .filter((r) => r.active_checker)
    .sort((a, b) => a.active_checker - b.active_checker)
    .map((r) => r.id);
  const showBrowserStr = await database.get(`SELECT value FROM settings WHERE key = 'showBrowser'`);
  const showBrowser = showBrowserStr ? showBrowserStr.value === 'true' : false;
  const concurrentProfilesStr = await database.get(`SELECT value FROM settings WHERE key = 'concurrentProfiles'`);
  const concurrentProfiles = concurrentProfilesStr ? parseInt(concurrentProfilesStr.value) : 3;
  const dmLimitStr = await database.get(`SELECT value FROM settings WHERE key = 'dmLimit'`);
  const dmLimit = dmLimitStr ? parseInt(dmLimitStr.value) : 20;
  const humanEmulationStr = await database.get(`SELECT value FROM settings WHERE key = 'humanEmulation'`);
  const humanEmulation = humanEmulationStr ? humanEmulationStr.value === 'true' : false;
  const dolphinTokenStr = await database.get(`SELECT value FROM settings WHERE key = 'dolphinToken'`);
  const dolphinToken = dolphinTokenStr ? dolphinTokenStr.value : '';
  const donorGroupsStr = await database.get(`SELECT value FROM settings WHERE key = 'donorGroups'`);
  const donorGroups = donorGroupsStr ? JSON.parse(donorGroupsStr.value) : [];

  return {
    accounts,
    activeParserAccountIds: activeParserIds,
    activeServerAccountIds: activeServerIds,
    activeIndexAccountIds: activeIndexIds,
    activeProfilesAccountIds: activeProfilesIds,
    activeCheckerAccountIds: activeCheckerIds,
    showBrowser,
    concurrentProfiles,
    dmLimit,
    humanEmulation,
    dolphinToken,
    donorGroups,
  };
}

let girlsCache = null;
let girlsCacheTime = 0;
const CACHE_TTL = 1000;

async function getGirlsCached() {
  const now = Date.now();
  if (girlsCache && now - girlsCacheTime < CACHE_TTL) return girlsCache;
  try {
    const database = await db.getDB();
    girlsCache = await database.all(`
            SELECT p.*,
                   d.name as donor_name,
                   d.bio as donor_bio,
                   d.followers_count as donor_followers_count,
                   d.posts_count as donor_posts_count,
                   d.photo as donor_photo,
                   d.photo_local as donor_photo_local,
                   d.photo_status as donor_photo_status
            FROM profiles p
            LEFT JOIN donors d ON p.donor = d.username
            ORDER BY p.timestamp DESC
        `);
    girlsCacheTime = now;
  } catch (e) {
    girlsCache = [];
  }
  return girlsCache;
}

function invalidateGirlsCache() {
  girlsCache = null;
  girlsCacheTime = 0;
}

const botProcesses = { index: null, parser: null, checker: null };
let currentSessionId = Date.now().toString();
function refreshSession() {
  currentSessionId = Date.now().toString();
}

const logEmitter = new events.EventEmitter();
logEmitter.setMaxListeners(100);
let historicalLogs = [];

function debouncedSaveLogs(saveFn) {
  if (debouncedSaveLogs._timer) return;
  debouncedSaveLogs._timer = setTimeout(() => {
    debouncedSaveLogs._timer = null;
    saveFn();
  }, 10000);
}

function broadcastLog(source, message, stripAnsiFn = utils.stripAnsi) {
  let text;
  try {
    text = stripAnsiFn(message).trim();
  } catch {
    text = String(message ?? '').trim();
  }
  const logEntry = {
    timestamp: new Date().toISOString(),
    source,
    message: text,
    sessionId: currentSessionId,
  };
  historicalLogs.push(logEntry);
  if (historicalLogs.length > 1000) historicalLogs.shift();
  try {
    logEmitter.emit('log', logEntry);
  } catch (e) {
    console.error('[LOG] emit error:', e.message);
  }
  return logEntry;
}

const warmupStatus = new Map();
const instagramCooldownStatus = new Map();
let restorePhotosStatus = { running: false, current: 0, total: 0, status: '' };

function getSelectorString(key) {
  const val = CONFIG.selectors[key];
  return Array.isArray(val) ? val.join(',') : val;
};
// ==========================================
// MAIN LOGIC
// ==========================================
const sendMessageToProfile = async (context, url, message) => {
  const page = await context.newPage();
  console.log(`\n📨 [SENDER] Начало обработки: ${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeouts.pageLoad });
    await browser.takeLiveScreenshot(page);
    await utils.wait(2000);
    let accessButton = null;
    const directBtnSelector = getSelectorString('directMessageBtn');
    const directBtn = page.locator(directBtnSelector).first();
    try {
      await directBtn.waitFor({ state: 'visible', timeout: 5000 });
      if (await directBtn.isVisible()) {
        console.log('✅ Кнопка "Написать" (или аналог) найдена в профиле.');
        accessButton = directBtn;
      }
    } catch (e) { }
    if (!accessButton) {
      console.log('⚠️ Прямая кнопка не найдена. Проверяем "3 точки"...');
      const optionsBtn = page.locator(getSelectorString('optionsBtn')).first();
      if (await optionsBtn.isVisible()) {
        await optionsBtn.click();
        await utils.wait(1500);
        const menuMsgBtn = page.locator(getSelectorString('menuMessageBtn')).first();
        try {
          await menuMsgBtn.waitFor({ state: 'visible', timeout: 3000 });
          console.log('✅ Кнопка "Написать" найдена в меню.');
          accessButton = menuMsgBtn;
        } catch (e) {
          console.log('❌ В меню нет пункта отправки сообщения.');
        }
      }
    }
    if (!accessButton) {
      console.log(`⛔ [SKIP] Кнопки нет. Делаю скриншот...`);
      await page.screenshot({
        path: path.join(utils.getRootPath(), 'data', 'logs', 'debug_screenshot.png'),
        fullPage: true,
      });
      return false;
    }
    await accessButton.click();
    await browser.takeLiveScreenshot(page);
    try {
      // 1. Wait for ANY of the possible gates to the chat
      await Promise.race([
        page.waitForSelector(CONFIG.selectors.chatInput, { state: 'visible', timeout: 30000 }),
        page.waitForSelector(getSelectorString('notNowBtn'), { state: 'visible', timeout: 30000 }),
        page.waitForSelector('text="Send message", text="Отправить сообщение", text="Сообщение"', { state: 'visible', timeout: 30000 })
      ]);

      // 2. Handle "Not Now" if it appears
      const notNowBtn = page.locator(getSelectorString('notNowBtn')).first();
      if (await notNowBtn.isVisible()) {
        await notNowBtn.click();
        await utils.wait(2000);
      }

      // 3. Final wait for the actual input textbox
      await page.waitForSelector(CONFIG.selectors.chatInput, { state: 'visible', timeout: 15000 });
    } catch (e) {
      console.log('❌ Тайм-аут: чат не открылся или поле ввода не найдено.');
      return false;
    }
    const chatInput = page.locator(CONFIG.selectors.chatInput).first();
    if (!(await chatInput.isVisible())) {
      console.log('❌ Поле ввода не найдено (ЛС закрыто).');
      return false;
    }
    console.log('🔍 Проверка истории переписки...');
    await utils.wait(2500);
    const allRows = await page.locator(getSelectorString('messageRow')).all();
    let realMessageCount = 0;
    for (const row of allRows) {
      const text = await row.innerText();
      if (
        text.includes('Смотреть профиль') ||
        text.includes('View profile') ||
        text.includes('View Profile') ||
        text.includes('Аккаунт в Instagram') ||
        text.trim() === ''
      ) {
        continue;
      }
      realMessageCount++;
    }
    if (realMessageCount > 0) {
      console.log(
        `⛔ [SKIP] Уже есть переписка (${realMessageCount} реальных сообщений). Закрываем.`
      );
      return false;
    }
    console.log('✅ История чиста (баннер проигнорирован). Отправляем сообщение.');
    await utils.humanType(page, CONFIG.selectors.chatInput, message, CONFIG.timeouts);
    await utils.wait(1000);
    await page.keyboard.press('Enter');
    await utils.waitAfterEvent();
    await browser.takeLiveScreenshot(page);
    console.log(`🚀 [SENT] Сообщение отправлено: ${url}`);
    await utils.wait(3000);
    return true;
  } catch (error) {
    console.error(`💥 Ошибка: ${error.message}`);
    await reporter.saveCrashReport(page, error, 'sender');
    return false;
  } finally {
    await page.close();
  }
};

module.exports = {
  CONFIG,
  getSettings,
  getGirlsCached,
  invalidateGirlsCache,
  botProcesses,
  refreshSession,
  logEmitter,
  get historicalLogs() { return historicalLogs; },
  set historicalLogs(v) { historicalLogs = v; },
  debouncedSaveLogs,
  broadcastLog,
  warmupStatus,
  instagramCooldownStatus,
  get restorePhotosStatus() { return restorePhotosStatus; },
  set restorePhotosStatus(v) { restorePhotosStatus = v; },
  sendMessageToProfile,
  encrypt,
  decrypt,
  encryptSafe,
  markDmSentByUsername,
  restorePhotos: require('./photo-restorer').restorePhotos,
  stopRestorePhotos: require('./photo-restorer').stopRestorePhotos,
};
