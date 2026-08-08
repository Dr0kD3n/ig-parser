const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const jwt = require('jsonwebtoken');
const { getDB } = require('./db');
const { JWT_SECRET, JWT_PUBLIC_KEY, IS_ASYMMETRIC } = require('./auth-config');

const PROD_URL = 'https://botback-production-1011.up.railway.app';
const SYSTEM_VERIFIER_PREFERENCE_MS = 10 * 60_000;
const VERIFY_TIMEOUT_MS = 6_000;
const VERIFY_RETRY_DELAY_MS = 350;
const remoteVerificationsInFlight = new Map();
let systemVerifierPreferredUntil = 0;
const remoteAuthAgents = {
  http: new http.Agent({ keepAlive: true }),
  https: new https.Agent({ keepAlive: true }),
};

function getAuthServerUrl() {
  if (process.env.AUTH_SERVER_URL) return process.env.AUTH_SERVER_URL;
  if (process.env.VITE_AUTH_URL) return process.env.VITE_AUTH_URL;
  return PROD_URL;
}

function statusToVerification(statusCode) {
  if (statusCode === 200) return 'valid';
  if (statusCode === 401 || statusCode === 403) return 'invalid';
  return 'unavailable';
}

function verifyRemoteTokenWithNode(token, authUrl) {
  return new Promise((resolve) => {
    const verifyUrl = new URL('/api/auth/verify', authUrl);
    const client = verifyUrl.protocol === 'http:' ? http : https;
    const request = client.get(
      verifyUrl,
      {
        headers: { Authorization: `Bearer ${token}`, Connection: 'keep-alive' },
        timeout: VERIFY_TIMEOUT_MS,
        agent: verifyUrl.protocol === 'http:' ? remoteAuthAgents.http : remoteAuthAgents.https,
        family: 4,
      },
      (response) => {
        response.resume();
        resolve(statusToVerification(response.statusCode));
      }
    );
    request.once('error', (error) => {
      console.warn(`[AUTH] Node verifier unavailable (${error.code || error.message})`);
      resolve('unavailable');
    });
    request.once('timeout', () => {
      request.destroy(new Error('Authentication request timeout'));
    });
  });
}

function escapeCurlConfig(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function verifyRemoteTokenWithPowerShell(token, authUrl) {
  return new Promise((resolve) => {
    if (!/^[A-Za-z0-9._-]+$/.test(token)) return resolve('invalid');
    const verifyUrl = new URL('/api/auth/verify', authUrl).toString();
    const script = [
      "$ErrorActionPreference = 'Stop'",
      '$inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json',
      '$token = $inputData.token',
      '$uri = $inputData.uri',
      "try { $response = Invoke-WebRequest -UseBasicParsing -Uri $uri -Headers @{ Authorization = ('Bearer ' + $token) } -TimeoutSec 15; [Console]::Out.Write([int]$response.StatusCode) }",
      'catch { if ($_.Exception.Response) { [Console]::Out.Write([int]$_.Exception.Response.StatusCode) } else { exit 2 } }',
    ].join('\n');
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true }
    );
    let output = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const killTimer = setTimeout(() => child.kill(), 20_000);
    killTimer.unref?.();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 32) child.kill();
    });
    child.once('error', (error) => {
      clearTimeout(killTimer);
      console.warn(`[AUTH] Windows verifier unavailable (${error.code || error.message})`);
      finish('unavailable');
    });
    child.once('close', (code) => {
      clearTimeout(killTimer);
      const statusCode = Number.parseInt(output.trim(), 10);
      if (code !== 0 || !Number.isInteger(statusCode)) return finish('unavailable');
      finish(statusToVerification(statusCode));
    });
    child.stdin.end(JSON.stringify({ token, uri: verifyUrl }));
  });
}

function verifyRemoteTokenWithCurl(token, authUrl) {
  return new Promise((resolve) => {
    if (!/^[A-Za-z0-9._-]+$/.test(token)) return resolve('invalid');
    const verifyUrl = new URL('/api/auth/verify', authUrl).toString();
    const child = spawn('curl', ['--config', '-'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let output = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 32) child.kill();
    });
    child.once('error', (error) => {
      console.warn(`[AUTH] System verifier unavailable (${error.code || error.message})`);
      finish('unavailable');
    });
    child.once('close', (code) => {
      const statusCode = Number.parseInt(output.trim(), 10);
      if (code !== 0 || !Number.isInteger(statusCode)) return finish('unavailable');
      finish(statusToVerification(statusCode));
    });
    child.stdin.end(
      [
        'silent',
        'show-error',
        'output = "/dev/null"',
        'write-out = "%{http_code}"',
        'connect-timeout = 6',
        'max-time = 15',
        'retry = 2',
        'retry-delay = 1',
        'retry-all-errors',
        `header = "Authorization: Bearer ${token}"`,
        `url = "${escapeCurlConfig(verifyUrl)}"`,
      ].join('\n')
    );
  });
}

function verifyRemoteTokenWithSystem(token, authUrl) {
  return process.platform === 'win32'
    ? verifyRemoteTokenWithPowerShell(token, authUrl)
    : verifyRemoteTokenWithCurl(token, authUrl);
}

async function verifyRemoteToken(token, authUrl) {
  if (systemVerifierPreferredUntil > Date.now()) {
    const systemResult = await verifyRemoteTokenWithSystem(token, authUrl);
    if (systemResult !== 'unavailable') return systemResult;
    systemVerifierPreferredUntil = 0;
  }

  const firstResult = await verifyRemoteTokenWithNode(token, authUrl);
  if (firstResult !== 'unavailable') return firstResult;
  await new Promise((resolve) => setTimeout(resolve, VERIFY_RETRY_DELAY_MS));
  const retryResult = await verifyRemoteTokenWithNode(token, authUrl);
  if (retryResult !== 'unavailable') return retryResult;
  console.warn('[AUTH] Switching to system HTTP verifier');
  const systemResult = await verifyRemoteTokenWithSystem(token, authUrl);
  if (systemResult !== 'unavailable') {
    systemVerifierPreferredUntil = Date.now() + SYSTEM_VERIFIER_PREFERENCE_MS;
  }
  return systemResult;
}

function verifyRemoteTokenOncePerBurst(token, authUrl) {
  const existing = remoteVerificationsInFlight.get(token);
  if (existing) return existing;
  const verification = verifyRemoteToken(token, authUrl).finally(() => {
    remoteVerificationsInFlight.delete(token);
  });
  remoteVerificationsInFlight.set(token, verification);
  return verification;
}

exports.verifyToken = async (req, res, next) => {
  if (process.env.NODE_ENV === 'test') {
    req.user = { id: 1, email: 'test@example.com', role: 'admin' };
    return next();
  }
  if (process.env.E2E_TEST === '1') {
    req.user = { id: 1, email: 'e2e@test.com', role: 'admin' };
    return next();
  }

  const [scheme, token] = req.header('Authorization')?.trim().split(/\s+/, 2) || [];
  if (scheme?.toLowerCase() !== 'bearer' || !token || token === 'null' || token === 'undefined') {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const authUrl = getAuthServerUrl();
  const skipRemote =
    process.env.AUTH_SKIP_REMOTE_VERIFY === '1' || process.env.AUTH_SKIP_REMOTE_VERIFY === 'true';
  const useRemoteVerify = Boolean(authUrl) && !skipRemote;

  if (useRemoteVerify) {
    const remoteResult = await verifyRemoteTokenOncePerBurst(token, authUrl);
    if (remoteResult === 'invalid') {
      return res.status(401).json({ error: 'Session expired or account blocked.' });
    }
    if (remoteResult === 'unavailable') {
      return res.status(503).json({ error: 'Authentication service unavailable.' });
    }
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded === 'string') {
      return res.status(401).json({ error: 'Invalid token payload' });
    }
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role || 'user' };
    return next();
  }

  const key = IS_ASYMMETRIC ? JWT_PUBLIC_KEY : JWT_SECRET;
  let decoded;
  try {
    decoded = jwt.verify(token, key, { algorithms: IS_ASYMMETRIC ? ['RS256'] : ['HS256'] });
  } catch {
    return res.status(401).json({ error: 'Invalid token.' });
  }
  if (!decoded || typeof decoded === 'string') {
    return res.status(401).json({ error: 'Invalid token payload' });
  }

  try {
    const db = await getDB();
    const user = await db.get('SELECT * FROM users WHERE id = ?', [decoded.id]);
    if (!user) return res.status(401).json({ error: 'User not found.' });
    if (user.is_blocked) return res.status(401).json({ error: 'Account is blocked' });
    if (user.is_deleted) return res.status(401).json({ error: 'Account is deleted' });
    if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== user.token_version) {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    req.user = { id: user.id, email: user.email, role: user.role };
    return next();
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
