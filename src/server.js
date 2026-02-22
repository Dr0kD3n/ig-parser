const { chromium } = require('playwright');
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

// ==========================================
// 1. CONFIGURATION & SELECTORS
// ==========================================

const CONFIG = {
    timeouts: {
        pageLoad: 60000, // Увеличил время загрузки страницы
        element: 5000,
        typingDelayMin: 50,
        typingDelayMax: 180,
    },
     proxy: {
        server: 'http://45.159.183.41:4637',
        username: 'user204951',
        password: 'e1m2ij'
    },
    // proxy: {
    //     server: 'http://85.195.81.169:11012',
    //     username: 'SdMW0Z',
    //     password: 'aSA8pJ'
    // },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    cookies: [
        { name: 'csrftoken', value: 'Z8f10CsWaqVMzqqQ07FQAz', domain: '.instagram.com', path: '/' },
        { name: 'datr', value: 'cnp-aT-pusEjglG3pC-MHHw5', domain: '.instagram.com', path: '/' },
        { name: 'dpr', value: '1.5', domain: '.instagram.com', path: '/' },
        { name: 'ds_user_id', value: '67748731423', domain: '.instagram.com', path: '/' },
        { name: 'ig_did', value: '8BDB7E3F-6ACD-478F-8B04-A9D0BAB018CF', domain: '.instagram.com', path: '/' },
        { name: 'mid', value: 'aX56cgALAAEheyrtczgOX4bIPewu', domain: '.instagram.com', path: '/' },
        {
            name: 'rur',
            value: 'RVA\\05467748731423\\0541801671036:01fe3bbb3dd1b6f5c559b768110a08fb60813ec6eb3e21f80b820b66165bbc88fd7d6f3f',
            domain: '.instagram.com',
            path: '/'
        },
        {
            name: 'sessionid',
            value: '67748731423%3AyxTvMPwVVvYOlz%3A6%3AAYiVpcLUPu4Tlu-DQe_EZrG9OcuQj4YE2xjqrhnU7g',
            domain: '.instagram.com',
            path: '/'
        },
        { name: 'wd', value: '1920x1080', domain: '.instagram.com', path: '/' }
    ],
    selectors: {
        // ОБНОВЛЕННЫЕ СЕЛЕКТОРЫ КНОПКИ
        // Ищем и button, и a (ссылки), и div. Ищем тексты: "Написать", "Отправить", "Message"
        directMessageBtn: [
            // RU
            'button:has-text("Написать")',
            'div[role="button"]:has-text("Написать")',
            'a:has-text("Написать")',
            'button:has-text("Отправить сообщение")',
            'div[role="button"]:has-text("Отправить сообщение")',
            'div[role="button"]:has-text("Сообщение")',
            // EN
            'div[role="button"]:has-text("Message")',
            'button:has-text("Message")',
            'div[role="button"]:has-text("Send Message")'
        ],
        // Кнопка "3 точки"
        optionsBtn: [
            'svg[aria-label="Параметры"]',
            'svg[aria-label="Options"]',
            'svg[aria-label="More options"]',
            'div[role="button"] > svg' // Общий селектор, если aria-label изменился
        ],
        // Пункт в меню 3-х точек
        menuMessageBtn: [
            'div[role="dialog"] button:has-text("Отправить сообщение")',
            'div[role="dialog"] button:has-text("Написать")',
            'div[role="dialog"] button:has-text("Send message")'
        ],
        // Поле ввода
        chatInput: 'div[role="textbox"][contenteditable="true"]',
        // Попап уведомлений
        notNowBtn: [
            'button:has-text("Не сейчас")',
            'button:has-text("Not Now")'
        ],
        // Сообщения в чате
        messageRow: 'div[role="row"], div[role="listitem"]'
    }
};

app.use(express.json());

const GIRLS_FILE = path.join(__dirname, 'found_girls.json');
const VOTES_FILE = path.join(__dirname, 'votes.json');

// --- Routes ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.get('/api/girls', (req, res) => {
    if (fs.existsSync(GIRLS_FILE)) {
        try { res.json(JSON.parse(fs.readFileSync(GIRLS_FILE, 'utf8'))); } catch (e) { res.json([]); }
    } else { res.json([]); }
});

app.get('/api/votes', (req, res) => {
    if (fs.existsSync(VOTES_FILE)) {
        try { res.json(JSON.parse(fs.readFileSync(VOTES_FILE, 'utf8'))); } catch (e) { res.json({}); }
    } else { res.json({}); }
});

app.post('/api/vote', (req, res) => {
    // ИСПРАВЛЕНО: берем 'status', так как фронтенд отправляет именно его
    const { url, status } = req.body; 

    let votes = {};
    if (fs.existsSync(VOTES_FILE)) { 
        try { 
            votes = JSON.parse(fs.readFileSync(VOTES_FILE, 'utf8')); 
        } catch (e) { } 
    }
    
    // Используем status для записи
    votes[url] = status; 
    
    fs.writeFileSync(VOTES_FILE, JSON.stringify(votes, null, 2), 'utf8');
    
    console.log(`[GOLOS] ${status}: ${url}`);
    res.json({ success: true });
});

app.post('/api/dm', async (req, res) => {
    const { url, message } = req.body;
    console.log({ url, message })

    let browser = null;
    try {
        browser = await chromium.launch({
            headless: false,
            proxy: CONFIG.proxy,
            args: ['--start-maximized']
        });

        const context = await browser.newContext({
            userAgent: CONFIG.userAgent,
            viewport: null
        });
        await context.addCookies(CONFIG.cookies);

        const isSent = await sendMessageToProfile(context, url, message);

        if (isSent) {
            res.json({ success: true, message: 'Отправлено' });
        } else {
            res.json({ success: false, message: 'Не отправлено' });
        }

    } catch (e) {
        console.error('Ошибка запуска:', e);
        res.status(500).json({ success: false });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});

// ==========================================
// 2. UTILS
// ==========================================

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const humanType = async (page, selector, text) => {
    try {
        await page.click(selector);
        for (const char of text) {
            await page.keyboard.type(char);
            let delay = Math.floor(Math.random() * (CONFIG.timeouts.typingDelayMax - CONFIG.timeouts.typingDelayMin + 1)) + CONFIG.timeouts.typingDelayMin;
            if (Math.random() < 0.05) delay += Math.floor(Math.random() * 300) + 300;
            await wait(delay);
        }
    } catch (e) {
        console.error('Ошибка печати:', e.message);
    }
};

/**
 * Объединяет массив селекторов через запятую для CSS поиска
 */
const getSelectorString = (key) => {
    const val = CONFIG.selectors[key];
    return Array.isArray(val) ? val.join(',') : val;
}

// ==========================================
// 3. MAIN LOGIC
// ==========================================

const sendMessageToProfile = async (context, url, message) => {
    const page = await context.newPage();
    console.log(`\n📨 [SENDER] Начало обработки: ${url}`);

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CONFIG.timeouts.pageLoad });
        await wait(2000); 

        // ---------------------------------------------------------
        // ШАГ 1: Поиск кнопки "Написать"
        // ---------------------------------------------------------
        let accessButton = null;
        const directBtnSelector = getSelectorString('directMessageBtn');
        const directBtn = page.locator(directBtnSelector).first();

        try {
            await directBtn.waitFor({ state: 'visible', timeout: 5000 });
            if (await directBtn.isVisible()) {
                console.log('✅ Кнопка "Написать" (или аналог) найдена в профиле.');
                accessButton = directBtn;
            }
        } catch (e) {}

        if (!accessButton) {
            console.log('⚠️ Прямая кнопка не найдена. Проверяем "3 точки"...');
            const optionsBtn = page.locator(getSelectorString('optionsBtn')).first();
            
            if (await optionsBtn.isVisible()) {
                await optionsBtn.click();
                await wait(1500); 
                const menuMsgBtn = page.locator(getSelectorString('menuMessageBtn')).first();
                try {
                    await menuMsgBtn.waitFor({ state: 'visible', timeout: 3000 });
                    console.log('✅ Кнопка "Написать" найдена в меню.');
                    accessButton = menuMsgBtn;
                } catch (e) {
                    console.log('❌ В меню нет пункта отправки сообщения.');
                }
            }
        }

        if (!accessButton) {
            console.log(`⛔ [SKIP] Кнопки нет. Делаю скриншот...`);
            await page.screenshot({ path: path.join(__dirname, 'debug_error.png'), fullPage: true });
            return false;
        }

        await accessButton.click();

        // ---------------------------------------------------------
        // ШАГ 2: Ожидание чата
        // ---------------------------------------------------------
        try {
            await Promise.race([
                page.waitForSelector(CONFIG.selectors.chatInput, { state: 'visible', timeout: 15000 }),
                page.waitForSelector(getSelectorString('notNowBtn'), { state: 'visible', timeout: 15000 })
            ]);
        } catch (e) {
            console.log('❌ Тайм-аут: чат не открылся.');
            return false;
        }

        const notNowBtn = page.locator(getSelectorString('notNowBtn')).first();
        if (await notNowBtn.isVisible()) {
            await notNowBtn.click();
            await wait(1500);
        }

        // ---------------------------------------------------------
        // ШАГ 3: УМНАЯ Проверка ИСТОРИИ (ИСПРАВЛЕНО)
        // ---------------------------------------------------------
        const chatInput = page.locator(CONFIG.selectors.chatInput).first();
        if (!await chatInput.isVisible()) {
            console.log('❌ Поле ввода не найдено (ЛС закрыто).');
            return false;
        }

        console.log('🔍 Проверка истории переписки...');
        await wait(2500);

        // Получаем все элементы, похожие на сообщения
        const allRows = await page.locator(getSelectorString('messageRow')).all();
        let realMessageCount = 0;

        for (const row of allRows) {
            const text = await row.innerText();
            // Фильтруем системные сообщения (баннер профиля)
            // Если текст содержит "Смотреть профиль", "View Profile" или имя аккаунта в шапке - это не сообщение
            if (
                text.includes('Смотреть профиль') || 
                text.includes('View profile') || 
                text.includes('View Profile') ||
                text.includes('Аккаунт в Instagram') ||
                text.trim() === '' // Пустые блоки
            ) {
                continue; // Пропускаем этот элемент, это просто шапка
            }
            realMessageCount++;
        }

        if (realMessageCount > 0) {
            console.log(`⛔ [SKIP] Уже есть переписка (${realMessageCount} реальных сообщений). Закрываем.`);
            return false;
        }

        console.log('✅ История чиста (баннер проигнорирован). Отправляем сообщение.');

        // ---------------------------------------------------------
        // ШАГ 4: Отправка
        // ---------------------------------------------------------
        await humanType(page, CONFIG.selectors.chatInput, message);
        await wait(1000);
        await page.keyboard.press('Enter');
        console.log(`🚀 [SENT] Сообщение отправлено: ${url}`);
        
        await wait(3000);
        return true;

    } catch (error) {
        console.error(`💥 Ошибка: ${error.message}`);
        await page.screenshot({ path: path.join(__dirname, 'crash_error.png') });
        return false;
    } finally {
        await page.close();
    }
};