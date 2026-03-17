'use strict';
const path_1 = require('path');
Object.defineProperty(exports, '__esModule', { value: true });
exports.normalizeUrl = exports.getConfigPath = void 0;
exports.getProxy = getProxy;
exports.getCookies = getCookies;
exports.getList = getList;
exports.getSetting = getSetting;
exports.getAllAccounts = getAllAccounts;

const db_1 = require('./db');
const utils_1 = require('./utils');
const { decrypt } = require('./encryption');
// Оставляем для совместимости, хотя новые методы используют БД
const getConfigPath = (fileName) => path_1.join((0, utils_1.getRootPath)(), 'config', fileName);
exports.getConfigPath = getConfigPath;
// Нормализация ссылок (убирает слэши на конце и параметры)
const normalizeUrl = (url) => {
  try {
    return new URL(url).href.split('?')[0].replace(/\/$/, '');
  } catch {
    return url.replace(/\/$/, '');
  }
};
exports.normalizeUrl = normalizeUrl;
async function getProxy(type = '') {
  try {
    const db = await (0, db_1.getDB)();
    let column;
    if (type === 'server') column = 'active_server';
    else if (type === 'index') column = 'active_index';
    else if (type === 'profiles' || type === 'donors') column = 'active_profiles';
    else if (type === 'checker') column = 'active_checker';
    else if (type === 'parser') column = 'active_parser';
    if (!column) return null;
    const row = await db.get(
      `SELECT proxy FROM accounts WHERE ${column} > 0 ORDER BY ${column} ASC LIMIT 1`
    );
    if (!row || !row.proxy) return null;
    const proxyStr = decrypt(row.proxy);
    const parts = proxyStr.trim().split(':');
    if (parts.length < 4) return null;
    return {
      server: `http://${parts[0]}:${parts[1]}`,
      username: parts[2],
      password: parts[3],
    };
  } catch (e) {
    return null;
  }
}
async function getCookies(type = '') {
  try {
    const db = await (0, db_1.getDB)();
    let column;
    if (type === 'server') column = 'active_server';
    else if (type === 'index') column = 'active_index';
    else if (type === 'profiles' || type === 'donors') column = 'active_profiles';
    else if (type === 'checker') column = 'active_checker';
    else if (type === 'parser') column = 'active_parser';
    if (!column) return [];
    const row = await db.get(
      `SELECT cookies FROM accounts WHERE ${column} > 0 ORDER BY ${column} ASC LIMIT 1`
    );
    if (!row || !row.cookies) return [];
    const raw = decrypt(row.cookies);
    const cookies = [];
    const names = [
      'csrftoken',
      'datr',
      'ds_user_id',
      'ig_did',
      'mid',
      'sessionid',
      'rur',
      'wd',
      'ig_nrcb',
    ];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed; // Return all cookies, don't filter only Instagram ones
      }
    } catch (e) { }
    names.forEach((name) => {
      const regex = new RegExp(`(?:^|\\s|;|:)${name}(?:\\s*[:=]\\s*|\\s+)([^;\\n\\r]+)`, 'i');
      const match = raw.match(regex);
      if (match && match[1]) {
        let value = match[1].trim();
        if (value.includes('.instagram.com')) value = value.split('.instagram.com')[0].trim();
        if (value.includes(' ')) value = value.split(' ')[0].trim();
        if (value) {
          cookies.push({
            name: name,
            value: value,
            domain: '.instagram.com',
            path: '/',
            secure: true,
            sameSite: 'None',
          });
        }
      }
    });
    return cookies;
  } catch (e) {
    return [];
  }
}
async function getList(fileName) {
  try {
    const db = await (0, db_1.getDB)();
    let type = '';
    if (fileName === 'names.txt') type = 'name';
    else if (fileName === 'cityKeywords.txt') type = 'city';
    else if (fileName === 'nicheKeywords.txt') type = 'niche';
    else return [];
    const rows = await db.all(`SELECT value FROM keywords WHERE type = ?`, [type]);
    return rows.map((r) => r.value);
  } catch (e) {
    console.error('getList error:', e);
    return [];
  }
}
async function getSetting(key) {
  try {
    const db = await (0, db_1.getDB)();
    const row = await db.get(`SELECT value FROM settings WHERE key = ?`, [key]);
    if (!row) return null;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  } catch (e) {
    return null;
  }
}
async function getAllAccounts(type = '') {
  try {
    const db = await (0, db_1.getDB)();
    let column;
    if (type === 'server') column = 'active_server';
    else if (type === 'index') column = 'active_index';
    else if (type === 'profiles' || type === 'donors') column = 'active_profiles';
    else if (type === 'checker') column = 'active_checker';
    else if (type === 'parser') column = 'active_parser';
    if (!column) return [];
    const rows = await db.all(
      `SELECT id, name, proxy, cookies, fingerprint, local_storage FROM accounts WHERE ${column} > 0 ORDER BY ${column} ASC`
    );
    if (!rows || rows.length === 0) return [];
    return rows.map((row) => {
      let proxyObj = null;
      if (row.proxy) {
        const proxyStr = decrypt(row.proxy);
        const parts = proxyStr.trim().split(':');
        if (parts.length >= 4) {
          proxyObj = {
            server: `http://${parts[0]}:${parts[1]}`,
            username: parts[2],
            password: parts[3],
          };
        }
      }
      let cookiesArr = [];
      if (row.cookies) {
        const raw = decrypt(row.cookies);
        const names = [
          'csrftoken',
          'datr',
          'ds_user_id',
          'ig_did',
          'mid',
          'sessionid',
          'rur',
          'wd',
          'ig_nrcb',
        ];
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            cookiesArr = parsed; // Preserve all cookies for the UI/storage
          }
        } catch (e) {
          names.forEach((name) => {
            const regex = new RegExp(`(?:^|\\s|;|:)${name}(?:\\s*[:=]\\s*|\\s+)([^;\\n\\r]+)`, 'i');
            const match = raw.match(regex);
            if (match && match[1]) {
              let value = match[1].trim();
              if (value.includes('.instagram.com')) value = value.split('.instagram.com')[0].trim();
              if (value.includes(' ')) value = value.split(' ')[0].trim();
              if (value) {
                cookiesArr.push({
                  name: name,
                  value: value,
                  domain: '.instagram.com',
                  path: '/',
                  secure: true,
                  sameSite: 'None',
                });
              }
            }
          });
        }
      }
      let fingerprintObj = null;
      if (row.fingerprint) {
        try {
          fingerprintObj = JSON.parse(row.fingerprint);
        } catch (e) {
          console.error('Error parsing fingerprint:', e);
        }
      }
      return {
        id: row.id,
        name: row.name,
        proxy: proxyObj,
        cookies: cookiesArr,
        fingerprint: fingerprintObj,
        local_storage: row.local_storage,
      };
    });
  } catch (e) {
    return [];
  }
}
