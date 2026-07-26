'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.getAuthorizationStatus = exports.stopAuthorization = exports.startAuthorization = void 0;

const playwright_extra_1 = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const { getDB } = require('./db');
const { parseProxyString } = require('./utils');

playwright_extra_1.chromium.use(stealth);

const { createBrowserContext } = require('./browser');
const { dismissBlockingModals, watchBlockingModals } = require('./instagram-overlays');
const {
  tryAcquireInstagramActivity,
  releaseInstagramActivity,
  getInstagramActivity,
} = require('./instagram-activity');

let activeAuthorizers = new Map();
let authorizerLeases = new Map();

function hasAccountCookies(cookies) {
  if (!cookies) return false;
  if (Array.isArray(cookies)) return cookies.length > 0;
  if (typeof cookies === 'string') {
    const raw = cookies.trim();
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.length > 0 : !!parsed;
    } catch (_) {
      return raw.length > 0;
    }
  }
  return false;
}

async function openPageAndDismissModals(page) {
  await waitForPageReady(page);
  await dismissBlockingModals(page);
  watchBlockingModals(page);
}

async function waitForPageReady(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
}

async function startAuthorization(
  accountId,
  name,
  proxyStr,
  savedFingerprint = null,
  isLogin = true,
  cookies = null,
  localStorage = null
) {
  if (activeAuthorizers.has(accountId)) {
    return { success: false, error: 'Authorization already in progress' };
  }
  const activityLease = tryAcquireInstagramActivity(`authorizer:${accountId}`);
  if (!activityLease) {
    return {
      success: false,
      error: `Instagram activity already running: ${getInstagramActivity()?.type || 'unknown'}`,
    };
  }

  let browser;
  let context;

  try {
    const proxy = parseProxyString(proxyStr);
    const config = {
      id: accountId,
      proxy: proxy,
      fingerprint: savedFingerprint,
      cookies: cookies,
      local_storage: localStorage,
    };

    const result = await createBrowserContext(config, false); // headless: false for authorizer
    browser = result.browser;
    context = result.context;
  } catch (e) {
    releaseInstagramActivity(activityLease);
    return { success: false, error: `Failed to launch browser: ${e.message}` };
  }

  activeAuthorizers.set(accountId, context);
  authorizerLeases.set(accountId, activityLease);
  context.on('close', () => {
    activeAuthorizers.delete(accountId);
    releaseInstagramActivity(authorizerLeases.get(accountId));
    authorizerLeases.delete(accountId);
  });

  try {
    const page = context.pages()[0] || (await context.newPage());

    if (isLogin) {
      await context.exposeFunction('getInstagramCookies', async () => await context.cookies());
      await context.exposeFunction('onInstagramSave', async (data) => {
        try {
          const db = await getDB();
          await db.run('UPDATE accounts SET cookies = ?, local_storage = ? WHERE id = ?', [
            JSON.stringify(data.cookies),
            data.localStorage,
            accountId,
          ]);
          console.log(`✅ Session saved for account: ${name}`);
          await context.close();
        } catch (e) {
          console.error('Error saving session:', e);
        }
      });

      const injectionCode = `
                (function() {
                    console.log('🚀 [AUTHORIZER] Init script started');
                    const inject = () => {
                        if (window.self !== window.top) return;
                        if (document.getElementById('save-session-btn')) return;
                        
                        const target = document.body || document.documentElement;
                        if (!target) return;

                        const btn = document.createElement('button');
                        btn.id = 'save-session-btn';
                        btn.textContent = 'СОХРАНИТЬ СЕССИЮ';
                        
                        // Ultra-aggressive styling to bypass any page styles
                        const styles = {
                            position: 'fixed', bottom: '30px', right: '30px', zIndex: '2147483647',
                            padding: '16px 28px', background: '#0095f6', color: 'white',
                            border: '2px solid rgba(255,255,255,0.3)', borderRadius: '12px', 
                            cursor: 'pointer', fontWeight: '800', fontSize: '15px',
                            boxShadow: '0 8px 32px rgba(0,0,0,0.5)', display: 'block',
                            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
                        };
                        
                        Object.entries(styles).forEach(([k, v]) => btn.style.setProperty(k, v, 'important'));
                        
                        btn.onclick = async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            btn.disabled = true;
                            btn.textContent = 'СОХРАНЕНИЕ...';
                            try {
                                const data = {
                                    cookies: await window['getInstagramCookies'](),
                                    localStorage: JSON.stringify(window.localStorage)
                                };
                                await window['onInstagramSave'](data);
                                btn.textContent = 'СОХРАНЕНО!';
                            } catch (err) {
                                alert('Ошибка сохранения: ' + err.message);
                                btn.disabled = false;
                                btn.textContent = 'СОХРАНИТЬ СЕССИЮ';
                            }
                        };
                        
                        target.appendChild(btn);
                        console.log('✅ [AUTHORIZER] Save button injected into', target.tagName);
                    };

                    // Multi-layered trigger for robustness
                    if (document.readyState === 'loading') {
                        document.addEventListener('DOMContentLoaded', inject);
                    } else {
                        inject();
                    }
                    
                    const obs = new MutationObserver(() => {
                        if (!document.getElementById('save-session-btn')) inject();
                    });
                    obs.observe(document.documentElement, { childList: true, subtree: true });
                    
                    // Periodic hammer in case of aggressive SPA navigation/cleanup
                    setInterval(inject, 1000);
                })();
            `;

      await context.addInitScript(injectionCode);
      // Also evaluate immediately if page is already open (common in persistent contexts/Dolphin)
      await page.evaluate(injectionCode).catch(() => { });

      await page.goto('https://www.instagram.com/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });
      await openPageAndDismissModals(page);
    } else {
      try {
        if (hasAccountCookies(cookies)) {
          if (!/instagram\.com/i.test(page.url())) {
            await page.goto('https://www.instagram.com/', {
              waitUntil: 'domcontentloaded',
              timeout: 60000,
            });
          }
          await openPageAndDismissModals(page);
        } else if (context.pages().length === 0) {
          await context.newPage();
        } else {
          await page.goto('about:blank').catch(() => {});
        }
      } catch (e) {
        console.warn(`[Authorizer] Warning while opening browser page: ${e.message}`);
      }
    }
  } catch (error) {
    console.error(`[Authorizer] Error: ${error.message}`);
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

function getAuthorizationContext(accountId) {
  return activeAuthorizers.get(accountId);
}

exports.startAuthorization = startAuthorization;
exports.stopAuthorization = stopAuthorization;
exports.getAuthorizationStatus = getAuthorizationStatus;
exports.getAuthorizationContext = getAuthorizationContext;
