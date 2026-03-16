const jwt = require('jsonwebtoken');
const { getDB } = require('./db');
const { JWT_SECRET, JWT_PUBLIC_KEY, IS_ASYMMETRIC } = require('./auth-config');
const https = require('https');

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

    const authUrl = process.env.AUTH_SERVER_URL || process.env.VITE_AUTH_URL || 'https://botback-production-1011.up.railway.app';
    const isRemote = !!authUrl;

    const key = IS_ASYMMETRIC ? JWT_PUBLIC_KEY : JWT_SECRET;
    let decoded;

    try {
        decoded = jwt.verify(token, key, {
            algorithms: IS_ASYMMETRIC ? ['RS256'] : ['HS256']
        });
    } catch (error) {
        // Fallback or retry if verification fails locally (e.g. different secrets)
        if (isRemote) {
            try {
                decoded = jwt.decode(token);
            } catch (e) {
                return res.status(401).json({ error: 'Invalid token.' });
            }
        } else {
            return res.status(401).json({ error: 'Invalid token.' });
        }
    }

    if (!decoded || typeof decoded === 'string') return res.status(401).json({ error: 'Invalid token payload' });

    // Always perform remote validation if we have an auth server, to sync block/logout status
    if (isRemote) {
        try {
            const httpModule = require(authUrl.startsWith('http://') ? 'http' : 'https');
            const remoteValid = await new Promise((resolve) => {
                // Use /api/auth/verify which exists on the auth server and is protected
                const verifyUrl = new URL('/api/auth/verify', authUrl).toString();
                httpModule.get(verifyUrl, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }, (response) => {
                    // Only 200 means active and not blocked. 
                    // Any other status (401, 403, 404, 500) treated as invalid.
                    resolve(response.statusCode === 200);
                }).on('error', (err) => {
                    console.error('[AUTH] Remote validation error:', err.message);
                    resolve(false);
                });
            });

            if (!remoteValid) {
                return res.status(401).json({ error: 'Session expired or account blocked.' });
            }
        } catch (e) {
            console.error('[AUTH] Failed to reach auth server:', e.message);
            return res.status(503).json({ error: 'Auth server unreachable' });
        }
    }

    try {
        const db = await getDB();
        const user = await db.get('SELECT * FROM users WHERE id = ?', [decoded.id]);

        if (user) {
            if (user.is_blocked) return res.status(401).json({ error: 'Account is blocked' });
            if (user.is_deleted) return res.status(401).json({ error: 'Account is deleted' });

            // Critical check: Only 1 active session allowed (for local auth only)
            if (!isRemote && decoded.tokenVersion !== undefined && decoded.tokenVersion !== user.token_version) {
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
