const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();

// Disable user-agent evasion so our custom fingerprints take effect
stealth.enabledEvasions.delete('user-agent-override');

chromium.use(stealth);

let globalBrowser = null;

async function getBrowser(headless) {
    if (!globalBrowser || !globalBrowser.isConnected()) {
        globalBrowser = await chromium.launch({
            headless: headless,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-web-security',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-extensions',
                '--disable-background-networking',
                '--disable-default-apps',
                '--disable-sync',
                '--metrics-recording-only',
                '--no-first-run'
            ]
        });
    }
    return globalBrowser;
}

async function createBrowserContext(config, headless = true) {
    const browser = await getBrowser(headless);

    const contextOptions = {
        viewport: (config.fingerprint && config.fingerprint.viewport) || config.viewport || { width: 1280, height: 900 },
        userAgent: (config.fingerprint && config.fingerprint.userAgent) || config.userAgent,
        timezoneId: (config.fingerprint && config.fingerprint.timezoneId),
        locale: (config.fingerprint && config.fingerprint.locale),
        deviceScaleFactor: (config.fingerprint && config.fingerprint.deviceScaleFactor),
    };
    if (config.proxy) {
        contextOptions.proxy = {
            server: config.proxy.server,
            username: config.proxy.username,
            password: config.proxy.password
        };
    }

    const context = await browser.newContext(contextOptions);

    if (config.cookies && config.cookies.length > 0) {
        await context.addCookies(config.cookies);
        console.log('✅ Куки применены к браузерному контексту.');
    } else {
        console.log('⚠️ Запуск без куки. Возможна переадресация на логин.');
    }

    return { browser, context };
}

function optimizeContextForScraping(context) {
    // Блокируем только картинки и медиа для скорости
    return context.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media'].includes(type)) {
            route.abort();
        } else {
            route.continue();
        }
    });
}

const path = require('path');

function startLiveView(context) {
    const liveViewPath = path.join(__dirname, '..', '..', 'data', 'screenshots', 'live_view.jpg');
    const intervalId = setInterval(async () => {
        try {
            const pages = context.pages();
            if (pages.length > 0) {
                const activePage = pages[pages.length - 1];
                if (!activePage.isClosed()) {
                    await activePage.screenshot({ path: liveViewPath, type: 'jpeg', quality: 30 });
                }
            }
        } catch (e) {
            // Ignore screenshot errors (e.g. page closed midway)
        }
    }, 2000);
    return intervalId;
}

async function checkLoginPage(page) {
    const url = page.url();
    if (url.includes('/accounts/login/')) return true;

    // Check for login form elements as backup
    const loginInput = await page.$('input[name="username"], input[name="password"]');
    if (loginInput) return true;

    return false;
}

module.exports = {
    createBrowserContext,
    optimizeContextForScraping,
    startLiveView,
    checkLoginPage
};
