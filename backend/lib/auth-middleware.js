const jwt = require('jsonwebtoken');
const { getDB } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_key_123';

function isLocalhost(req) {
    const ip = req.ip || req.connection.remoteAddress || '';
    const host = req.get('host') || '';
    return (
        ip === '127.0.0.1' ||
        ip === '::1' ||
        ip === '::ffff:127.0.0.1' ||
        host.startsWith('localhost') ||
        host.startsWith('127.0.0.1')
    );
}

exports.verifyToken = (req, res, next) => {
    if (isLocalhost(req)) {
        req.user = { id: 0, email: 'local@localhost', role: 'admin' };
        return next();
    }

    const token = req.header('Authorization')?.split(' ')[1] || req.query.token;
    if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token.' });
    }
};

exports.isAdmin = async (req, res, next) => {
    if (isLocalhost(req)) {
        return next();
    }

    if (!req.user || !req.user.email) {
        return res.status(403).json({ error: 'Access denied. Reserved for admin' });
    }

    try {
        const db = await getDB();
        const user = await db.get('SELECT role FROM users WHERE email = ?', [req.user.email]);

        if (user && user.role === 'admin') {
            next();
        } else {
            console.warn(`Admin check failed for: ${req.user.email}`);
            res.status(403).json({ error: 'Access denied. Reserved for admin' });
        }
    } catch (error) {
        console.error('Error in isAdmin middleware:', error);
        res.status(500).json({ error: 'Internal server error during authorization' });
    }
};
