"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const playwright_extra_1 = require("playwright-extra");
const stealth = require('puppeteer-extra-plugin-stealth')();
const path_1 = require("path");
const utils_1 = require("./utils");
const { FingerprintGenerator } = require('fingerprint-generator');
const { FingerprintInjector } = require('fingerprint-injector');
const http = require('http');

const fingerprintGenerator = new FingerprintGenerator();
const fingerprintInjector = new FingerprintInjector();

playwright_extra_1.chromium.use(stealth);

async function createBrowserContext(config, headless = true) {
    const viewport = (config.fingerprint && config.fingerprint.viewport) || config.viewport || { width: 1280, height: 720 };
    const userAgent = (config.fingerprint && config.fingerprint.userAgent) || config.userAgent;
    const locale = 'en-US';

    const contextOptions = {
        viewport,
        userAgent,
        locale,
        colorScheme: config.colorScheme || 'dark',
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
    };

    if (config.proxy) {
        contextOptions.proxy = {
            server: config.proxy.server,
            username: config.proxy.username,
            password: config.proxy.password
        };
    }

    let browser;
    let context;

    // Dolphin Anty Integration
    let dolphinToken = config.fingerprint?.dolphinToken;
    const dolphinProfileId = config.fingerprint?.dolphinProfileId;

    if (!dolphinToken && dolphinProfileId) {
        try {
            const { getDB } = require('./db');
            const db = await getDB();
            const row = await db.get(`SELECT value FROM settings WHERE key = 'dolphinToken'`);
            if (row?.value) {
                dolphinToken = row.value;
            }
        } catch (e) {
            console.error('Error fetching global dolphin token:', e);
        }
    }

    let dolphinSuccess = false;
    if (dolphinToken && dolphinProfileId) {
        try {
            console.log(`🐬 [DOLPHIN] Launching profile: ${dolphinProfileId}`);
            const launchUrl = `http://127.0.0.1:3001/v1.0/browser_profiles/${dolphinProfileId}/start?automation=1`;
            const launchResult = await new Promise((resolve, reject) => {
                const req = http.get(launchUrl, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
                        } catch (e) {
                            resolve({ statusCode: res.statusCode, data: { success: false, message: 'Invalid JSON' } });
                        }
                    });
                }).on('error', reject);
                req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
            });

            if (launchResult.statusCode === 200 && launchResult.data.success && launchResult.data.automation?.wsEndpoint) {
                browser = await playwright_extra_1.chromium.connectOverCDP(launchResult.data.automation.wsEndpoint);
                context = browser.contexts()[0];
                dolphinSuccess = true;
            } else if (launchResult.statusCode === 402 || launchResult.data.error?.includes('free plan')) {
                console.warn(`⚠️ [DOLPHIN] Automation restricted (Free Plan). Falling back to local browser (Nightly).`);
            } else {
                console.error(`❌ [DOLPHIN] Launch failed: ${launchResult.data.message || launchResult.data.error || 'Unknown error'}`);
                console.warn(`⚠️ Falling back to local browser.`);
            }
        } catch (e) {
            console.error(`❌ [DOLPHIN] Connection error: ${e.message}`);
            console.warn(`⚠️ Falling back to local browser.`);
        }
    } else if (dolphinProfileId || dolphinToken) {
        console.warn(`⚠️ [DOLPHIN] Missing token or profile ID. Falling back to local browser.`);
    }

    if (!dolphinSuccess) {
        if (config.id) {
            const userDataDir = path_1.join((0, utils_1.getRootPath)(), 'data', 'profiles', config.id);
            context = await playwright_extra_1.chromium.launchPersistentContext(userDataDir, {
                headless,
                ...contextOptions,
                args: [
                    '--lang=en-US',
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-infobars',
                    '--window-position=0,0',
                    '--ignore-certificate-errors',
                    '--ignore-certificate-errors-spki-list',
                    '--disable-web-security'
                ],
                ignoreDefaultArgs: ['--enable-automation']
            });
            browser = context.browser();
        } else {
            browser = await playwright_extra_1.chromium.launch({
                headless,
                args: ['--disable-blink-features=AutomationControlled'],
                ignoreDefaultArgs: ['--enable-automation']
            });
            context = await browser.newContext(contextOptions);
        }
    }

    await applyFingerprint(context, config.fingerprint);
    if (config.cookies) await context.addCookies(config.cookies).catch(() => { });

    return { browser, context };
}

async function applyFingerprint(context, fingerprint) {
    if (!fingerprint) return;

    // Inject base fingerprint (User Agent, Canvas, etc.)
    if (fingerprint.fingerprint) {
        await fingerprintInjector.attachFingerprintToPlaywright(context, fingerprint);
    }

    // Hardware Spoofing (CPU & Memory)
    if (fingerprint.hardware) {
        await context.addInitScript((hw) => {
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => hw.cpuCores || 8 });
            if (hw.memoryGB) {
                // @ts-ignore
                navigator.deviceMemory = hw.memoryGB;
            }
        }, fingerprint.hardware);
    }

    // WebGL Spoofing
    if (fingerprint.webgl) {
        await context.addInitScript((gl) => {
            const getParameter = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function (type, options) {
                const context = getParameter.apply(this, [type, options]);
                if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
                    const originalGetParameter = context.getParameter;
                    context.getParameter = function (param) {
                        if (param === 37445) return gl.vendor; // UNMASKED_VENDOR_WEBGL
                        if (param === 37446) return gl.renderer; // UNMASKED_RENDERER_WEBGL
                        return originalGetParameter.apply(this, [param]);
                    };
                }
                return context;
            };
        }, fingerprint.webgl);
    }

    // WebRTC Leak protection
    await context.addInitScript(() => {
        // @ts-ignore
        if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
            const originalEnumerateDevices = navigator.mediaDevices.enumerateDevices;
            navigator.mediaDevices.enumerateDevices = async function () {
                const devices = await originalEnumerateDevices.apply(this);
                return devices.filter(d => d.kind !== 'audioinput' && d.kind !== 'videoinput');
            };
        }
    });
}

function optimizeContextForScraping(context) {
    return context.route('**/*', (route) => {
        if (['image', 'media'].includes(route.request().resourceType())) route.abort();
        else route.continue();
    });
}

function startLiveView(context) {
    return setInterval(async () => {
        try {
            const pages = context.pages();
            if (pages.length > 0) {
                const liveViewPath = path_1.join((0, utils_1.getRootPath)(), 'data', 'screenshots', 'live_view.jpg');
                await pages[pages.length - 1].screenshot({ path: liveViewPath, type: 'jpeg', quality: 30 });
            }
        } catch (e) { }
    }, 2000);
}

async function takeLiveScreenshot(page) {
    try {
        const liveViewPath = path_1.join((0, utils_1.getRootPath)(), 'data', 'screenshots', 'live_view.jpg');
        await page.screenshot({ path: liveViewPath, type: 'jpeg', quality: 30 });
    } catch (e) { }
}

exports.createBrowserContext = createBrowserContext;
exports.applyFingerprint = applyFingerprint;
exports.optimizeContextForScraping = optimizeContextForScraping;
exports.startLiveView = startLiveView;
exports.takeLiveScreenshot = takeLiveScreenshot;
