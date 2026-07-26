const db = require('../lib/db');
const warmup = require('../lib/warmup');
const authorizer = require('../lib/authorizer');
const fingerprintLib = require('../lib/fingerprint');
const ctx = require('../lib/server-context');
const {
  tryAcquireInstagramActivity,
  releaseInstagramActivity,
  getInstagramActivity,
} = require('../lib/instagram-activity');
module.exports = (app) => {
  const { decrypt, encryptSafe, restorePhotos, stopRestorePhotos, invalidateGirlsCache } = ctx;
function getActiveInstagramActivity() {
  return getInstagramActivity()?.type || null;
}
app.post('/api/accounts/:id/authorize/start', async (req, res) => {
  const { id } = req.params;
  const activeActivity = getActiveInstagramActivity();
  if (activeActivity) {
    return res.status(409).json({ success: false, error: `Instagram activity already running: ${activeActivity}` });
  }
  try {
    const database = await db.getDB();
    const account = await database.get(`SELECT * FROM accounts WHERE id = ?`, [id]);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const result = await authorizer.startAuthorization(
      account.id,
      account.name,
      decrypt(account.proxy),
      account.fingerprint,
      true, // isLogin = true
      decrypt(account.cookies),
      account.local_storage
    );
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.get('/api/accounts/:id/authorize/status', (req, res) => {
  const { id } = req.params;
  res.json({ active: authorizer.getAuthorizationStatus(id) });
});

app.post('/api/accounts/:id/authorize/stop', async (req, res) => {
  const { id } = req.params;
  const result = await authorizer.stopAuthorization(id);
  res.json(result);
});

app.post('/api/accounts/:id/browser/start', async (req, res) => {
  const { id } = req.params;
  const activeActivity = getActiveInstagramActivity();
  if (activeActivity) {
    return res.status(409).json({ success: false, error: `Instagram activity already running: ${activeActivity}` });
  }
  try {
    const database = await db.getDB();
    const account = await database.get(`SELECT * FROM accounts WHERE id = ?`, [id]);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const result = await authorizer.startAuthorization(
      account.id,
      account.name,
      decrypt(account.proxy),
      account.fingerprint,
      false, // isLogin = false (just browser)
      decrypt(account.cookies),
      account.local_storage
    );
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/accounts/:id/warmup', async (req, res) => {
  const { id } = req.params;
  const activeActivity = getActiveInstagramActivity();
  if (activeActivity) {
    return res.status(409).json({ success: false, error: `Instagram activity already running: ${activeActivity}` });
  }
  if (ctx.warmupStatus.get(id)?.running) {
    return res.status(400).json({ success: false, error: 'Warmup already in progress' });
  }
  const activityLease = tryAcquireInstagramActivity(`warmup:${id}`);
  if (!activityLease) {
    return res.status(409).json({ success: false, error: 'Instagram activity already running' });
  }

  ctx.warmupStatus.set(id, { running: true, current: 0, total: 50, site: '' });

  // Run in background
  warmup
    .startWarmup(id, (progress) => {
      ctx.warmupStatus.set(id, { running: true, ...progress });
    })
    .then(() => {
      ctx.warmupStatus.set(id, { running: false, done: true });
    })
    .catch((e) => {
      ctx.warmupStatus.set(id, { running: false, error: e.message });
    })
    .finally(() => {
      releaseInstagramActivity(activityLease);
    });

  res.json({ success: true });
});

app.get('/api/accounts/:id/warmup/status', (req, res) => {
  const { id } = req.params;
  res.json(ctx.warmupStatus.get(id) || { running: false });
});

app.post('/api/accounts/:id/instagram-cooldown', async (req, res) => {
  const { id } = req.params;
  const activeActivity = getActiveInstagramActivity();
  if (activeActivity) {
    return res.status(409).json({ success: false, error: `Instagram activity already running: ${activeActivity}` });
  }
  if (ctx.instagramCooldownStatus.get(id)?.running) {
    return res.status(400).json({ success: false, error: 'Instagram cooldown already in progress' });
  }
  const activityLease = tryAcquireInstagramActivity(`instagram-cooldown:${id}`);
  if (!activityLease) {
    return res.status(409).json({ success: false, error: 'Instagram activity already running' });
  }

  ctx.instagramCooldownStatus.set(id, { running: true, current: 0, total: 12, site: '' });

  warmup
    .startInstagramCooldown(id, (progress) => {
      ctx.instagramCooldownStatus.set(id, { running: true, ...progress });
    })
    .then(() => {
      ctx.instagramCooldownStatus.set(id, { running: false, done: true });
    })
    .catch((e) => {
      ctx.instagramCooldownStatus.set(id, { running: false, error: e.message });
    })
    .finally(() => {
      releaseInstagramActivity(activityLease);
    });

  res.json({ success: true });
});

app.get('/api/accounts/:id/instagram-cooldown/status', (req, res) => {
  const { id } = req.params;
  res.json(ctx.instagramCooldownStatus.get(id) || { running: false });
});

app.post('/api/profiles/restore-photos', async (req, res) => {
  if (ctx.restorePhotosStatus.running) {
    return res.status(400).json({ success: false, error: 'Task already in progress' });
  }

  const { concurrency, failedUrls } = req.body;
  ctx.restorePhotosStatus = { running: true, current: 0, total: 0, status: 'Starting...' };

  // Run in background
  restorePhotos(
    (progress) => {
      ctx.restorePhotosStatus = { running: true, ...progress };
    },
    { overrideConcurrency: concurrency, failedUrls }
  )
    .then((result) => {
      ctx.restorePhotosStatus = {
        running: false,
        done: true,
        result,
        current: ctx.restorePhotosStatus.current,
        total: ctx.restorePhotosStatus.total,
        status: 'Done',
      };
      invalidateGirlsCache();
    })
    .catch((e) => {
      ctx.restorePhotosStatus = {
        running: false,
        error: e.message,
        current: ctx.restorePhotosStatus.current,
        total: ctx.restorePhotosStatus.total,
        status: 'Error',
      };
    });

  res.json({ success: true });
});

app.post('/api/profiles/restore-photos/stop', async (req, res) => {
  stopRestorePhotos();
  res.json({ success: true });
});

app.get('/api/profiles/restore-photos/status', (req, res) => {
  res.json(ctx.restorePhotosStatus);
});

// Mass Messaging Endpoints

app.put('/api/accounts/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name,
    proxy,
    cookies,
    fingerprint: requestedFingerprint,
    regenerateFingerprint,
  } = req.body;
  try {
    const database = await db.getDB();
    const existing = await database.get('SELECT id FROM accounts WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Account not found' });
    }
    const updates = [];
    const values = [];
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (proxy !== undefined) {
      updates.push('proxy = ?');
      values.push(encryptSafe(proxy));
    }
    if (cookies !== undefined) {
      updates.push('cookies = ?');
      values.push(encryptSafe(cookies));
    }
    let updatedFingerprint = null;
    if (requestedFingerprint !== undefined) {
      updates.push('fingerprint = ?');
      const fpVal =
        typeof requestedFingerprint === 'object'
          ? JSON.stringify(requestedFingerprint)
          : requestedFingerprint;
      values.push(fpVal);
      updatedFingerprint = fpVal;
    }
    if (regenerateFingerprint) {
      updates.push('fingerprint = ?');
      const fpVal = JSON.stringify(fingerprintLib.generateFingerprint());
      values.push(fpVal);
      updatedFingerprint = fpVal;
    }
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }
    values.push(id);
    await database.run(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`, values);
    res.json({ success: true, fingerprint: updatedFingerprint });
  } catch (e) {
    console.error('Ошибка обновления аккаунта:', e);
    res.status(500).json({ success: false });
  }
});
};
