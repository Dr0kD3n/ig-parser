const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDB } = require('./db');
const crypto = require('crypto');

const { JWT_SECRET } = require('./auth-config');


exports.signup = async (req, res) => {
    const { email, password, registrationCode } = req.body;
    if (!email || !password || !registrationCode) {
        return res.status(400).json({ error: 'All fields are required including registration code' });
    }

    try {
        const db = await getDB();

        // Verify registration code
        const codeRecord = await db.get('SELECT * FROM registration_codes WHERE UPPER(code) = UPPER(?) AND is_used = 0', [registrationCode]);
        if (!codeRecord) {
            return res.status(400).json({ error: 'Invalid or already used registration code' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Transaction: Create user and mark code as used
        await db.run('BEGIN TRANSACTION');
        try {
            await db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword]);
            await db.run('UPDATE registration_codes SET is_used = 1, used_by_email = ? WHERE id = ?', [email, codeRecord.id]);
            await db.run('COMMIT');
        } catch (err) {
            await db.run('ROLLBACK');
            throw err;
        }

        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error('Signup error:', error);
        console.error('Error stack:', error.stack);
        if (error.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Email already exists' });
        }
        res.status(500).json({ error: 'Internal server error: ' + error.message, stack: error.stack });
    }
};

exports.login = async (req, res) => {
    const { email, password } = req.body;

    try {
        const db = await getDB();
        const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);

        if (!user) {
            await db.run('INSERT INTO login_logs (email, status) VALUES (?, ?)', [email, 'FAILED_USER_NOT_FOUND']);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (user.is_blocked) {
            await db.run('INSERT INTO login_logs (email, status) VALUES (?, ?)', [email, 'FAILED_BLOCKED']);
            return res.status(403).json({ error: 'Account is blocked' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            await db.run('INSERT INTO login_logs (email, status) VALUES (?, ?)', [email, 'FAILED_BAD_PASSWORD']);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Update last login
        await db.run('UPDATE users SET last_login = ? WHERE id = ?', [new Date().toISOString(), user.id]);
        await db.run('INSERT INTO login_logs (email, status) VALUES (?, ?)', [email, 'SUCCESS']);

        const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
    } catch (error) {
        console.error('Login error:', error);
        console.error('Error stack:', error.stack);
        res.status(500).json({ error: 'Internal server error: ' + error.message, stack: error.stack });
    }
};

exports.adminGetUsers = async (req, res) => {
    try {
        const db = await getDB();
        const users = await db.all('SELECT id, email, role, is_blocked, last_login, created_at FROM users');
        res.json(users);
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

exports.adminToggleBlock = async (req, res) => {
    const { id, is_blocked } = req.body;
    try {
        const db = await getDB();
        await db.run('UPDATE users SET is_blocked = ? WHERE id = ?', [is_blocked ? 1 : 0, id]);
        res.json({ message: `User ${is_blocked ? 'blocked' : 'unblocked'} successfully` });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
};

exports.adminGenerateCode = async (req, res) => {
    try {
        const db = await getDB();
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        await db.run('INSERT INTO registration_codes (code) VALUES (?)', [code]);
        res.json({ code });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
};
