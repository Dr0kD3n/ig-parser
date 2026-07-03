import fs from 'fs';
import path from 'path';

const server = fs.readFileSync('backend/server.js.orig', 'utf8');
const lines = server.split('\n');
const slice = (a, b) => lines.slice(a - 1, b).join('\n');

function transform(body, { renameDb = false } = {}) {
  let out = body
    .replace(/\(0, (\w+)_1\.(\w+)\)\(/g, '$1.$2(')
    .replace(/(\w+)_1\.(\w+)/g, '$1.$2')
    .replace(/const authorizer = require\('\.\/lib\/authorizer'\);\n\/\/ \.\.\. existing code \.\.\.\n/g, '')
    .replace(/let warmupStatus = new Map\(\);\n\n/g, '')
    .replace(/let instagramCooldownStatus = new Map\(\);\n\n/g, '')
    .replace(/let restorePhotosStatus = \{ running: false, current: 0, total: 0, status: '' \};\n\n/g, '');
  if (renameDb) {
    out = out
      .replace(/const db = await db\.getDB\(\)/g, 'const database = await db.getDB()')
      .replace(/\bdb\.(get|run|all)\(/g, 'database.$1(');
  } else {
    out = out
      .replace(/const db = await db\.getDB\(\)/g, 'const database = await db.getDB()')
      .replace(/\bdb\.(get|run|all)\(/g, 'database.$1(');
  }
  return out;
}

const getSettingsBlock = transform(slice(194, 254));
const sendBlock = transform(
  slice(1493, 1605)
    .replace(/^const getSelectorString = \(key\) => \{/, 'function getSelectorString(key) {')
    .replace(/^const sendMessageToProfile = /, 'async function sendMessageToProfile ')
    .replace(/path\.join\(__dirname, 'debug_error\.png'\)/g, "path.join(__dirname, '..', 'debug_error.png')")
);

const contextFile = `const path = require('path');
const browser = require('./browser');
const utils = require('./utils');
const db = require('./db');
const reporter = require('./reporter');
const { encrypt, decrypt } = require('./encryption');
const { markDmSentByUsername } = require('./profile-dedup');
const events = require('events');

const CONFIG = ${slice(155, 193).replace(/^const CONFIG = /, '').trim()};

${getSettingsBlock}

let girlsCache = null;
let girlsCacheTime = 0;
const CACHE_TTL = 1000;

async function getGirlsCached() {
  const now = Date.now();
  if (girlsCache && now - girlsCacheTime < CACHE_TTL) return girlsCache;
  try {
    const database = await db.getDB();
    girlsCache = await database.all(\`
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
        \`);
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
let historicalLogs = [];

function debouncedSaveLogs(saveFn) {
  if (debouncedSaveLogs._timer) return;
  debouncedSaveLogs._timer = setTimeout(() => {
    debouncedSaveLogs._timer = null;
    saveFn();
  }, 10000);
}

function broadcastLog(source, message, stripAnsiFn) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    source,
    message: stripAnsiFn(message).trim(),
    sessionId: currentSessionId,
  };
  historicalLogs.push(logEntry);
  if (historicalLogs.length > 1000) historicalLogs.shift();
  logEmitter.emit('log', logEntry);
  return logEntry;
}

const warmupStatus = new Map();
const instagramCooldownStatus = new Map();
let restorePhotosStatus = { running: false, current: 0, total: 0, status: '' };

${sendBlock}

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
  markDmSentByUsername,
  restorePhotos: require('./photo-restorer').restorePhotos,
  stopRestorePhotos: require('./photo-restorer').stopRestorePhotos,
};
`;

fs.writeFileSync('backend/lib/server-context.js', contextFile);

const files = [
  ['auth.js', [[321, 322]], `const authController = require('../lib/auth-controller');\nmodule.exports = (app, { authLimiter }) => {\n`],
  ['public.js', [[324, 331]], `const fs = require('fs');\nconst { getLocalPhotoPath } = require('../lib/photo-cache');\nmodule.exports = (app) => {\n`],
  ['profiles.js', [[346, 415]], `const db = require('../lib/db');\nconst ctx = require('../lib/server-context');\nmodule.exports = (app) => {\n  const { getGirlsCached, invalidateGirlsCache } = ctx;\n`],
  ['messaging.js', [[416, 516], [868, 902]], `const db = require('../lib/db');\nconst https = require('https');\nconst { startMassMessaging, stopMassMessaging, getMassMessengerStatus } = require('../lib/mass-messenger');\nconst { checkFeedback, getCheckerStatus, stopChecker } = require('../lib/feedback-handler');\nconst ctx = require('../lib/server-context');\nmodule.exports = (app) => {\n  const { CONFIG, invalidateGirlsCache, broadcastLog } = ctx;\n`],
  ['settings.js', [[517, 700]], `const db = require('../lib/db');\nconst state = require('../lib/state');\nconst config = require('../lib/config');\nconst fingerprint = require('../lib/fingerprint');\nconst ctx = require('../lib/server-context');\nmodule.exports = (app) => {\n  const { getSettings, encrypt, decrypt } = ctx;\n`],
  ['accounts.js', [[703, 867], [904, 950]], `const db = require('../lib/db');\nconst warmup = require('../lib/warmup');\nconst authorizer = require('../lib/authorizer');\nconst fingerprintLib = require('../lib/fingerprint');\nconst ctx = require('../lib/server-context');\nmodule.exports = (app) => {\n  const { encrypt, decrypt, restorePhotos, stopRestorePhotos, invalidateGirlsCache } = ctx;\n`],
  ['proxy.js', [[952, 1087]], `const http = require('http');\nconst https = require('https');\nconst config = require('../lib/config');\nconst utils = require('../lib/utils');\nconst ctx = require('../lib/server-context');\nmodule.exports = (app) => {\n  const { CONFIG } = ctx;\n`],
  ['presets.js', [[1088, 1128]], `const db = require('../lib/db');\nmodule.exports = (app) => {\n`],
  ['donors.js', [[1129, 1204]], `const db = require('../lib/db');\nconst state = require('../lib/state');\nconst config = require('../lib/config');\nmodule.exports = (app) => {\n`],
  ['admin.js', [[1205, 1471]], `const fs = require('fs');\nconst path = require('path');\nconst http = require('http');\nconst child_process = require('child_process');\nconst db = require('../lib/db');\nconst utils = require('../lib/utils');\nconst config = require('../lib/config');\nconst browser = require('../lib/browser');\nconst ctx = require('../lib/server-context');\nmodule.exports = (app, { onClearLogs }) => {\n  const { botProcesses, refreshSession, broadcastLog, logEmitter, sendMessageToProfile, markDmSentByUsername } = ctx;\n`],
];

fs.mkdirSync('backend/routes', { recursive: true });

for (const [name, ranges, header] of files) {
  let body = ranges.map(([a, b]) => slice(a, b)).join('\n\n');
  body = transform(body, { renameDb: name === 'settings.js' });
  if (name === 'accounts.js') {
    body = body
      .replace(/warmup_1/g, 'warmup')
      .replace(/warmupStatus\./g, 'ctx.warmupStatus.')
      .replace(/instagramCooldownStatus\./g, 'ctx.instagramCooldownStatus.')
      .replace(/restorePhotosStatus/g, 'ctx.restorePhotosStatus')
      .replace(/fingerprintLib\.generateFingerprint\(\)/g, 'fingerprintLib.generateFingerprint()');
  }
  if (name === 'profiles.js') {
    body = body.replace(/restorePhotosStatus\.running/g, 'ctx.restorePhotosStatus.running');
  }
  if (name === 'admin.js') {
    body = body
      .replace(
        `app.post('/api/logs/clear', (req, res) => {\n  historicalLogs = [];\n  debouncedSaveLogs();\n  res.json({ success: true });\n});`,
        `app.post('/api/logs/clear', (req, res) => {\n  ctx.historicalLogs = [];\n  onClearLogs?.();\n  res.json({ success: true });\n});`
      )
      .replace(
        `  historicalLogs.forEach((log) => {\n    res.write(\`data: \${JSON.stringify(log)}\\n\\n\`);\n  });`,
        `  ctx.historicalLogs.forEach((log) => {\n    res.write(\`data: \${JSON.stringify(log)}\\n\\n\`);\n  });`
      );
  }
  fs.writeFileSync(path.join('backend/routes', name), header + body + '\n};\n');
}

fs.writeFileSync(
  'backend/routes/index.js',
  `module.exports = function mountRoutes(app, middleware) {
  const { authLimiter, apiLimiter, verifyToken, isAdmin, onClearLogs } = middleware;
  app.use('/api', apiLimiter);
  require('./auth')(app, { authLimiter });
  require('./public')(app);
  app.use('/api', verifyToken);
  app.use('/api/bot/start', authLimiter);
  app.get('/api/admin/users', isAdmin, async (req, res) => {
    res.status(501).json({ error: 'Managed by main server' });
  });
  require('./profiles')(app);
  require('./settings')(app);
  require('./messaging')(app);
  require('./accounts')(app);
  require('./proxy')(app);
  require('./presets')(app);
  require('./donors')(app);
  require('./admin')(app, { onClearLogs });
};
`
);

console.log('done');
