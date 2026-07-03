const express = require('express');
const fs = require('fs');
const path = require('path');
const utils = require('./lib/utils');
const state = require('./lib/state');
const { setupProcessHandlers, expressErrorHandler } = require('./lib/error-handler');
const { verifyToken, isAdmin } = require('./lib/auth-middleware');
const { rateLimit } = require('express-rate-limit');
const ctx = require('./lib/server-context');
const mountRoutes = require('./routes');
const { startMessageScheduler } = require('./lib/message-scheduler');

const originalLog = console.log;
const originalError = console.error;

const LOGS_DIR = path.join(utils.getRootPath(), 'data');
const LOGS_FILE = path.join(LOGS_DIR, 'logs.json');

try {
  ['', 'screenshots', 'reports', 'logs'].forEach((sub) => {
    const dir = path.join(LOGS_DIR, sub);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
} catch (e) {
  originalLog('Error creating data directories:', e);
}

setupProcessHandlers();

const stripAnsi = (value) =>
  String(value || '').replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

try {
  if (fs.existsSync(LOGS_FILE)) {
    const data = fs.readFileSync(LOGS_FILE, 'utf8');
    if (data && data.trim()) {
      ctx.historicalLogs = JSON.parse(data).map((log) => ({
        ...log,
        message: stripAnsi(log.message),
      }));
    }
  }
} catch (e) {
  originalLog('Error loading logs:', e);
}

function saveLogs() {
  try {
    fs.writeFileSync(LOGS_FILE, JSON.stringify(ctx.historicalLogs.slice(-1000)));
  } catch (e) {
    originalLog('Error saving logs:', e);
  }
}

function debouncedSaveLogsLocal() {
  ctx.debouncedSaveLogs(saveLogs);
}

if (process.env.NODE_ENV !== 'test') {
  console.log = (...args) => {
    const entry = ctx.broadcastLog('server', args.join(' '), stripAnsi);
    const colors = { dim: '\x1b[90m', reset: '\x1b[0m', info: '\x1b[32m' };
    const timeStr = `${colors.dim}[${new Date().toLocaleTimeString()}]${colors.reset}`;
    originalLog(`${timeStr} ${colors.info}[SERVER]${colors.reset} ${entry.message}`);
    debouncedSaveLogsLocal();
  };
  console.error = (...args) => {
    ctx.broadcastLog('server-error', args.join(' '), stripAnsi);
    debouncedSaveLogsLocal();
  };
  console.warn = (...args) => {
    ctx.broadcastLog('server-warn', args.join(' '), stripAnsi);
    debouncedSaveLogsLocal();
  };
}

const app = express();
const PORT = process.env.PORT || 5000;

const isLocal = (ip) =>
  ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skip: (req) => isLocal(req.ip),
  message: { error: 'Too many requests, please try again later.' },
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  skip: (req) => isLocal(req.ip),
  message: { error: 'Rate limit exceeded' },
});

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json({ limit: '10mb' }));

const baseDir = utils.getRootPath();
const legacyHtml = path.join(baseDir, 'index.html');
const publicDir = process.pkg
  ? path.join(path.dirname(process.execPath), 'public')
  : path.join(__dirname, 'public');

if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
} else {
  app.get('/', (req, res) => {
    if (fs.existsSync(legacyHtml)) res.sendFile(legacyHtml);
    else res.send('API Server is running. Frontend build not found.');
  });
}

mountRoutes(app, {
  authLimiter,
  apiLimiter,
  verifyToken,
  isAdmin,
  onClearLogs: debouncedSaveLogsLocal,
});

app.use(expressErrorHandler);

if (process.env.NODE_ENV !== 'test') {
  const HOST = process.env.HOST || '127.0.0.1';
  app.listen(PORT, HOST, async () => {
    await state.StateManager.init();
    startMessageScheduler();
    console.log(`Сервер запущен: http://${HOST}:${PORT}`);
  });
}

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  const publicIndex = path.join(publicDir, 'index.html');
  if (fs.existsSync(publicDir) && fs.existsSync(publicIndex)) {
    res.sendFile(publicIndex);
  } else if (fs.existsSync(legacyHtml)) {
    res.sendFile(legacyHtml);
  } else {
    res.status(404).send('Not Found: Frontend build missing. API Server is running.');
  }
});

module.exports = app;
