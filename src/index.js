// Используем playwright-extra вместо обычного playwright
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
const fs = require('fs/promises');
const path = require('path');

// Подключаем stealth-плагин для скрытия следов автоматизации
chromium.use(stealth);

// ==========================================
// 1. УТИЛИТЫ И ПАРСЕРЫ КОНФИГОВ
// ==========================================

const getConfigPath = (fileName) => path.join(__dirname, '..', 'config', fileName);

// Нормализация ссылок (убирает слэши на конце и параметры), чтобы история работала на 100% точно
const normalizeUrl = (url) => {
    try {
        return new URL(url).href.split('?')[0].replace(/\/$/, '');
    } catch {
        return url.replace(/\/$/, '');
    }
};

async function getProxy() {
    try {
        const data = await fs.readFile(getConfigPath('proxy.txt'), 'utf8');
        const parts = data.trim().split(':');
        if (parts.length < 4) return null;
        console.log(`🌐 [PROXY] Прокси загружены: ${parts[0]}`);
        return {
            server: `http://${parts[0]}:${parts[1]}`,
            username: parts[2],
            password: parts[3]
        };
    } catch (e) {
        console.log(`⚠️ [PROXY] Файл proxy.txt пуст или не найден. Работаем напрямую.`);
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
                if (value.includes('.instagram.com')) value = value.split('.instagram.com')[0];
                cookies.push({
                    name: name, value: value, domain: '.instagram.com', path: '/', secure: true, sameSite: 'None'
                });
            }
        });
        console.log(`🍪 [COOKIES] Загружено куки: ${cookies.length} шт.`);
        return cookies;
    } catch (e) {
        console.log(`⚠️ [COOKIES] Файл cookies.txt не найден.`);
        return [];
    }
}

const shuffleArray = (array) => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

async function getList(fileName) {
    try {
        const data = await fs.readFile(getConfigPath(fileName), 'utf8');
        const list = data.trim().split(/\s+/).filter(Boolean);
        console.log(`📋 [СПИСОК] ${fileName} загружен (${list.length} элементов)`);
        return list;
    } catch (e) {
        console.log(`⚠️ [СПИСОК] Файл ${fileName} не найден.`);
        return [];
    }
}

const getDynamicConfig = async () => {
    const width = 1280 + Math.floor(Math.random() * 150);
    const height = 900 + Math.floor(Math.random() * 100);

    const rawNames = await getList('names.txt');
    const shuffledNames = shuffleArray(rawNames);
    
    return {
        viewport: { width, height },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        timeouts: { pageLoad: 25000, element: 10000, inputWait: 5000 },
        scroll: { maxAttempts: 15, maxRetries: 3 },
        proxy: await getProxy(),
        cookies: await getCookies(),
        target: {
            cityKeywords: await getList('cityKeywords.txt'),
            names: shuffledNames
        }
    };
};

// ==========================================
// 2. STATE & STORAGE (ИСТОРИЯ ПРОФИЛЕЙ)
// ==========================================

const PATHS = {
    HISTORY: path.join(__dirname, '..', 'config', 'processed_profiles.txt'),
    RESULTS: path.join(__dirname, '..', 'src', 'found_girls.json'),
};

const StateManager = {
    processed: new Set(),
    resultsCache: [],

    async init() {
        try {
            const data = await fs.readFile(PATHS.HISTORY, 'utf8');
            // При инициализации нормализуем все ссылки из файла
            const urls = data.split('\n').filter(Boolean).map(normalizeUrl);
            this.processed = new Set(urls);
            console.log(`🗄️ [ИСТОРИЯ] Загружено проверенных профилей: ${this.processed.size}`);
        } catch { await fs.writeFile(PATHS.HISTORY, ''); }

        try {
            const resultsData = await fs.readFile(PATHS.RESULTS, 'utf8');
            this.resultsCache = JSON.parse(resultsData);
        } catch {
            this.resultsCache = [];
            await fs.writeFile(PATHS.RESULTS, '[]');
        }
    },
    has(url) {
        return this.processed.has(normalizeUrl(url));
    },
    async add(url) {
        const normUrl = normalizeUrl(url);
        if (this.processed.has(normUrl)) return;
        this.processed.add(normUrl);
        await fs.appendFile(PATHS.HISTORY, `${normUrl}\n`, 'utf8');
    },
    async saveResult(profileData) {
        this.resultsCache.push({ ...profileData, timestamp: new Date().toISOString() });
        await fs.writeFile(PATHS.RESULTS, JSON.stringify(this.resultsCache, null, 2), 'utf8');
        console.log(`   🏆 [НАЙДЕНА] ${profileData.name} -> сохранена в базу!`);
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
    LOADER: 'div[role="dialog"] [role="progressbar"], div[role="dialog"] svg[aria-label="Loading..."], div[role="dialog"] svg[aria-label="Загрузка..."]'
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min = 200, max = 600) => wait(min + Math.random() * (max - min));

const extractVisibleCandidates = () => {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return [];
    const results = [];
    const canvases = dialog.querySelectorAll('canvas');
    canvases.forEach(canvas => {
        // Проверка aria-disabled='true' отсеивает всех без активных сторис еще здесь
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

    console.log(`      🔽 Начинаем скролл списка...`);

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

        if (!scrolledHeight) await page.mouse.wheel(0, 600);

        await wait(150);

        try {
            await page.waitForSelector(SELECTORS.LOADER, { state: 'hidden', timeout: 3000 });
        } catch (e) { }

        await wait(150);

        const newHeight = await page.evaluate(() => {
            const dialog = document.querySelector('div[role="dialog"]');
            const scrollable = dialog ? Array.from(dialog.querySelectorAll('div')).find(el => {
                const s = window.getComputedStyle(el);
                return (s.overflowY === 'auto' || s.overflowY === 'scroll');
            }) : null;
            return scrollable ? scrollable.scrollHeight : false;
        });

        if (newHeight === previousHeight) {
            sameHeightCount++;
            if (sameHeightCount >= config.scroll.maxRetries) {
                console.log(`      🛑 Достигнут конец списка (или лимит подгрузки).`);
                break;
            }
            await wait(500);
        } else {
            sameHeightCount = 0;
        }
        previousHeight = newHeight;

        // Логируем прогресс скролла
        if ((i + 1) % 3 === 0) {
            console.log(`      🔄 Скролл ${i + 1}/${config.scroll.maxAttempts} | Собрано профилей: ${collectedUrls.size}`);
        }
    }
    return Array.from(collectedUrls);
};

const analyzeProfile = async (context, url, config) => {
    if (StateManager.has(url)) return;
    await StateManager.add(url);

    const page = await context.newPage();
    console.log(`      👀 Открываем профиль: ${url}`);

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeouts.pageLoad });

        await page.waitForSelector('header', { timeout: 10000 });
        await page.waitForTimeout(1000);

        // Получаем username ДО входа в page.evaluate
        const username = url.split('/').filter(Boolean).pop() || '';

        // Передаем username внутрь браузерного контекста
        const extracted = await page.evaluate(async (uname) => {
            let photoUrl = '';
            let bioClean = '';
            let fullSearchText = '';

            const header = document.querySelector('header');
            if (header) {
                fullSearchText = header.innerText || '';

                // --- ИЗВЛЕЧЕНИЕ БИО ---
                const ulList = header.querySelector('ul');
                if (ulList && ulList.nextElementSibling) {
                    bioClean = ulList.nextElementSibling.innerText || '';
                } else {
                    const autoSpans = Array.from(header.querySelectorAll('span[dir="auto"]'));
                    const spanTexts = autoSpans.map(s => s.innerText.trim()).filter(Boolean);
                    if (spanTexts.length > 0) {
                        bioClean = spanTexts.join(' | ');
                    }
                }

                const highlightsBlock = header.nextElementSibling;
                if (highlightsBlock) {
                    fullSearchText += ' ' + (highlightsBlock.innerText || '');
                }
            }

            // --- ❗️ ИЗВЛЕЧЕНИЕ ФОТО (НАСТОЯЩЕЕ HD, 1080x1080) ---
            
            // СПОСОБ 1: Обращение к скрытому API Инстаграма (работает идеально, т.к. мы авторизованы)
            try {
                const res = await fetch(`/api/v1/users/web_profile_info/?username=${uname}`, {
                    headers: { 'X-IG-App-ID': '936619743392459' } // Обязательный заголовок для Web-версии
                });
                if (res.ok) {
                    const json = await res.json();
                    if (json?.data?.user?.profile_pic_url_hd) {
                        photoUrl = json.data.user.profile_pic_url_hd;
                    }
                }
            } catch (e) {
                // Если API заблокировано, идем к запасному плану
            }

            // СПОСОБ 2: Поиск в JSON-данных страницы
            if (!photoUrl) {
                const html = document.documentElement.innerHTML;
                // Ищем ВСЕ ссылки на HD-аватарки в исходном коде
                const matches = [...html.matchAll(/"profile_pic_url_hd":"([^"]+)"/g)];
                if (matches.length > 0) {
                    // ❗️ Берем ПОСЛЕДНЮЮ ссылку. 
                    // Первая ссылка в коде — это всегда ВЫ (ваша иконка в меню слева).
                    // Последняя ссылка — это всегда профиль, который мы сейчас просматриваем.
                    const rawUrl = matches[matches.length - 1][1];
                    try {
                        photoUrl = JSON.parse('"' + rawUrl + '"');
                    } catch (e) {
                        photoUrl = rawUrl.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
                    }
                }
            }

            // СПОСОБ 3: Возврат к img (самый крайний случай, вернет 150x150)
            if (!photoUrl && header) {
                const img = header.querySelector('img');
                if (img) photoUrl = img.getAttribute('src') || img.src || '';
            }

            return {
                fullSearchText: fullSearchText.replace(/\d+/g, ' '),
                bioClean: bioClean.replace(/\n/g, ' ').trim(),
                photoUrl
            };
        }, username); // Передаем переменную username в браузер

        const searchString = `${extracted.fullSearchText} ${username}`.toLowerCase();
        const isTarget = config.target.cityKeywords.some(kw => searchString.includes(kw.toLowerCase()));

        if (isTarget) {
            console.log(`         ✅ Целевой профиль! Парсим данные...`);

            const name = await page.locator('header h2, header h1, header span[dir="auto"]').first().innerText().catch(() => username);

            await StateManager.saveResult({
                name,
                bio: extracted.bioClean,
                photo: extracted.photoUrl,
                url
            });
        } else {
            console.log(`         ➖ Пропуск: нет целевых слов.`);
        }
    } catch (e) {
        if (!e.message.includes('Timeout')) {
            console.error(`         ❌ Ошибка анализа профиля: ${e.message.split('\n')[0]}`);
        } else {
            console.error(`         ❌ Ошибка: Timeout при загрузке профиля.`);
        }
    } finally {
        await page.close();
    }
};

const processDonor = async (context, donorUrl, config) => {
    console.log(`\n==============================================`);
    console.log(`📂 ОТКРЫВАЕМ ДОНОРА: ${donorUrl}`);
    console.log(`==============================================`);
    const page = await context.newPage();
    try {
        await page.goto(donorUrl, { waitUntil: 'domcontentloaded' });
        console.log(`   ✅ Страница донора загружена. Ищем кнопку подписчиков...`);

        const followersBtn = page.locator(SELECTORS.FOLLOWERS_LINK);
        await followersBtn.waitFor({ state: 'visible' });
        await followersBtn.click();

        await page.waitForSelector('div[role="dialog"]');
        console.log(`   ✅ Список подписчиков открыт.`);

        const searchInput = page.locator(SELECTORS.SEARCH_INPUT).first();
        await searchInput.waitFor({ state: 'visible', timeout: config.timeouts.inputWait });

        for (const name of config.target.names) {
            console.log(`\n   🔎 ПОИСК ПО ИМЕНИ: "${name}"`);

            await searchInput.click({ clickCount: 3 });
            await page.keyboard.press('Backspace');

            try { await page.waitForSelector(SELECTORS.LOADER, { state: 'hidden', timeout: 2000 }); } catch (e) { }

            const typeDelay = Math.floor(Math.random() * (120 - 40 + 1) + 40);
            await searchInput.pressSequentially(name, { delay: typeDelay });

            console.log(`      ⏳ Ждем выдачу результатов от Инстаграма...`);
            try { await page.waitForSelector(SELECTORS.LOADER, { state: 'hidden', timeout: 3000 }); } catch (e) { }
            await wait(200);

            const candidates = await scrollAndCollectUrls(page, config);

            // Фильтрация истории (ТУТ СРАБАТЫВАЕТ ЗАЩИТА ОТ ПРОЙДЕННЫХ ПРОФИЛЕЙ)
            const newCandidates = candidates.filter(url => !StateManager.has(url));
            const skippedCount = candidates.length - newCandidates.length;

            console.log(`      📊 ИТОГИ СБОРА ССЫЛОК:`);
            console.log(`         • Всего найдено (со сторис): ${candidates.length}`);
            console.log(`         • Пропущено (уже в истории): ${skippedCount}`);
            console.log(`         • Идем проверять: ${newCandidates.length}`);

            if (newCandidates.length === 0) {
                console.log(`      ⏭️ Новых профилей нет, переходим к следующему имени.`);
                continue;
            }

            for (const url of newCandidates) {
                await analyzeProfile(context, url, config);
                await randomDelay(200, 500);
            }
        }
    } catch (e) {
        console.error(`   ❌ КРИТИЧЕСКАЯ ОШИБКА ДОНОРА: ${e.message}`);
    } finally {
        await page.close();
        console.log(`   🚪 Донор закрыт.`);
    }
};

// ==========================================
// 4. MAIN RUNNER
// ==========================================

const run = async () => {
    console.log('🚀 ЗАПУСК СКРЕЙПЕРА (STEALTH MODE + LOGS)...');
    console.log('----------------------------------------------');
    const CONFIG = await getDynamicConfig();

    await StateManager.init();
    const donors = await StateManager.loadDonors();

    if (!donors.length) {
        console.log('⚠️ [ОШИБКА] Список доноров в config/profiles.txt пуст.');
        return;
    }
    console.log(`🎯 Загружено доноров: ${donors.length}`);

    console.log('🌐 Запуск браузера...');
    const browser = await chromium.launch({
        headless: false, // Оставьте false для дебага, при true логи все равно будут идти в консоль!
        proxy: CONFIG.proxy || undefined,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-web-security'
        ]
    });

    const context = await browser.newContext({
        viewport: CONFIG.viewport,
        userAgent: CONFIG.userAgent
    });

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
        console.log('✅ Куки применены.');
    } else {
        console.log('⚠️ Запуск без куки. Возможна переадресация на логин.');
    }

    for (const donorUrl of donors) {
        await processDonor(context, donorUrl, CONFIG);
    }

    await browser.close();
    console.log('\n✅ ========================================== ✅');
    console.log('👋 РАБОТА ПОЛНОСТЬЮ ЗАВЕРШЕНА! Все результаты сохранены.');
    console.log('✅ ========================================== ✅');
};

run().catch(console.error);