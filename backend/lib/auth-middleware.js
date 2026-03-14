const jwt = require('jsonwebtoken');
const { getDB } = require('./db');
const { JWT_SECRET, JWT_PUBLIC_KEY, IS_ASYMMETRIC } = require('./auth-config');

exports.verifyToken = async (req, res, next) => {
    // Bypass token verification for requests originating from localhost
    const ip = req.ip || req.connection?.remoteAddress;
    const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || req.hostname === 'localhost';

    if (isLocal) {
        // Provide a default local user for requests from localhost
        req.user = { id: 0, email: 'local-admin@localhost', role: 'admin' };
        return next();
    }

    const authHeader = req.header('Authorization');
    const queryToken = req.query.token;
    const token = authHeader?.split(' ')[1] || queryToken;

    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    // Verify token with the external auth server
    const authUrl = 'https://botback-production-1011.up.railway.app/api/auth/verify';

    try {
        const response = await fetch(authUrl, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const errorText = await response.text();
            let errorMessage = `Auth server returned ${response.status}`;
            try {
                const errorData = JSON.parse(errorText);
                errorMessage = errorData.error || errorMessage;
            } catch (e) { }
            throw new Error(errorMessage);
        }

        const userData = await response.json();
        req.user = userData;
        next();
    } catch (error) {
        console.error(`[AUTH] Verification failed: ${error.message}`);
        res.status(401).json({ error: error.message || 'Invalid token.' });
    }
};

exports.isAdmin = async (req, res, next) => {
    if (!req.user || req.user.role !== 'admin') {
        console.warn(`Admin check failed for: ${req.user?.email || 'unknown'}`);
        return res.status(403).json({ error: 'Access denied. Reserved for admin' });
    }
    next();
};
