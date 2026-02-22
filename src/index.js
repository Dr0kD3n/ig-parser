const { chromium } = require('playwright');
const fs = require('fs/promises');
const path = require('path');

// ==========================================
// 1. ПАРСЕРЫ КОНФИГОВ (из папки ../config)
// ==========================================

const getConfigPath = (fileName) => path.join(__dirname, '..', 'config', fileName);

async function getProxy() {
    try {
        const data = await fs.readFile(getConfigPath('proxy.txt'), 'utf8');
        const parts = data.trim().split(':');
        if (parts.length < 4) return null;
        return {
            server: `http://${parts[0]}:${parts[1]}`,
            username: parts[2],
            password: parts[3]
        };
    } catch (e) {
        console.error('⚠️ Файл config/proxy.txt не найден или пуст.');
        return null;
    }
}

async function getCookies() {
    try {
        const raw = await fs.readFile(getConfigPath('cookies.txt'), 'utf8');
        const cookies = [];
        const names = ['csrftoken', 'datr', 'ds_user_id', 'ig_did', 'mid', 'sessionid', 'rur', 'wd'];

        names.forEach(name => {
            const regex = new RegExp(`${name}([^✓]+)`, 'i');
            const match = raw.match(regex);
            if (match) {
                let value = match[1].trim();
                if (value.includes('.instagram.com')) {
                    value = value.split('.instagram.com')[0];
                }
                cookies.push({
                    name: name,
                    value: value,
                    domain: '.instagram.com',
                    path: '/',
                    secure: true,
                    sameSite: 'None'
                });
            }
        });
        return cookies;
    } catch (e) {
        console.error('⚠️ Файл config/cookies.txt не найден.');
        return [];
    }
}

async function getList(fileName) {
    try {
        const data = await fs.readFile(getConfigPath(fileName), 'utf8');
        return data.trim().split(/\s+/).filter(Boolean);
    } catch (e) {
        console.error(`⚠️ Файл config/${fileName} не найден.`);
        return [];
    }
}

const getDynamicConfig = async () => {
    return {
        viewport: { width: 1280, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        timeouts: { pageLoad: 30000, element: 10000, inputWait: 6000 },
        scroll: { maxAttempts: 15, delay: 1500, maxRetries: 3 }, 
        proxy: await getProxy(),
        cookies: await getCookies(),
        target: {
            cityKeywords: await getList('cityKeywords.txt'),
            names: await getList('names.txt')
        }
    };
};

// ==========================================
// 2. STATE & STORAGE
// ==========================================

const PATHS = {
    HISTORY: path.join(__dirname, '..', 'processed_profiles.txt'),
    RESULTS: path.join(__dirname, '..', 'found_girls.json'),
};

const StateManager = {
    processed: new Set(),
    resultsCache: [], 

    async init() {
        try {
            const data = await fs.readFile(PATHS.HISTORY, 'utf8');
            this.processed = new Set(data.split('\n').filter(Boolean));
        } catch { await fs.writeFile(PATHS.HISTORY, ''); }

        try {
            const resultsData = await fs.readFile(PATHS.RESULTS, 'utf8');
            this.resultsCache = JSON.parse(resultsData);
        } catch { 
            this.resultsCache = []; 
            await fs.writeFile(PATHS.RESULTS, '[]');
        }
    },
    has(url) { return this.processed.has(url); },
    
    async add(url) {
        if (this.processed.has(url)) return;
        this.processed.add(url);
        await fs.appendFile(PATHS.HISTORY, `${url}\n`, 'utf8');
    },
    
    async saveResult(profileData) {
        this.resultsCache.push({ ...profileData, timestamp: new Date().toISOString() });
        await fs.writeFile(PATHS.RESULTS, JSON.stringify(this.resultsCache, null, 2), 'utf8');
        console.log(`✅ [НАЙДЕНА] ${profileData.name} (${profileData.url})`);
    },
    
    async loadDonors() {
        try {
            const data = await fs.readFile(getConfigPath('profiles.txt'), 'utf8');
            return data.split(/[\s\n\r]+/).filter(url => url.startsWith('http'));
        } catch { return []; }
    }
};

// ==========================================
// 3. SCRAPING LOGIC
// ==========================================

const SELECTORS = {
    HEADER: 'header',
    DIALOG: 'div[role="dialog"]',
    SEARCH_INPUT: 'div[role="dialog"] input', 
    FOLLOWERS_LINK: 'a[href*="/followers/"]',
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min = 1000, max = 3000) => wait(min + Math.random() * (max - min));

const extractVisibleCandidates = () => {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return [];
    const results = [];
    const canvases = dialog.querySelectorAll('canvas');
    canvases.forEach(canvas => {
        const storyBtn = canvas.closest('div[role="button"]');
        if (!storyBtn || storyBtn.getAttribute('aria-disabled') === 'true') return;
        let parent = storyBtn.parentElement;
        for (let i = 0; i < 6; i++) {
            if (!parent) break;
            const link = parent.querySelector('a[href^="/"]:not([role="button"])');
            if (link && link.innerText.trim().length > 0) {
                const href = link.getAttribute('href');
                if (href && !href.includes('followers')) results.push(`https://www.instagram.com${href}`);
                break;
            }
            parent = parent.parentElement;
        }
    });
    return results;
};

const scrollAndCollectUrls = async (page, config) => {
    const collectedUrls = new Set();
    let previousHeight = 0;
    let sameHeightCount = 0;

    for (let i = 0; i < config.scroll.maxAttempts; i++) {
        const visible = await page.evaluate(extractVisibleCandidates);
        visible.forEach(url => collectedUrls.add(url));

        const scrolledHeight = await page.evaluate(() => {
            const dialog = document.querySelector('div[role="dialog"]');
            const scrollable = dialog ? Array.from(dialog.querySelectorAll('div')).find(el => {
                const s = window.getComputedStyle(el);
                return (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
            }) : null;
            if (scrollable) { 
                scrollable.scrollTop = scrollable.scrollHeight; 
                return scrollable.scrollHeight; 
            }
            return false;
        });

        if (!scrolledHeight) {
            await page.mouse.wheel(0, 600);
        }
        
        await wait(config.scroll.delay);

        if (scrolledHeight === previousHeight) {
            sameHeightCount++;
            if (sameHeightCount >= config.scroll.maxRetries) {
                break; 
            }
            await wait(1500); // Ждем дольше, если контент подвисает
        } else { 
            sameHeightCount = 0; 
        }
        
        previousHeight = scrolledHeight;
    }
    return Array.from(collectedUrls);
};

const analyzeProfile = async (context, url, config) => {
    if (StateManager.has(url)) return;
    await StateManager.add(url);

    const page = await context.newPage();

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeouts.pageLoad });
        
        const isStoryActive = await page.evaluate(() => {
            const btn = document.querySelector('header div[role="button"] canvas')?.closest('div[role="button"]');
            return btn ? btn.getAttribute('aria-disabled') !== 'true' : false;
        });
        
        if (!isStoryActive) return;

        const bioText = await page.evaluate(() => {
            const header = document.querySelector('header section') || document.querySelector('header');
            return header ? header.innerText.replace(/\d+/g, ' ') : '';
        });

        const isTarget = config.target.cityKeywords.some(kw => bioText.toLowerCase().includes(kw.toLowerCase()));

        if (isTarget) {
            const name = await page.locator('header h2').first().innerText().catch(() => 'Unknown');
            const photo = await page.evaluate(() => {
                const img = document.querySelector('header img');
                if (img && img.srcset) {
                    const parts = img.srcset.split(',');
                    return parts[parts.length - 1].trim().split(' ')[0];
                }
                return img ? img.src : '';
            });
            await StateManager.saveResult({ name, bio: bioText.replace(/\n/g, ' '), photo, url });
        }
    } catch (e) {
        if (!e.message.includes('Timeout')) {
            console.error(`   ❌ Ошибка анализа ${url}: ${e.message.split('\n')[0]}`);
        }
    } finally {
        await page.close();
    }
};

const processDonor = async (context, donorUrl, config) => {
    console.log(`\n📂 ДОНОР: ${donorUrl}`);
    const page = await context.newPage();
    try {
        await page.goto(donorUrl, { waitUntil: 'domcontentloaded' });
        const followersBtn = page.locator(SELECTORS.FOLLOWERS_LINK);
        await followersBtn.waitFor({ state: 'visible' });
        await followersBtn.click();
        
        await page.waitForSelector('div[role="dialog"]');
        const searchInput = page.locator(SELECTORS.SEARCH_INPUT).first();
        await searchInput.waitFor({ state: 'visible', timeout: config.timeouts.inputWait });

        for (const name of config.target.names) {
            console.log(`   🔎 Поиск имени: "${name}"`);
            
            // Надежная очистка поля: тройной клик выделяет весь текст, затем Backspace
            await searchInput.click({ clickCount: 3 });
            await page.keyboard.press('Backspace');
            await wait(50); // Ожидаем, пока Instagram обновит список на дефолтный
            
            await searchInput.pressSequentially(name, { delay: 100 });
            await wait(500); 
            
            const candidates = await scrollAndCollectUrls(page, config);
            const newCandidates = candidates.filter(url => !StateManager.has(url));
            console.log(`      Кандидатов для проверки: ${newCandidates.length}`);
            
            for (const url of newCandidates) {
                await analyzeProfile(context, url, config);
                await randomDelay(800, 1500); 
            }
        }
    } catch (e) {
        console.error(`   ❌ Ошибка донора: ${e.message}`);
    } finally {
        await page.close();
    }
};

// ==========================================
// 4. MAIN RUNNER
// ==========================================

const run = async () => {
    console.log('🚀 ЗАПУСК СКРЕЙПЕРА...');
    const CONFIG = await getDynamicConfig();
    
    await StateManager.init();
    const donors = await StateManager.loadDonors();

    if (!donors.length) {
        console.log('⚠️ Список доноров в config/profiles.txt пуст.');
        return;
    }

    const browser = await chromium.launch({ 
        headless: false, 
        proxy: CONFIG.proxy || undefined 
    });

    const context = await browser.newContext({ 
        viewport: CONFIG.viewport, 
        userAgent: CONFIG.userAgent 
    });

    // ГЛОБАЛЬНАЯ БЛОКИРОВКА (Ускоряет весь скрипт и лечит зависания)
    // CSS ('stylesheet') блокировать НЕЛЬЗЯ, иначе ломается скролл в Instagram!
    await context.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font'].includes(type)) {
            route.abort();
        } else {
            route.continue();
        }
    });

    if (CONFIG.cookies.length > 0) {
        await context.addCookies(CONFIG.cookies);
    }

    for (const donorUrl of donors) {
        await processDonor(context, donorUrl, CONFIG);
    }

    await browser.close();
    console.log('\n👋 Работа завершена! Результаты сохранены.');
};

run().catch(console.error);