const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getRootPath } = require('./utils');

const LEGACY_JWT_SECRET = 'dev_secret_only_for_local_testing';
const AUTH_KEY_FILE = path.join(process.env.APP_ROOT || getRootPath(), 'config', '.auth-key');

function loadJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'test') return LEGACY_JWT_SECRET;

  try {
    const existing = fs.readFileSync(AUTH_KEY_FILE, 'utf8').trim();
    if (existing) return existing;
    throw new Error('Authentication key file is empty');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[AUTH] ${error.message}; using a process-local secret`);
      return crypto.randomBytes(48).toString('base64url');
    }
  }

  try {
    fs.mkdirSync(path.dirname(AUTH_KEY_FILE), { recursive: true });
    const generated = crypto.randomBytes(48).toString('base64url');
    fs.writeFileSync(AUTH_KEY_FILE, generated, { flag: 'wx', mode: 0o600 });
    return generated;
  } catch (error) {
    if (error.code === 'EEXIST') {
      return fs.readFileSync(AUTH_KEY_FILE, 'utf8').trim();
    }
    console.warn(`[AUTH] Cannot persist local key: ${error.message}; using a process-local secret`);
    return crypto.randomBytes(48).toString('base64url');
  }
}

module.exports = {
  JWT_SECRET: loadJwtSecret(),
  JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY || null,
  IS_ASYMMETRIC: process.env.IS_ASYMMETRIC === 'true',
  LEGACY_JWT_SECRET,
};
