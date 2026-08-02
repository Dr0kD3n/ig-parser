const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { getDB } = require('./db');
const { JWT_SECRET, JWT_PUBLIC_KEY, IS_ASYMMETRIC } = require('./auth-config');

const PROD_URL = 'https://botback-production-1011.up.railway.app';
const REMOTE_VERIFY_CACHE_MS = 15_000;
const REMOTE_VERIFY_CACHE_LIMIT = 100;
const remoteVerifyCache = new Map();
const remoteVerificationsInFlight = new Map();
const remoteAuthAgents = {
  http: new http.Agent({ keepAlive: true }),
  https: new https.Agent({ keepAlive: true }),
};

function getAuthServerUrl() {
  if (process.env.AUTH_SERVER_URL) return process.env.AUTH_SERVER_URL;
  if (process.env.VITE_AUTH_URL) return process.env.VITE_AUTH_URL;
  return PROD_URL;
}

/** valid | invalid | unavailable */
function verifyRemoteToken(token, authUrl) {
  return new Promise((resolve) => {
    const httpModule = authUrl.startsWith('http://') ? http : https;
    const verifyUrl = new URL('/api/auth/verify', authUrl).toString();
    const req = httpModule.get(
      verifyUrl,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
        agent: authUrl.startsWith('http://') ? remoteAuthAgents.http : remoteAuthAgents.https,
      },
      (response) => {
        response.resume();
        if (response.statusCode === 200) return resolve('valid');
        if (response.statusCode === 401 || response.statusCode === 403) return resolve('invalid');
        console.warn(`[AUTH] Remote verify HTTP ${response.statusCode}, service unavailable`);
        return resolve('unavailable');
      }
    );
    req.on('error', (err) => {
      console.warn(`[AUTH] Remote auth unavailable (${err.code || err.message})`);
      resolve('unavailable');
    });
    req.on('timeout', () => {
      req.destroy();
      console.warn('[AUTH] Remote auth timeout');
      resolve('unavailable');
    });
  });
}

function getRemoteVerificationKey(token, authUrl) {
  return crypto.createHash('sha256').update(`${authUrl}\0${token}`).digest('hex');
}

function cacheValidVerification(key, token) {
  const now = Date.now();
  const decoded = jwt.decode(token);
  const tokenExpiresAt =
    decoded && typeof decoded !== 'string' && Number.isFinite(decoded.exp)
      ? decoded.exp * 1000
      : now + REMOTE_VERIFY_CACHE_MS;
  const expiresAt = Math.min(now + REMOTE_VERIFY_CACHE_MS, tokenExpiresAt);
  if (expiresAt <= now) return;

  if (remoteVerifyCache.size >= REMOTE_VERIFY_CACHE_LIMIT) {
    for (const [cachedKey, cached] of remoteVerifyCache) {
      if (cached.expiresAt <= now || remoteVerifyCache.size >= REMOTE_VERIFY_CACHE_LIMIT) {
        remoteVerifyCache.delete(cachedKey);
      }
    }
  }
  remoteVerifyCache.set(key, { expiresAt });
}

function verifyRemoteTokenCached(token, authUrl) {
  const key = getRemoteVerificationKey(token, authUrl);
  const cached = remoteVerifyCache.get(key);
  if (cached?.expiresAt > Date.now()) return Promise.resolve('valid');
  if (cached) remoteVerifyCache.delete(key);

  const existing = remoteVerificationsInFlight.get(key);
  if (existing) return existing;

  const verification = verifyRemoteToken(token, authUrl)
    .then((result) => {
      if (result === 'valid') cacheValidVerification(key, token);
      return result;
    })
    .finally(() => remoteVerificationsInFlight.delete(key));
  remoteVerificationsInFlight.set(key, verification);
  return verification;
}

exports.verifyToken = async (req, res, next) => {
  // console.log('[DEBUG] verifyToken called for', req.path, 'token =', req.header('Authorization'));
  // Skip auth in test environment
  if (process.env.NODE_ENV === 'test') {
    req.user = { id: 1, email: 'test@example.com', role: 'admin' };
    return next();
  }

  if (process.env.E2E_TEST === '1') {
    req.user = { id: 1, email: 'e2e@test.com', role: 'admin' };
    return next();
  }

  const authHeader = req.header('Authorization');
  const [scheme, token] = authHeader?.trim().split(/\s+/, 2) || [];

  if (scheme?.toLowerCase() !== 'bearer' || !token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const authUrl = getAuthServerUrl();
  const skipRemote =
    process.env.AUTH_SKIP_REMOTE_VERIFY === '1' || process.env.AUTH_SKIP_REMOTE_VERIFY === 'true';
  const useRemoteVerify = !!authUrl && !skipRemote;

  const key = IS_ASYMMETRIC ? JWT_PUBLIC_KEY : JWT_SECRET;
  let decoded;

  if (useRemoteVerify) {
    const remoteResult = await verifyRemoteTokenCached(token, authUrl);
    if (remoteResult === 'invalid') {
      return res.status(401).json({ error: 'Session expired or account blocked.' });
    }
    if (remoteResult === 'unavailable') {
      return res.status(503).json({ error: 'Authentication service unavailable.' });
    }
    decoded = jwt.decode(token);
  } else {
    try {
      decoded = jwt.verify(token, key, {
        algorithms: IS_ASYMMETRIC ? ['RS256'] : ['HS256'],
      });
    } catch {
      return res.status(401).json({ error: 'Invalid token.' });
    }
  }

  if (!decoded || typeof decoded === 'string')
    return res.status(401).json({ error: 'Invalid token payload' });

  if (useRemoteVerify) {
    // Remote auth owns this identity. A local user can have the same numeric id,
    // so local account flags must not override a remotely verified session.
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role || 'user' };
    return next();
  }

  try {
    const db = await getDB();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [decoded.id]);

    if (user) {
      if (user.is_blocked) return res.status(401).json({ error: 'Account is blocked' });
      if (user.is_deleted) return res.status(401).json({ error: 'Account is deleted' });

      // Critical check: Only 1 active local session allowed.
      if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== user.token_version) {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }

      req.user = { id: user.id, email: user.email, role: user.role };
      return next();
    }

    return res.status(401).json({ error: 'User not found.' });
  } catch (dbError) {
    console.error('DB Error in auth middleware:', dbError);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

exports.isAdmin = async (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    console.warn(`Admin check failed for: ${req.user?.email || 'unknown'}`);
    return res.status(403).json({ error: 'Access denied. Reserved for admin' });
  }
  next();
};
