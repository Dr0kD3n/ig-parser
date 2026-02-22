const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

let globalBrowser = null;

async function getBrowser(headless) {
    if (!globalBrowser) {
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
        viewport: config.viewport || { width: 1280, height: 900 },
        userAgent: config.userAgent
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


module.exports = {
    createBrowserContext,
    optimizeContextForScraping
};
