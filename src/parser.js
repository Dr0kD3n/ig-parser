const { chromium } = require('playwright');
const fs = require('fs/promises');
const path = require('path');

// ==========================================
// 1. АВТО-ГЕНЕРАТОР ЗАПРОСОВ
// ==========================================

// Список ниш. Можешь добавлять сюда любые свои тематики!
const NICHES = [
    'маникюр', 'брови', 'ресницы', 'массаж', 'шугаринг', 
    'салон красоты', 'фотограф', 'одежда', 'торты', 
    'косметолог', 'барбершоп', 'ресторан', 'кафе', 
    'фитнес', 'тренер', 'тату', 'цветы', 'клининг'
];

function generateRandomQueries(cities, count = 5) {
    if (!cities || cities.length === 0) return ['маникюр']; // Заглушка, если файл пуст
    
    const queries = new Set();
    // Пытаемся сгенерировать уникальные комбинации
    while(queries.size < count) {
        const randomCity = cities[Math.floor(Math.random() * cities.length)];
        const randomNiche = NICHES[Math.floor(Math.random() * NICHES.length)];
        queries.add(`${randomNiche} ${randomCity}`);
    }
    
    return Array.from(queries);
}

// ==========================================
// 2. ПАРСЕРЫ КОНФИГОВ
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
        return null;
    }
}

async function getCookies() {
    try {
        const raw = await fs.readFile(getConfigPath('cookies.txt'), 'utf8');
        const cookies = [];
        const names = ['sessionid', 'csrftoken', 'ds_user_id', 'mid', 'ig_did', 'ig_nrcb']; 

        names.forEach(name => {
            // Ищем всё между именем куки и доменом .instagram.com
            const regex = new RegExp(`${name}(.*?)\\.instagram\\.com`, 'i');
            const match = raw.match(regex);
            
            if (match && match[1]) {
                const value = match[1].trim();
                cookies.push({ 
                    name: name, 
                    value: value, 
                    domain: '.instagram.com', 
                    path: '/', 
                    secure: true, 
                    sameSite: 'Lax' // Для инсты лучше ставить Lax
                });
            }
        });
        
        console.log(`🍪 Успешно загружено куки: ${cookies.length} шт.`);
        return cookies;
    } catch (e) {
        console.error('⚠️ Ошибка при чтении cookies.txt');
        return [];
    }
}

async function getList(fileName) {
    try {
        // Прописываем прямой путь до папки config рядом со скриптом
        const filePath = path.join(__dirname, '../config', fileName);
        const data = await fs.readFile(filePath, 'utf8');
        
        return data.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    } catch (e) {
        console.error(`⚠️ Файл config/${fileName} не найден. Проверь путь: ${path.join(__dirname, 'config', fileName)}`);
        return [];
    }
}

const getDynamicConfig = async () => {
    const cityKeywords = await getList('cityKeywords.txt');
    // Генерируем 5 случайных запросов на один запуск
    const autoQueries = generateRandomQueries(cityKeywords, 5); 

    return {
        viewport: { width: 1280, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        timeouts: { pageLoad: 30000, element: 10000, inputWait: 6000 },
        proxy: await getProxy(),
        cookies: await getCookies(),
        cityKeywords: cityKeywords,
        queries: autoQueries 
    };
};

// ==========================================
// 3. STATE & STORAGE 
// ==========================================

const PATHS = {
    HISTORY: path.join(__dirname, '../config', 'checked_profiles_history.txt'),
    RESULTS: path.join(__dirname, '../config', 'profiles.txt'), // Теперь сразу сохраняем в profiles.txt!
};

const StateManager = {
    processed: new Set(),
    async init() {
        try {
            const data = await fs.readFile(PATHS.HISTORY, 'utf8');
            this.processed = new Set(data.split('\n').map(s => s.trim()).filter(Boolean));
        } catch { await fs.writeFile(PATHS.HISTORY, ''); }
        
        try { await fs.access(PATHS.RESULTS); } 
        catch { await fs.writeFile(PATHS.RESULTS, ''); }
    },
    has(url) { return this.processed.has(url); },
    async add(url) {
        if (this.processed.has(url)) return;
        this.processed.add(url);
        await fs.appendFile(PATHS.HISTORY, `${url}\n`, 'utf8');
    },
    async saveResult(url) {
        await fs.appendFile(PATHS.RESULTS, `${url}\n`, 'utf8');
        console.log(`✅ Сохранен новый донор: ${url}`);
    }
};

// ==========================================
// 4. ЛОГИКА ПОИСКА ДОНОРОВ
// ==========================================

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const analyzePotentialDonor = async (checkerPage, url, config) => {
    if (StateManager.has(url)) return;
    await StateManager.add(url);

    try {
        await checkerPage.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeouts.pageLoad });
        
        const headerText = await checkerPage.locator('header').innerText().catch(() => '');
        if (!headerText) return;

        // Жесткая проверка: в шапке профиля должно быть упоминание города
        const isTargetCity = config.cityKeywords.some(kw => headerText.toLowerCase().includes(kw.toLowerCase()));
        
        if (isTargetCity) {
            await StateManager.saveResult(url);
        } else {
            console.log(`❌ Пропуск: ${url} (нет нужного города в БИО)`);
        }
        
    } catch (e) {
        // Игнорируем ошибки при проверке конкретного профиля
    }
};

const searchDonorsByQuery = async (page, query, config, checkerPage) => {
    console.log(`\n🤖 Генерирую запрос: "${query}"`);
    try {
        await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
        
        const searchBtn = page.locator('svg[aria-label="Search"], svg[aria-label="Поиск"]').first();
        await searchBtn.waitFor({ state: 'visible', timeout: config.timeouts.element });
        await searchBtn.click();
        
        const searchInput = page.locator('input[placeholder="Search"], input[placeholder="Поиск"]').first();
        await searchInput.waitFor({ state: 'visible', timeout: config.timeouts.inputWait });
        
        await searchInput.fill('');
        await searchInput.pressSequentially(query, { delay: Math.random() * 200 + 100 }); // "Человеческий" ввод
        
        console.log('⏳ Парсинг результатов...');
        await wait(5000); // Даем время на подгрузку списка

        const candidates = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            return links
                .map(a => a.getAttribute('href'))
                .filter(href => href && href.split('/').length === 3 && !href.includes('/explore/'))
                .map(href => `https://www.instagram.com${href}`);
        });

        const uniqueCandidates = [...new Set(candidates)].filter(url => !StateManager.has(url));
        console.log(`👀 Найдено профилей на проверку: ${uniqueCandidates.length}`);

        for (const url of uniqueCandidates) {
            await analyzePotentialDonor(checkerPage, url, config);
            await wait(1500 + Math.random() * 2000); 
        }

    } catch (e) {
        console.error(`⚠️ Ошибка поиска "${query}": ${e.message}`);
    }
};

// ==========================================
// 5. MAIN RUNNER
// ==========================================

const run = async () => {
    console.log('🚀 ЗАПУСК АВТОНОМНОГО ПОИСКОВИКА ДОНОРОВ...');
    const CONFIG = await getDynamicConfig();
    
    await StateManager.init();

    if (!CONFIG.cityKeywords.length) {
        console.log('⚠️ Файл config/cityKeywords.txt пуст! Напиши туда города (например: спб, питер, москва).');
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

    if (CONFIG.cookies.length > 0) {
        await context.addCookies(CONFIG.cookies);
    } else {
        console.log('⚠️ Внимание: Куки не загружены! Инстаграм может не пустить.');
    }

    // Блокируем картинки/видео для скорости и экономии трафика прокси
    await context.route('**/*', route => {
        if (['image', 'media', 'font', 'stylesheet'].includes(route.request().resourceType())) {
            route.abort(); 
        } else {
            route.continue();
        }
    });

    const mainPage = await context.newPage();
    const checkerPage = await context.newPage();

    // Проходим по случайно сгенерированным запросам
    for (const query of CONFIG.queries) {
        await searchDonorsByQuery(mainPage, query, CONFIG, checkerPage);
        await wait(3000 + Math.random() * 2000);
    }

    await browser.close();
    console.log('\n✅ Цикл завершен! База profiles.txt пополнена свежими донорами.');
};

run().catch(console.error);