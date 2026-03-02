"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuthorizationStatus = exports.stopAuthorization = exports.startAuthorization = void 0;

const playwright_extra_1 = require('playwright-extra');
const { applyFingerprint } = require('./browser');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { getDB } = require('./db');
const path = require('path');
const fs = require('fs');
const { getRootPath } = require('./utils');
const http = require('http');

playwright_extra_1.chromium.use(stealth);

const { createBrowserContext } = require('./browser');

let activeAuthorizers = new Map();

async function startAuthorization(accountId, name, proxyStr, savedFingerprint = null, isLogin = true) {
    if (activeAuthorizers.has(accountId)) {
        return { success: false, error: 'Authorization already in progress' };
    }

    let browser;
    let context;

    try {
        let proxy = null;
        if (proxyStr) {
            const parts = proxyStr.trim().split(':');
            if (parts.length >= 4) {
                proxy = {
                    server: `http://${parts[0]}:${parts[1]}`,
                    username: parts[2],
                    password: parts[3]
                };
            }
        }

        const config = {
            id: accountId,
            proxy: proxy,
            fingerprint: savedFingerprint
        };

        const result = await createBrowserContext(config, false); // headless: false for authorizer
        browser = result.browser;
        context = result.context;

    } catch (e) {
        return { success: false, error: `Failed to launch browser: ${e.message}` };
    }

    activeAuthorizers.set(accountId, context);
    context.on('close', () => activeAuthorizers.delete(accountId));

    try {
        const page = context.pages()[0] || await context.newPage();

        if (isLogin) {
            await context.exposeFunction('getInstagramCookies', async () => await context.cookies());
            await context.exposeFunction('onInstagramSave', async (data) => {
                try {
                    const db = await getDB();
                    await db.run('UPDATE accounts SET cookies = ?, local_storage = ? WHERE id = ?', [JSON.stringify(data.cookies), data.localStorage, accountId]);
                    console.log(`✅ Session saved for account: ${name}`);
                    await context.close();
                } catch (e) { console.error('Error saving session:', e); }
            });

            await page.addInitScript(() => {
                if (window.self !== window.top) return;
                const injectButton = () => {
                    if (document.getElementById('save-session-btn')) return;
                    const btn = document.createElement('button');
                    btn.innerHTML = 'СОХРАНИТЬ СЕССИЮ';
                    btn.id = 'save-session-btn';
                    btn.style = "position:fixed;bottom:20px;right:20px;z-index:9999;padding:15px 25px;background:#0095f6;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;";
                    btn.onclick = async () => {
                        btn.disabled = true; btn.innerHTML = 'СОХРАНЕНИЕ...';
                        try {
                            const data = { cookies: await window['getInstagramCookies'](), localStorage: JSON.stringify(window.localStorage) };
                            window['onInstagramSave'](data);
                        } catch (e) { alert('Ошибка: ' + e.message); btn.disabled = false; btn.innerHTML = 'СОХРАНИТЬ СЕССИЮ'; }
                    };
                    document.body.appendChild(btn);
                };
                setInterval(injectButton, 2000);
            });

            await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        } else {
            // "Open Browser" mode: Ensure we have at least one page and navigate to a safe URL
            // This stops any unintended autostart pages (like google.com from last session)
            try {
                if (context.pages().length === 0) {
                    await context.newPage();
                } else {
                    // Force the first page to about:blank to stop any background navigations
                    // that might cause ERR_ABORTED if we interact with them later
                    await context.pages()[0].goto('about:blank').catch(() => { });
                }
            } catch (e) {
                console.warn(`[Authorizer] Warning while opening blank page: ${e.message}`);
            }
        }
    } catch (error) {
        console.error(`[Authorizer] Error: ${error.message}`);
        // If it's just a navigation error in "Open" mode, maybe don't close the browser?
        // But for now, we keep the original behavior to be safe.
        await context.close();
        return { success: false, error: error.message };
    }

    return { success: true };
}

async function stopAuthorization(accountId) {
    const context = activeAuthorizers.get(accountId);
    if (context) {
        await context.close();
        activeAuthorizers.delete(accountId);
        return { success: true };
    }
    return { success: false, error: 'No active session found' };
}

function getAuthorizationStatus(accountId) {
    return activeAuthorizers.has(accountId);
}

exports.startAuthorization = startAuthorization;
exports.stopAuthorization = stopAuthorization;
exports.getAuthorizationStatus = getAuthorizationStatus;
