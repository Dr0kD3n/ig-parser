const jwt = require('jsonwebtoken');
const { getDB } = require('./db');
const { JWT_SECRET, JWT_PUBLIC_KEY, IS_ASYMMETRIC } = require('./auth-config');

const PROD_URL = 'https://botback-production-1011.up.railway.app';

function isLocalRequest(req) {
  const ip = req.ip || req.socket?.remoteAddress || '';
  return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
}

function getAuthServerUrl() {
  if (process.env.AUTH_SERVER_URL) return process.env.AUTH_SERVER_URL;
  if (process.env.VITE_AUTH_URL) return process.env.VITE_AUTH_URL;
  if (process.env.NODE_ENV === 'production') return PROD_URL;
  return null;
}

/** valid | invalid | skip (remote недоступен — не разлогиниваем локальную панель) */
function verifyRemoteToken(token, authUrl, strict) {
  return new Promise((resolve) => {
    const httpModule = require(authUrl.startsWith('http://') ? 'http' : 'https');
    const verifyUrl = new URL('/api/auth/verify', authUrl).toString();
    const req = httpModule.get(
      verifyUrl,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 8000,
      },
      (response) => {
        if (response.statusCode === 200) return resolve('valid');
        if (response.statusCode === 401 || response.statusCode === 403) return resolve('invalid');
        console.warn(`[AUTH] Remote verify HTTP ${response.statusCode}, fallback=${strict ? 'deny' : 'local'}`);
        return resolve(strict ? 'invalid' : 'skip');
      }
    );
    req.on('error', (err) => {
      console.warn(`[AUTH] Remote auth unavailable (${err.code || err.message}), fallback=${strict ? 'deny' : 'local'}`);
      resolve(strict ? 'invalid' : 'skip');
    });
    req.on('timeout', () => {
      req.destroy();
      console.warn('[AUTH] Remote auth timeout, fallback=', strict ? 'deny' : 'local');
      resolve(strict ? 'invalid' : 'skip');
    });
  });
}

exports.verifyToken = async (req, res, next) => {
  // console.log('[DEBUG] verifyToken called for', req.path, 'token =', req.header('Authorization'));
  // Skip auth in test environment
  if (process.env.NODE_ENV === 'test') {
    req.user = { id: 1, email: 'test@example.com', role: 'admin' };
    return next();
  }

  const authHeader = req.header('Authorization');
  const queryToken = req.query.token;
  const token = authHeader?.split(' ')[1] || queryToken;

  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const authUrl = getAuthServerUrl();
  const skipRemote =
    process.env.AUTH_SKIP_REMOTE_VERIFY === '1' ||
    process.env.AUTH_SKIP_REMOTE_VERIFY === 'true';
  const localPanel = isLocalRequest(req);
  const useRemoteVerify = !!authUrl && !skipRemote && !localPanel;

  const key = IS_ASYMMETRIC ? JWT_PUBLIC_KEY : JWT_SECRET;
  let decoded;

  try {
    decoded = jwt.verify(token, key, {
      algorithms: IS_ASYMMETRIC ? ['RS256'] : ['HS256'],
    });
  } catch (error) {
    try {
      decoded = jwt.decode(token);
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token.' });
    }
  }

  if (!decoded || typeof decoded === 'string')
    return res.status(401).json({ error: 'Invalid token payload' });

  if (useRemoteVerify) {
    const remoteResult = await verifyRemoteToken(token, authUrl, process.env.NODE_ENV === 'production');
    if (remoteResult === 'invalid') {
      return res.status(401).json({ error: 'Session expired or account blocked.' });
    }
  }

  try {
    const db = await getDB();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [decoded.id]);

    if (user) {
      if (user.is_blocked) return res.status(401).json({ error: 'Account is blocked' });
      if (user.is_deleted) return res.status(401).json({ error: 'Account is deleted' });

      // Critical check: Only 1 active session allowed (for local auth only)
      if (
        !useRemoteVerify &&
        decoded.tokenVersion !== undefined &&
        decoded.tokenVersion !== user.token_version
      ) {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }

      req.user = { id: user.id, email: user.email, role: user.role };
      return next();
    }

    // If user not in local DB but remote validation passed
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role || 'user' };
    next();
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
