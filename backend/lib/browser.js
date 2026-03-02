const playwright_extra_1 = require("playwright-extra");
const stealth = require('puppeteer-extra-plugin-stealth')();
const path_1 = require("path");
const utils_1 = require("./utils");
const { FingerprintGenerator } = require('fingerprint-generator');
const { FingerprintInjector } = require('fingerprint-injector');

const fingerprintGenerator = new FingerprintGenerator();
const fingerprintInjector = new FingerprintInjector();

module.exports = {
    createBrowserContext,
    optimizeContextForScraping,
    takeLiveScreenshot,
    startLiveView,
    checkLoginPage,
    humanMouseMove,
    humanClick,
    simulateHumanDistraction,
    watchStory
};

async function humanMouseMove(page, x, y) {
    const start = await page.evaluate(() => ({
        x: window.outerWidth / 2 + (Math.random() - 0.5) * 100,
        y: window.outerHeight / 2 + (Math.random() - 0.5) * 100
    })).catch(() => ({ x: 500, y: 500 }));

    const p0 = start;
    const p3 = { x, y };

    // Control points for Bezier curve (randomized for natural feel)
    const p1 = {
        x: p0.x + (p3.x - p0.x) * Math.random(),
        y: p0.y + (p3.y - p0.y) * 0.2
    };
    const p2 = {
        x: p0.x + (p3.x - p0.x) * 0.2,
        y: p0.y + (p3.y - p0.y) * Math.random()
    };

    const steps = 15 + Math.floor(Math.random() * 15);
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;

        // Cubic Bezier formula
        const curX = Math.pow(1 - t, 3) * p0.x +
            3 * Math.pow(1 - t, 2) * t * p1.x +
            3 * (1 - t) * Math.pow(t, 2) * p2.x +
            Math.pow(t, 3) * p3.x;

        const curY = Math.pow(1 - t, 3) * p0.y +
            3 * Math.pow(1 - t, 2) * t * p1.y +
            3 * (1 - t) * Math.pow(t, 2) * p2.y +
            Math.pow(t, 3) * p3.y;

        const jitterX = (Math.random() - 0.5) * 2;
        const jitterY = (Math.random() - 0.5) * 2;

        await page.mouse.move(curX + jitterX, curY + jitterY);
        await new Promise(r => setTimeout(r, 5 + Math.random() * 10));
    }
}

async function humanClick(page, selector) {
    try {
        const element = typeof selector === 'string' ? page.locator(selector).first() : selector;
        const box = await element.boundingBox();
        if (box) {
            const x = box.x + box.width * (0.2 + Math.random() * 0.6);
            const y = box.y + box.height * (0.2 + Math.random() * 0.6);
            await humanMouseMove(page, x, y);
            await new Promise(r => setTimeout(r, 100 + Math.random() * 200));
            await page.mouse.down();
            await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
            await page.mouse.up();
        } else {
            await element.click();
        }
    } catch (e) {
        console.warn('⚠️ [HUMAN] Ошибка клика:', e.message);
    }
}
// Disable user-agent evasion so our custom fingerprints take effect
stealth.enabledEvasions.delete('user-agent-override');
playwright_extra_1.firefox.use(stealth);
let globalBrowser = null;
async function getBrowser(headless, extraPrefs = {}) {
    if (!globalBrowser || !globalBrowser.isConnected()) {
        globalBrowser = await playwright_extra_1.firefox.launch({
            headless: headless,
            firefoxUserPrefs: {
                'intl.accept_languages': 'en-US,en;q=0.9',
                'general.useragent.locale': 'en-US',
                ...extraPrefs
            }
        });
    }
    return globalBrowser;
}
const REGIONAL_PROFILES = [
    { locale: 'en-US', timezoneId: 'America/New_York', acceptLang: 'en-US,en;q=0.9' },
    { locale: 'en-GB', timezoneId: 'Europe/London', acceptLang: 'en-GB,en;q=0.9' }
];
function getRegionalProfile(locale) {
    // Always return English profile
    return REGIONAL_PROFILES[Math.floor(Math.random() * REGIONAL_PROFILES.length)];
}
async function createBrowserContext(config, headless = true) {
    // Force English locale
    const reg = getRegionalProfile('en-US');

    const viewport = (config.fingerprint && config.fingerprint.viewport) || config.viewport || { width: 1280, height: 720 };
    const userAgent = (config.fingerprint && config.fingerprint.userAgent) || config.userAgent;
    const timezoneId = (config.fingerprint && config.fingerprint.timezoneId) || config.timezoneId || reg.timezoneId;
    const locale = 'en-US';
    const deviceScaleFactor = (config.fingerprint && config.fingerprint.deviceScaleFactor) || 1;

    const contextOptions = {
        viewport: viewport,
        userAgent: userAgent,
        timezoneId: timezoneId,
        locale: locale,
        colorScheme: config.colorScheme || 'dark',
        deviceScaleFactor: deviceScaleFactor,
        extraHTTPHeaders: {
            'Accept-Language': reg.acceptLang,
            'Content-Language': locale
        },
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

    if (config.id) {
        // Persistent context for a specific account profile
        const userDataDir = path_1.join(utils_1.getRootPath(), 'data', 'profiles', config.id);

        context = await playwright_extra_1.firefox.launchPersistentContext(userDataDir, {
            headless: headless,
            ...contextOptions,
            firefoxUserPrefs: {
                'intl.accept_languages': 'en-US,en;q=0.9',
                'general.useragent.locale': 'en-US'
            }
        });
        browser = context.browser();
        console.log(`👤 [PROFILE] Запуск с постоянным профилем: ${config.id} (Firefox)`);
    } else {
        // Standard ephemeral context
        browser = await getBrowser(headless, {
            'intl.accept_languages': reg.acceptLang
        });
        context = await browser.newContext(contextOptions);
    }

    // Apply advanced fingerprint injection
    let fingerprint = (config.fingerprint && typeof config.fingerprint === 'object' ? config.fingerprint : null);

    if (!fingerprint || !fingerprint.fingerprint) {
        fingerprint = fingerprintGenerator.getFingerprint({
            devices: ['desktop'],
            operatingSystems: ['windows', 'macos'],
            locales: ['en-US']
        });

        // If the user provided a custom UA, override it in the newly generated fingerprint
        if (config.fingerprint && config.fingerprint.userAgent) {
            fingerprint.fingerprint.navigator.userAgent = config.fingerprint.userAgent;
            // Also update the top-level UA for the context options
            contextOptions.userAgent = config.fingerprint.userAgent;
        }
    }

    await fingerprintInjector.attachFingerprintToPlaywright(context, fingerprint);

    if (config.cookies && config.cookies.length > 0) {
        await context.addCookies(config.cookies).catch(e => {
            console.error('Ошибка при добавлении куки:', e.message);
        });
        console.log('✅ Куки применены к браузерному контексту.');
    }
    else {
        console.log('⚠️ Запуск без куки. Возможна переадресация на логин.');
    }

    if (config.local_storage) {
        try {
            const page = await context.newPage();
            const lsData = JSON.parse(config.local_storage);
            await page.addInitScript((ls) => {
                for (const [key, value] of Object.entries(ls)) {
                    window.localStorage.setItem(key, value);
                }
            }, lsData);
            await page.close();
            console.log('✅ LocalStorage применен.');
        } catch (e) {
            console.error('Ошибка при добавлении localStorage:', e.message);
        }
    }

    return { browser, context };
}
function optimizeContextForScraping(context) {
    // Блокируем только картинки и медиа для скорости
    return context.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media'].includes(type)) {
            route.abort();
        }
        else {
            route.continue();
        }
    });
}
const LIVE_VIEW_PATH = path_1.join(utils_1.getRootPath(), 'data', 'screenshots', 'live_view.jpg');
async function takeLiveScreenshot(page) {
    if (!page || page.isClosed())
        return;
    try {
        await page.screenshot({ path: LIVE_VIEW_PATH, type: 'jpeg', quality: 30 });
    }
    catch (e) {
        // Ignore screenshot errors
    }
}
function startLiveView(context) {
    const intervalId = setInterval(async () => {
        try {
            const pages = context.pages();
            if (pages.length > 0) {
                const activePage = pages[pages.length - 1];
                await takeLiveScreenshot(activePage);
            }
        }
        catch (e) {
            // Ignore screenshot errors
        }
    }, 2000); // 2 seconds to match frontend polling frequency
    return intervalId;
}
async function checkLoginPage(page) {
    const url = page.url();
    if (url.includes('/accounts/login/'))
        return true;
    // Check for login form elements as backup
    const loginInput = await page.$('input[name="username"], input[name="password"]');
    if (loginInput)
        return true;
    return false;
}
async function watchStory(page) {
    try {
        // Try to find story ring on profile page
        const storyRing = page.locator('header canvas, header [role="button"] img[alt*="profile picture"]').first();
        if (await storyRing.count() > 0) {
            console.log('👤 [HUMAN] Просмотр сторис...');
            await humanClick(page, storyRing);
            await new Promise(r => setTimeout(r, 3000 + Math.random() * 4000));
            // Close story (usually Escape works or clicking the X)
            await page.keyboard.press('Escape');
            await new Promise(r => setTimeout(r, 1000));
        }
    } catch (e) {
        console.warn('⚠️ [HUMAN] Не удалось посмотреть сторис:', e.message);
    }
}

async function simulateHumanDistraction(page) {
    try {
        console.log('👤 [HUMAN] Имитация отвлечения...');
        const actions = ['scroll', 'move', 'idle'];
        const action = actions[Math.floor(Math.random() * actions.length)];

        if (action === 'scroll') {
            const amount = 200 + Math.random() * 500;
            const dir = Math.random() > 0.3 ? 'down' : 'up';
            await require('./utils').humanScroll(page, null, dir, amount);
        } else if (action === 'move') {
            const x = Math.random() * 800;
            const y = Math.random() * 600;
            await humanMouseMove(page, x, y);
        } else {
            // Just idle
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
        }
    } catch (e) {
        // Ignore errors during distraction
    }
}
