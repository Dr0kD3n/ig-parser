const fs = require('fs');
const path = require('path');
const http = require('http');
const child_process = require('child_process');
const db = require('../lib/db');
const utils = require('../lib/utils');
const config = require('../lib/config');
const browser = require('../lib/browser');
const ctx = require('../lib/server-context');
module.exports = (app, { onClearLogs }) => {
  const { botProcesses, refreshSession, broadcastLog, logEmitter, sendMessageToProfile, markDmSentByUsername } = ctx;
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
  // res.flushHeaders(); // Not available in some Express versions without compression middleware
  // Send historical logs first
  ctx.historicalLogs.forEach((log) => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  });
  const onLog = (log) => {
    res.write(`data: ${JSON.stringify(log)}\n\n`);
  };
  logEmitter.on('log', onLog);
  req.on('close', () => {
    logEmitter.off('log', onLog);
  });
});
app.get('/api/live-view', (req, res) => {
  const liveViewPath = path.join(utils.getRootPath(), 'data', 'screenshots', 'live_view.jpg');
  res.sendFile(liveViewPath, { headers: { 'Cache-Control': 'no-store' } }, (err) => {
    if (err) res.status(404).send('Not generated yet');
  });
});
app.get('/api/bot/status', (req, res) => {
  res.json({
    index: !!botProcesses.index,
    parser: !!botProcesses.parser,
    checker: !!botProcesses.checker,
  });
});
app.post('/api/bot/start', (req, res) => {
  const { type } = req.body;
  if (!['index', 'parser', 'checker'].includes(type)) {
    return res.status(400).json({ success: false, error: 'Invalid bot type' });
  }
  if (botProcesses[type]) {
    return res.json({ success: false, error: 'Bot already running' });
  }
  refreshSession();
  const isPkg = process['pkg'] !== undefined;
  const scriptExt = 'js';
  const scriptPath = path.join(__dirname, `${type}.${scriptExt}`);
  if (!fs.existsSync(scriptPath)) {
    return res
      .status(404)
      .json({ success: false, error: `Script for ${type} not found at ${scriptPath}` });
  }
  const runner = isPkg ? process.execPath : 'node';
  const args = isPkg ? [scriptPath] : [scriptPath];
  const cwdPath = isPkg ? path.dirname(process.execPath) : __dirname;
  const child = child_process.spawn(runner, args, {
    cwd: cwdPath,
    env: { ...process.env, FORCE_COLOR: '1' },
    shell: false,
  });
  botProcesses[type] = child;
  // Обработка ошибки запуска самого процесса
  child.on('error', (err) => {
    broadcastLog(`${type}-error`, `Failed to start process: ${err.message}`);
    botProcesses[type] = null;
  });
  child.stdout?.on('data', (data) => broadcastLog(type, data));
  child.stderr?.on('data', (data) => broadcastLog(`${type}-error`, data));
  child.on('close', (code) => {
    broadcastLog('system', `${type} bot exited with code ${code}`);
    botProcesses[type] = null;
  });
  res.json({ success: true });
});
app.post('/api/bot/stop', (req, res) => {
  const { type } = req.body;
  const child = botProcesses[type];
  if (child) {
    let finished = false;
    const timeout = setTimeout(() => {
      if (!finished) {
        finished = true;
        if (botProcesses[type] === child) {
          botProcesses[type] = null;
        }
        if (!res.headersSent) {
          res.json({ success: true, message: 'Stop timeout' });
        }
      }
    }, 5000);

    child.once('close', () => {
      if (!finished) {
        finished = true;
        clearTimeout(timeout);
        if (!res.headersSent) {
          res.json({ success: true });
        }
      }
    });

    if (process.platform === 'win32') {
      child_process.exec(`taskkill /F /T /PID ${child.pid}`, (err) => {
        if (err) {
          console.error(`[SYSTEM] Error killing process ${child.pid}:`, err);
          child.kill();
        }
      });
    } else {
      child.kill();
    }
  } else {
    res.json({ success: false, error: 'Bot not running' });
  }
});
app.post('/api/skip-donor', async (req, res) => {
  try {
    console.log('📢 [API] Получен запрос на пропуск текущего донора...');
    fs.writeFileSync(path.join(utils.getRootPath(), 'data', 'skip_donor.flag'), 'skip');
    res.json({ success: true, message: 'Сигнал пропуска донора отправлен' });
  } catch (e) {
    console.error('❌ [API] Ошибка при создании skip_donor.flag:', e);
    res.json({ success: false, error: 'Ошибка при отправке сигнала' });
  }
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

    const showBrowser = await config.getSetting('showBrowser');
    refreshSession();
    const { browser, context } = await browser.createBrowserContext(
      reqConfig,
      !(showBrowser === 'true' || showBrowser === true)
    );
    console.log(
      `📡 [SENDER] Используется прокси: ${reqConfig.proxy ? reqConfig.proxy.server : 'ПРЯМОЕ СОЕДИНЕНИЕ'}`
    );
    console.log(`🍪 [SENDER] Загружено куки: ${reqConfig.cookies.length}`);
    currentContext = context;
    const liveViewInterval = browser.startLiveView(context);
    const isSent = await sendMessageToProfile(context, url, message);
    clearInterval(liveViewInterval);
    if (isSent) {
      try {
        const database = await db.getDB();
        const profile = await database.get(`SELECT username, name FROM profiles WHERE url = ?`, [url]);
        const username = profile ? (profile.username || profile.name) : url.split('/').pop();
        await database.run(
          `INSERT INTO messages_log (url, username, message_text, status, timestamp) VALUES (?, ?, ?, ?, ?)`,
          [url, username, message, 'sent', new Date().toISOString()]
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

    // Detailed breakdown
    const details = await database.get(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
        SUM(CASE WHEN status = 'liked' THEN 1 ELSE 0 END) as liked,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent
      FROM messages_log
    `);

    const records = await database.all(`SELECT * FROM messages_log ORDER BY timestamp DESC LIMIT 100`);
    res.json({ success: true, summary, records, details });
  } catch (err) {
    console.error('Ошибка получения статистики:', err);
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
