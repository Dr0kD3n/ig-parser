'use strict';

const crypto = require('crypto');
const path = require('path');
const fs = require('fs/promises');
const utils = require('./utils');

const KEY_BYTES = 32;
const IV_BYTES = 12;
const KEY_FILE = '.telegram-bot.key';

function getKeyPath() {
  return path.join(utils.getRootPath(), 'config', KEY_FILE);
}

async function getInstallationKey() {
  const keyPath = getKeyPath();
  try {
    const stored = await fs.readFile(keyPath, 'utf8');
    const key = Buffer.from(stored.trim(), 'base64');
    if (key.length !== KEY_BYTES) throw new Error('Некорректный installation key Telegram');
    return key;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const key = crypto.randomBytes(KEY_BYTES);
  await fs.mkdir(path.dirname(keyPath), { recursive: true });
  try {
    await fs.writeFile(keyPath, key.toString('base64'), { mode: 0o600, flag: 'wx' });
    return key;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const stored = await fs.readFile(keyPath, 'utf8');
    const existing = Buffer.from(stored.trim(), 'base64');
    if (existing.length !== KEY_BYTES) throw new Error('Некорректный installation key Telegram');
    return existing;
  }
}

function encryptToken(token, key) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(
    ':'
  );
}

function decryptToken(value, key) {
  const [version, ivBase64, tagBase64, ciphertextBase64] = String(value || '').split(':');
  if (version !== 'v1' || !ivBase64 || !tagBase64 || !ciphertextBase64) {
    throw new Error('Некорректный формат Telegram token');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivBase64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextBase64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

async function encryptTelegramToken(token) {
  return encryptToken(token, await getInstallationKey());
}

async function decryptTelegramToken(value) {
  return decryptToken(value, await getInstallationKey());
}

module.exports = {
  getKeyPath,
  getInstallationKey,
  encryptToken,
  decryptToken,
  encryptTelegramToken,
  decryptTelegramToken,
};
