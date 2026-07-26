const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { JWT_SECRET, LEGACY_JWT_SECRET } = require('./auth-config');
const { getRootPath } = require('./utils');

const VERSION = 'v2';
const GCM_IV_LENGTH = 12;
const LEGACY_IV_LENGTH = 16;
const KEY_FILE = path.join(process.env.APP_ROOT || getRootPath(), 'config', '.encryption-key');

function loadEncryptionSecret() {
  if (process.env.ENCRYPTION_SECRET) return process.env.ENCRYPTION_SECRET;
  if (process.env.NODE_ENV === 'test') return `test:${JWT_SECRET}`;

  try {
    const existing = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (existing) return existing;
    throw new Error('Encryption key file is empty');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[ENCRYPTION] ${error.message}; using JWT secret fallback`);
      return JWT_SECRET;
    }
  }

  try {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(KEY_FILE, generated, { flag: 'wx', mode: 0o600 });
    return generated;
  } catch (error) {
    if (error.code === 'EEXIST') {
      return fs.readFileSync(KEY_FILE, 'utf8').trim();
    }
    console.warn(`[ENCRYPTION] Cannot persist local key: ${error.message}; using JWT secret fallback`);
    return JWT_SECRET;
  }
}

const ENCRYPTION_KEY = crypto
  .createHash('sha256')
  .update(loadEncryptionSecret())
  .digest();
const LEGACY_ENCRYPTION_KEYS = [...new Set([JWT_SECRET, LEGACY_JWT_SECRET])].map((secret) =>
  crypto.createHash('sha256').update(secret).digest()
);

function isLegacyEncrypted(text) {
  if (!text || typeof text !== 'string') return false;
  const [ivHex, encryptedHex] = text.split(':');
  return (
    ivHex?.length === LEGACY_IV_LENGTH * 2 &&
    /^[0-9a-f]+$/i.test(ivHex) &&
    !!encryptedHex &&
    /^[0-9a-f]+$/i.test(encryptedHex)
  );
}

function isEncrypted(text) {
  if (!text || typeof text !== 'string') return false;
  if (text.startsWith(`${VERSION}:`)) {
    const [, ivHex, tagHex, encryptedHex] = text.split(':');
    return (
      ivHex?.length === GCM_IV_LENGTH * 2 &&
      tagHex?.length === 32 &&
      !!encryptedHex &&
      [ivHex, tagHex, encryptedHex].every((part) => /^[0-9a-f]+$/i.test(part))
    );
  }
  return isLegacyEncrypted(text);
}

function encrypt(text) {
  if (!text) return text;
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION, iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(
    ':'
  );
}

/** Шифрует только plaintext — не ломает уже зашифрованное значение. */
function encryptSafe(text) {
  if (!text) return text;
  return isEncrypted(text) ? text : encrypt(text);
}

function decryptV2(text) {
  const [, ivHex, tagHex, encryptedHex] = text.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    ENCRYPTION_KEY,
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

function decryptLegacy(text) {
  const [ivHex, ...encryptedParts] = text.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedParts.join(':'), 'hex');
  for (const key of LEGACY_ENCRYPTION_KEYS) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      // Try next historical key.
    }
  }
  throw new Error('Legacy ciphertext cannot be decrypted');
}

function decrypt(text) {
  if (!isEncrypted(text)) return text;
  try {
    return text.startsWith(`${VERSION}:`) ? decryptV2(text) : decryptLegacy(text);
  } catch {
    return text;
  }
}

module.exports = { encrypt, decrypt, encryptSafe, isEncrypted };
