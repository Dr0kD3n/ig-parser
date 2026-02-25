import { chromium, Browser, BrowserContext, Page } from 'playwright';
// @ts-ignore
import { firefox } from 'playwright-extra';
const stealth = require('puppeteer-extra-plugin-stealth')();
import path from 'path';

// Disable user-agent evasion so our custom fingerprints take effect
stealth.enabledEvasions.delete('user-agent-override');

firefox.use(stealth);

let globalBrowser: Browser | null = null;

async function getBrowser(headless: boolean, extraPrefs: any = {}): Promise<Browser> {
    if (!globalBrowser || !globalBrowser.isConnected()) {
        const firefoxUserPrefs = {
            'network.proxy.type': 0,
            'network.cookie.cookieBehavior': 0,
            'dom.webdriver.enabled': false,
            'usePrivacyResistFingerprinting': false,
            ...extraPrefs
        };
        globalBrowser = await firefox.launch({
            headless: headless,
            firefoxUserPrefs
        });
    }
    return globalBrowser!;
}

interface RegionalProfile {
    locale: string;
    timezoneId: string;
    acceptLang: string;
}

const REGIONAL_PROFILES: RegionalProfile[] = [
    { locale: 'en-US', timezoneId: 'America/New_York', acceptLang: 'en-US,en;q=0.9' },
    { locale: 'en-GB', timezoneId: 'Europe/London', acceptLang: 'en-GB,en;q=0.9' },
    { locale: 'ru-RU', timezoneId: 'Europe/Moscow', acceptLang: 'ru-RU,ru;q=0.9' },
    { locale: 'it-IT', timezoneId: 'Europe/Rome', acceptLang: 'it-IT,it;q=0.9,en;q=0.8' },
    { locale: 'fr-FR', timezoneId: 'Europe/Paris', acceptLang: 'fr-FR,fr;q=0.9,en;q=0.8' },
    { locale: 'de-DE', timezoneId: 'Europe/Berlin', acceptLang: 'de-DE,de;q=0.9,en;q=0.8' }
];

function getRegionalProfile(locale?: string): RegionalProfile {
    if (locale) {
        const profile = REGIONAL_PROFILES.find(p => p.locale === locale);
        if (profile) return profile;
    }
    return REGIONAL_PROFILES[Math.floor(Math.random() * REGIONAL_PROFILES.length)];
}

export async function createBrowserContext(config: any, headless: boolean = true): Promise<{ browser: Browser, context: BrowserContext }> {
    // Determine the target locale first
    const targetLocale = (config.fingerprint && config.fingerprint.locale) || config.locale;
    const reg = getRegionalProfile(targetLocale);

    const browser = await getBrowser(headless, {
        'intl.accept_languages': reg.acceptLang
    });

    const contextOptions: any = {
        viewport: (config.fingerprint && config.fingerprint.viewport) || config.viewport || { width: 1280, height: 720 },
        userAgent: (config.fingerprint && config.fingerprint.userAgent) || config.userAgent,
        timezoneId: (config.fingerprint && config.fingerprint.timezoneId) || config.timezoneId || reg.timezoneId,
        locale: targetLocale || reg.locale,
        colorScheme: config.colorScheme || 'dark',
        deviceScaleFactor: (config.fingerprint && config.fingerprint.deviceScaleFactor),
        extraHTTPHeaders: {
            'Accept-Language': reg.acceptLang,
            'Content-Language': targetLocale || reg.locale
        },
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

export function optimizeContextForScraping(context: BrowserContext) {
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

const LIVE_VIEW_PATH = path.join(__dirname, '..', '..', 'data', 'screenshots', 'live_view.jpg');

export async function takeLiveScreenshot(page: Page): Promise<void> {
    if (!page || page.isClosed()) return;
    try {
        await page.screenshot({ path: LIVE_VIEW_PATH, type: 'jpeg', quality: 30 });
    } catch (e: any) {
        // Ignore screenshot errors
    }
}

export function startLiveView(context: BrowserContext): NodeJS.Timeout {
    const intervalId = setInterval(async () => {
        try {
            const pages = context.pages();
            if (pages.length > 0) {
                const activePage = pages[pages.length - 1];
                await takeLiveScreenshot(activePage);
            }
        } catch (e: any) {
            // Ignore screenshot errors
        }
    }, 30000); // Reduce frequency to 30 seconds as a background fallback
    return intervalId;
}

export async function checkLoginPage(page: Page): Promise<boolean> {
    const url = page.url();
    if (url.includes('/accounts/login/')) return true;

    // Check for login form elements as backup
    const loginInput = await page.$('input[name="username"], input[name="password"]');
    if (loginInput) return true;

    return false;
}
