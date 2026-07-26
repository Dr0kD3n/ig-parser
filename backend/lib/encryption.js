const crypto = require('crypto');
const { JWT_SECRET } = require('./auth-config');

// Derive a 32-byte key from the JWT_SECRET
const ENCRYPTION_KEY = crypto.createHash('sha256').update(JWT_SECRET).digest();
const IV_LENGTH = 16;

function isEncrypted(text) {
    if (!text || !text.includes(':')) return false;
    const ivHex = text.split(':')[0];
    return ivHex.length === 32 && /^[0-9a-fA-F]+$/.test(ivHex);
}

function encrypt(text) {
    if (!text) return text;
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/** Шифрует только plaintext — не ломает уже зашифрованное значение */
function encryptSafe(text) {
    if (!text) return text;
    return isEncrypted(text) ? text : encrypt(text);
}

function decrypt(text) {
    if (!text || !text.includes(':')) return text;
    const parts = text.split(':');
    const ivHex = parts[0];

    // For aes-256-cbc, IV must be 16 bytes (32 hex characters)
    if (ivHex.length !== 32 || !/^[0-9a-fA-F]+$/.test(ivHex)) {
        return text;
    }

    try {
        const iv = Buffer.from(ivHex, 'hex');
        if (iv.length !== 16) return text;

        const encryptedText = Buffer.from(parts.slice(1).join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        // Return original text if decryption fails (e.g. wrong key or corrupted data)
        return text;
    }
}

module.exports = { encrypt, decrypt, encryptSafe, isEncrypted };
