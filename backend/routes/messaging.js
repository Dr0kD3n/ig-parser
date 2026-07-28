const db = require('../lib/db');
const https = require('https');
const { startMassMessaging, stopMassMessaging, getMassMessengerStatus } = require('../lib/mass-messenger');
const {
  getFeedbackCheckStatus,
  runFeedbackCheckNow,
  stopFeedbackCheckRun,
} = require('../lib/feedback-check-scheduler');
const ctx = require('../lib/server-context');
const utils = require('../lib/utils');
const { getInstagramActivity } = require('../lib/instagram-activity');
const {
  startTgBatchCheck,
  stopTgBatchCheck,
  getTgBatchStatus,
} = require('../lib/tg-batch-checker');
module.exports = (app) => {
  const { CONFIG, invalidateGirlsCache, broadcastLog } = ctx;
async function checkTelegramProfile(url) {
  const fetchUrl = url.startsWith('http') ? url : `https://t.me/${url}`;
  return new Promise((resolve, reject) => {
    const req = https.get(
      fetchUrl,
      {
        headers: { 'User-Agent': CONFIG.userAgent },
      },
      (res) => {
        // Follow redirects manually if needed for t.me
        if ([301, 302].includes(res.statusCode || 0) && res.headers.location) {
          if (
            res.headers.location.includes('telegram.org') &&
            !res.headers.location.includes('t.me')
          ) {
            return resolve('invalid');
          }
          // Recurse for internal redirects if any
          return checkTelegramProfile(res.headers.location).then(resolve).catch(reject);
        }
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          // Check for profile markers
          // Valid profiles on t.me MUST have a "tgme_page_title"
          const hasTitle = data.includes('tgme_page_title');
          const isMainSite = data.includes('telegram.org') && !data.includes('tgme_page');
          if (isMainSite || !hasTitle) {
            resolve('invalid');
          } else {
            resolve('valid');
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}
app.get('/api/check-telegram', async (req, res) => {
  const url = req.query.url;
  if (!url || typeof url !== 'string')
    return res.status(400).json({ success: false, error: 'Missing or invalid url' });
  console.log(`[TG CHECK] Checking: ${url}`);
  try {
    const status = await checkTelegramProfile(url);
    console.log(`[TG CHECK] Result for ${url}: ${status}`);
    // Update DB
    const database = await db.getDB();
    await database.run(`UPDATE profiles SET tg_status = ? WHERE url = ? OR name = ?`, [
      status,
      url,
      url.replace('https://t.me/', ''),
    ]);
    invalidateGirlsCache();
    res.json({ success: true, status });
  } catch (e) {
    console.error(`[TG CHECK ERROR] ${e.message}`);
    res.status(500).json({ success: false, error: e.message });
  }
});
app.post('/api/check-telegram-batch', async (req, res) => {
  const { urls } = req.body;
  if (!urls || !Array.isArray(urls))
    return res.status(400).json({ success: false, error: 'Invalid urls' });
  console.log(`[TG BATCH CHECK] Starting for ${urls.length} profiles`);
  const results = [];
  const BATCH_SIZE = 10;
  const database = await db.getDB();
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);
    console.log(
      `[TG BATCH CHECK] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(urls.length / BATCH_SIZE)}`
    );
    const batchPromises = batch.map(async (url) => {
      try {
        const status = await checkTelegramProfile(url);
        await database.run(`UPDATE profiles SET tg_status = ? WHERE url = ? OR name = ?`, [
          status,
          url,
          url.replace('https://t.me/', ''),
        ]);
        return { url, status, success: true };
      } catch (e) {
        console.error(`[TG BATCH CHECK ERROR] Failed ${url}: ${e.message}`);
        return { url, success: false, error: e.message };
      }
    });
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    // Small delay between batches to avoid being too aggressive
    if (i + BATCH_SIZE < urls.length) {
      await utils.wait(1000);
    }
  }
  invalidateGirlsCache();
  res.json({ success: true, results });
});

app.post('/api/check-telegram-batch/start', async (req, res) => {
  const profiles = req.body?.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return res.status(400).json({ success: false, error: 'profiles must be a non-empty array' });
  }
  const items = profiles
    .map((profile) => ({
      profileUrl: typeof profile?.profileUrl === 'string' ? profile.profileUrl : '',
      username: typeof profile?.username === 'string' ? profile.username : '',
    }))
    .filter((profile) => profile.username);
  if (items.length === 0) {
    return res.status(400).json({ success: false, error: 'No valid Telegram usernames' });
  }

  const status = await startTgBatchCheck(items, CONFIG.userAgent, invalidateGirlsCache);
  if (status.alreadyRunning) {
    return res.status(409).json({ success: false, ...status });
  }
  res.status(202).json({ success: true, ...status });
});

app.post('/api/check-telegram-batch/stop', (req, res) => {
  res.json({ success: true, ...stopTgBatchCheck() });
});

app.get('/api/check-telegram-batch/status', (req, res) => {
  res.json(getTgBatchStatus());
});

app.post('/api/mass-messages/start', async (req, res) => {
  const activeActivity = getInstagramActivity();
  if (activeActivity) {
    return res.status(409).json({
      success: false,
      error: `Instagram activity already running: ${activeActivity.type}`,
    });
  }
  const options = req.body || {};
  startMassMessaging((status) => {
    if (status.status && status.status !== 'Running') {
      broadcastLog('sender', status.status);
    }
  }, options).catch(e => console.error('Mass messenger crash:', e));
  res.json({ success: true });
});


app.post('/api/mass-messages/stop', (req, res) => {
  stopMassMessaging();
  res.json({ success: true });
});

// Feedback Checker Endpoints
app.post('/api/feedback/start', async (req, res) => {
  const result = await runFeedbackCheckNow();
  if (!result?.started) {
    return res.status(result?.reason === 'busy' || result?.reason === 'already_running' ? 409 : 500).json({
      success: false,
      ...result,
    });
  }
  res.status(202).json({ success: true, ...result });
});

app.get('/api/feedback/status', (req, res) => {
  res.json(getFeedbackCheckStatus());
});

app.post('/api/feedback/stop', (req, res) => {
  stopFeedbackCheckRun();
  res.json({ success: true });
});


app.get('/api/mass-messages/status', (req, res) => {
  res.json(getMassMessengerStatus());
});
};
