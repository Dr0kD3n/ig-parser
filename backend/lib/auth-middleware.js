const jwt = require('jsonwebtoken');
const { getDB } = require('./db');
const { JWT_SECRET, JWT_PUBLIC_KEY, IS_ASYMMETRIC } = require('./auth-config');

exports.verifyToken = async (req, res, next) => {
    const authHeader = req.header('Authorization');
    const queryToken = req.query.token;
    const token = authHeader?.split(' ')[1] || queryToken;

    // Skip verification for local requests during development
    const ip = req.ip || req.connection?.remoteAddress || '';
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || req.hostname === 'localhost';

    if (isLocal) {
        req.user = {
            id: 'local-dev',
            email: 'local@localhost',
            role: 'admin' // Grant admin rights for local dev
        };
        return next();
    }

    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        // Use Public Key if exists (RS256), otherwise fallback to Secret (HS256)
        const key = IS_ASYMMETRIC ? JWT_PUBLIC_KEY : JWT_SECRET;
        const decoded = jwt.verify(token, key, {
            algorithms: IS_ASYMMETRIC ? ['RS256'] : ['HS256']
        });

        if (typeof decoded === 'string') return res.status(401).json({ error: 'Invalid token payload' });

        req.user = {
            id: decoded.id,
            email: decoded.email,
            role: decoded.role || 'user'
        };

        next();
    } catch (error) {
        console.error(`[AUTH] Verification failed: ${error.message}`);
        res.status(401).json({ error: 'Invalid token.' });
    }
};

exports.isAdmin = async (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        console.warn(`Admin check failed for: ${req.user?.email || 'unknown'}`);
        return res.status(403).json({ error: 'Access denied. Reserved for admin' });
    }
    next();
};
