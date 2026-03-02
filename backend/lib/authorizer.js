const { firefox } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { getDB } = require('./db');
const path = require('path');
const fs = require('fs');
const { getRootPath } = require('./utils');
const { FingerprintGenerator } = require('fingerprint-generator');
const { FingerprintInjector } = require('fingerprint-injector');

const fingerprintGenerator = new FingerprintGenerator();
const fingerprintInjector = new FingerprintInjector();

firefox.use(stealth);

let activeAuthorizers = new Map();

async function startAuthorization(accountId, name, proxyStr, savedFingerprint = null, isLogin = true) {
    if (activeAuthorizers.has(accountId)) {
        return { success: false, error: 'Authorization already in progress' };
    }

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

    const userDataDir = path.join(getRootPath(), 'data', 'profiles', accountId);

    const browserContext = await firefox.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: savedFingerprint?.viewport || { width: 1280, height: 720 },
        userAgent: savedFingerprint?.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
        proxy: proxy || undefined,
        locale: 'en-US',
        firefoxUserPrefs: {
            'intl.accept_languages': 'en-US,en;q=0.9',
            'general.useragent.locale': 'en-US'
        }
    });

    activeAuthorizers.set(accountId, browserContext);

    browserContext.on('close', () => {
        activeAuthorizers.delete(accountId);
    });

    try {
        // Apply advanced fingerprint injection
        let fingerprint = savedFingerprint;
        if (!fingerprint || !fingerprint.fingerprint) {
            fingerprint = fingerprintGenerator.getFingerprint({
                devices: ['desktop'],
                operatingSystems: ['windows', 'macos'],
                locales: ['en-US']
            });
            if (savedFingerprint && savedFingerprint.userAgent) {
                fingerprint.fingerprint.navigator.userAgent = savedFingerprint.userAgent;
            }
        }
        await fingerprintInjector.attachFingerprintToPlaywright(browserContext, fingerprint);

        const page = await browserContext.newPage();

        if (isLogin) {
            // 1. Expose bridge functions to the context (must be done before navigation/init scripts)
            await browserContext.exposeFunction('getInstagramCookies', async () => {
                return await browserContext.cookies();
            });

            await browserContext.exposeFunction('onInstagramSave', async (data) => {
                try {
                    const db = await getDB();
                    await db.run(
                        'UPDATE accounts SET cookies = ?, local_storage = ? WHERE id = ?',
                        [JSON.stringify(data.cookies), data.localStorage, accountId]
                    );
                    console.log(`✅ Session saved for account: ${name} (${accountId})`);
                    await browserContext.close();
                    activeAuthorizers.delete(accountId);
                } catch (e) {
                    console.error('Error saving session:', e);
                }
            });

            // 2. Inject helper and UI Button via addInitScript (persists across navigations)
            await page.addInitScript(() => {
                // Helper for backend usage
                window['saveInstagramSession'] = async () => {
                    const cookies = await window['getInstagramCookies']();
                    const localStorageData = JSON.stringify(window.localStorage);
                    return { cookies, localStorageData };
                };

                // UI Button Logic
                const injectButton = () => {
                    if (document.getElementById('save-session-btn')) return;

                    const btn = document.createElement('button');
                    btn.innerHTML = 'СОХРАНИТЬ СЕССИЮ';
                    btn.id = 'save-session-btn';
                    btn.style.position = 'fixed';
                    btn.style.bottom = '20px';
                    btn.style.right = '20px';
                    btn.style.zIndex = '999999';
                    btn.style.padding = '15px 25px';
                    btn.style.background = '#0095f6';
                    btn.style.color = 'white';
                    btn.style.border = 'none';
                    btn.style.borderRadius = '8px';
                    btn.style.cursor = 'pointer';
                    btn.style.fontWeight = 'bold';
                    btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';

                    btn.onclick = async () => {
                        btn.disabled = true;
                        btn.innerHTML = 'СОХРАНЕНИЕ...';
                        try {
                            const data = {
                                cookies: await window['getInstagramCookies'](),
                                localStorage: JSON.stringify(window.localStorage)
                            };
                            window['onInstagramSave'](data);
                        } catch (e) {
                            alert('Ошибка сохранения: ' + e.message);
                            btn.disabled = false;
                            btn.innerHTML = 'СОХРАНИТЬ СЕССИЮ';
                        }
                    };
                    document.body.appendChild(btn);
                };

                // Initial injection
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', injectButton);
                } else {
                    injectButton();
                }

                // Persistence check (for SPAs that wipe the DOM)
                setInterval(injectButton, 2000);
            });

            console.log(`[Authorizer] Navigating to Instagram for ${name}...`);
            try {
                const response = await page.goto('https://www.instagram.com/', {
                    waitUntil: 'domcontentloaded', // Faster initial load, init scripts will handle the button
                    timeout: 60000
                });

                if (response) {
                    const status = response.status();
                    console.log(`[Authorizer] Status: ${status}`);
                    if (status >= 400) {
                        console.error(`[Authorizer] Failed to load page. Status: ${status}`);
                    }
                }
            } catch (error) {
                console.error(`[Authorizer] Navigation error: ${error.message}`);
            }
        } else {
            console.log(`[Browser] Opening generic browser for ${name}...`);
            try {
                await page.goto('https://www.google.com/', {
                    waitUntil: 'domcontentloaded',
                    timeout: 60000
                });
            } catch (error) {
                console.error(`[Browser] Navigation error: ${error.message}`);
            }
        }

    } catch (error) {
        console.error(`[Authorizer] Initialization error: ${error.message}`);
        await browserContext.close();
        activeAuthorizers.delete(accountId);
        return { success: false, error: `Initialization failed: ${error.message}` };
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

module.exports = {
    startAuthorization,
    stopAuthorization,
    getAuthorizationStatus
};
