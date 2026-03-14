const jwt = require('jsonwebtoken');
const { getDB } = require('./db');

const { JWT_SECRET } = require('./auth-config');


exports.verifyToken = async (req, res, next) => {
    const authHeader = req.header('Authorization');
    const queryToken = req.query.token;
    const token = authHeader?.split(' ')[1] || queryToken;

    if (!token) {
        console.warn(`[AUTH] No token provided for ${req.method} ${req.path}`);
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (typeof decoded === 'string') return res.status(401).json({ error: 'Invalid token payload' });

        // We trust the token because it's signed with the shared JWT_SECRET.
        // We set req.user from the decoded token which contains id, email, role.
        req.user = {
            id: decoded.id,
            email: decoded.email,
            role: decoded.role || 'user'
        };

        console.log(`[AUTH] Token verified (stateless) for ${req.user.email} on ${req.method} ${req.path}`);
        next();
    } catch (error) {
        console.error(`[AUTH] Token verification failed: ${error.message}`);
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
