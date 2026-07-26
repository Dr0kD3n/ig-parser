const path = require('path');
const http = require('http');
const db = require('../lib/db');
const { extractPrimaryDonor } = require('../lib/donor-category-stats');
const utils = require('../lib/utils');
const config = require('../lib/config');
const browserLib = require('../lib/browser');
const ctx = require('../lib/server-context');
const { instagramWorkerService } = require('../lib/instagram-worker-service');
module.exports = (app, { onClearLogs }) => {
  const { refreshSession, logEmitter, sendMessageToProfile, markDmSentByUsername } = ctx;
app.post('/api/logs/clear', (req, res) => {
  ctx.historicalLogs = [];
  onClearLogs?.();
  res.json({ success: true });
});
app.get('/api/dolphin/profiles', async (req, res) => {
  try {
    const queryToken = req.query.token;
    const database = await db.getDB();

    if (queryToken) {
      await database.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [
        'dolphinToken',
        queryToken,
      ]);
      console.log('🐬 [DOLPHIN] Token updated from request');
    }

    // Локальное API Dolphin Anty работает на порту 3001
    const options = {
      hostname: '127.0.0.1',
      port: 3001,
      path: '/v1.0/browser_profiles',
      method: 'GET',
    };

    console.log('🐬 [DOLPHIN] Fetching profiles from local API...');

    const reqDolphin = http.get(options, (dolphinRes) => {
      let data = '';
      dolphinRes.on('data', (chunk) => (data += chunk));
      dolphinRes.on('end', () => {
        try {
          const json = JSON.parse(data);
          // Локальное API возвращает массив или объект
          const profilesList = json.data || (Array.isArray(json) ? json : []);
          res.json({ success: true, data: profilesList });
        } catch (e) {
          res
            .status(500)
            .json({ success: false, error: 'Failed to parse Dolphin Local API response' });
        }
      });
    });

    reqDolphin.on('error', (e) => {
      console.error('Local Dolphin API Error:', e.message);
      res.status(500).json({
        success: false,
        error: `Local Dolphin API is not running or unreachable: ${e.message}`,
      });
    });
  } catch (e) {
    console.error('Error fetching Dolphin profiles:', e);
    res.status(500).json({ success: false, error: e.message });
  }
});
app.get('/api/logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    logEmitter.off('log', onLog);
  };

  const safeWrite = (payload) => {
    if (closed || res.writableEnded) return;
    try {
      res.write(payload);
    } catch (_) {
      cleanup();
    }
  };

  res.on('error', cleanup);
  req.on('close', cleanup);

  const formatSse = (log) => {
    try {
      return `data: ${JSON.stringify(log)}\n\n`;
    } catch {
      return `data: ${JSON.stringify({ ...log, message: String(log?.message ?? '').slice(0, 2000) })}\n\n`;
    }
  };

  ctx.historicalLogs.forEach((log) => {
    safeWrite(formatSse(log));
  });

  const onLog = (log) => {
    safeWrite(formatSse(log));
  };
  logEmitter.on('log', onLog);
});
app.get('/api/live-view', (req, res) => {
  const liveViewPath = path.join(utils.getRootPath(), 'data', 'screenshots', 'live_view.jpg');
  res.sendFile(liveViewPath, { headers: { 'Cache-Control': 'no-store' } }, (err) => {
    if (err) res.status(404).send('Not generated yet');
  });
});
app.get('/api/bot/status', (req, res) => {
  res.json(instagramWorkerService.getStatus());
});
app.post('/api/bot/start', (req, res) => {
  try {
    const result = instagramWorkerService.start(req.body?.type);
    const { statusCode = 200, ...body } = result;
    res.status(statusCode).json(body);
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

app.post('/api/bot/stop', async (req, res) => {
  try {
    res.json(await instagramWorkerService.stop(req.body?.type));
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
app.post('/api/bot/skip-donor', async (req, res) => {
  res.json(instagramWorkerService.skipDonor());
});
app.post('/api/skip-donor', async (req, res) => {
  res.json(instagramWorkerService.skipDonor());
});
app.post('/api/dm', async (req, res) => {
  const { url, message } = req.body;
  console.log({ url, message });
  let currentContext = null;
  try {
    const accountsData = await config.getAllAccounts('server');
    const firstAccount = accountsData[0] || {};
    const reqConfig = {
      id: firstAccount.id,
      proxy: firstAccount.proxy,
      cookies: firstAccount.cookies,
      fingerprint: firstAccount.fingerprint,
    };

    if (!reqConfig.cookies || reqConfig.cookies.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Выбранный аккаунт не имеет куки. Пожалуйста, авторизуйте его сначала.',
      });
    }

    const showBrowser = await config.isShowBrowserEnabled();
    refreshSession();
    const { browser, context } = await browserLib.createBrowserContext(
      reqConfig,
      !showBrowser
    );
    console.log(
      `📡 [SENDER] Используется прокси: ${reqConfig.proxy ? reqConfig.proxy.server : 'ПРЯМОЕ СОЕДИНЕНИЕ'}`
    );
    console.log(`🍪 [SENDER] Загружено куки: ${reqConfig.cookies.length}`);
    currentContext = context;
    const liveViewInterval = browserLib.startLiveView(context);
    const isSent = await sendMessageToProfile(context, url, message);
    clearInterval(liveViewInterval);
    if (isSent) {
      try {
        const database = await db.getDB();
        const profile = await database.get(`SELECT username, name, donor FROM profiles WHERE url = ?`, [url]);
        const username = profile ? (profile.username || profile.name) : url.split('/').pop();
        const donor = extractPrimaryDonor(profile?.donor);
        await database.run(
          `INSERT INTO messages_log (url, username, message_text, status, timestamp, donor) VALUES (?, ?, ?, ?, ?, ?)`,
          [url, username, message, 'sent', new Date().toISOString(), donor || null]
        );
        await markDmSentByUsername(db, profile?.username || username, { clearError: true, tgTagged: 0 });
      } catch (dbErr) {
        console.error('Ошибка сохранения в messages_log:', dbErr);
      }
      res.json({ success: true, message: 'Отправлено' });
    } else {
      res.json({ success: false, message: 'Не отправлено' });
    }
  } catch (e) {
    console.error('Ошибка запуска:', e);
    res.status(500).json({ success: false });
  } finally {
    if (currentContext) await currentContext.close();
  }
});
app.get('/api/stats', async (req, res) => {
  try {
    const database = await db.getDB();
    const summary = await database.all(`
      SELECT 
        message_text, 
        count(*) as total_sent,
        SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied_count,
        SUM(CASE WHEN status = 'liked' THEN 1 ELSE 0 END) as liked_count
      FROM messages_log 
      GROUP BY message_text
    `);

    const { getDonorMessageStats } = require('../lib/donor-category-stats');
    const donorSummary = await getDonorMessageStats(database);

    const details = await database.get(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
        SUM(CASE WHEN status = 'liked' THEN 1 ELSE 0 END) as liked,
        SUM(CASE WHEN status = 'ignored' THEN 1 ELSE 0 END) as ignored,
        SUM(CASE WHEN status = 'drain' THEN 1 ELSE 0 END) as drain,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent
      FROM messages_log
    `);

    res.json({ success: true, summary, donorSummary, details });
  } catch (err) {
    console.error('Ошибка получения статистики:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

const HISTORY_SORT_COLUMNS = {
  timestamp: 'timestamp',
  username: 'username',
  donor: 'donor',
  message_text: 'message_text',
  status: 'status',
};

app.get('/api/stats/messages', async (req, res) => {
  try {
    const database = await db.getDB();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const sortKey = HISTORY_SORT_COLUMNS[req.query.sort] || 'timestamp';
    const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    const offset = (page - 1) * limit;

    const totalRow = await database.get(`SELECT COUNT(*) AS total FROM messages_log`);
    const total = totalRow?.total || 0;

    const records = await database.all(
      `SELECT * FROM messages_log ORDER BY ${sortKey} ${dir} LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.json({
      success: true,
      records,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error('Ошибка получения истории сообщений:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

const MANUAL_DM_STATUSES = new Set(['replied', 'liked', 'ignored', 'drain']);

app.patch('/api/stats/messages/:id', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!MANUAL_DM_STATUSES.has(status)) {
      return res.status(400).json({ success: false, error: 'Недопустимый статус' });
    }

    const database = await db.getDB();
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ success: false, error: 'Некорректный id' });
    }

    const existing = await database.get(`SELECT * FROM messages_log WHERE id = ?`, [id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Запись не найдена' });
    }

    await database.run(
      `UPDATE messages_log SET status = ?, status_manual = 1 WHERE id = ?`,
      [status, id]
    );

    if (existing.url) {
      await database.run(`UPDATE profiles SET dm_status = ? WHERE url = ?`, [status, existing.url]);
    }

    const record = await database.get(`SELECT * FROM messages_log WHERE id = ?`, [id]);
    res.json({ success: true, record });
  } catch (err) {
    console.error('Ошибка обновления статуса:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});

app.get('/api/stats/likes-by-category', async (req, res) => {
  try {
    const database = await db.getDB();
    const { getLikesByCategory } = require('../lib/donor-category-stats');
    const rows = await getLikesByCategory(database);
    res.json({ success: true, rows });
  } catch (err) {
    console.error('Ошибка статистики лайков по категориям:', err);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
});
};
