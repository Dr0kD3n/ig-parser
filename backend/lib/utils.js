const path = require('path');
const getRootPath = () => {
    if (process.env.APP_ROOT) return process.env.APP_ROOT;
    return process['pkg']
        ? path.dirname(process.execPath)
        : path.join(__dirname, '..', '..');
};
exports.getRootPath = getRootPath;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
exports.wait = wait;
const randomDelay = (min = 200, max = 600) => (0, exports.wait)(min + Math.random() * (max - min));
exports.randomDelay = randomDelay;
const shuffleArray = (array) => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};
exports.shuffleArray = shuffleArray;
/**
 * Функция эмуляции человеческого ввода текста
 */
const humanType = async (page, selector, text, timeouts) => {
    try {
        const element = typeof selector === 'string' ? page.locator(selector).first() : selector;
        await element.click();
        const delayMin = timeouts?.typingDelayMin || 50;
        const delayMax = timeouts?.typingDelayMax || 150;
        for (const char of text) {
            await page.keyboard.type(char);
            let delay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
            // Occasional "human" pause
            if (Math.random() < 0.05)
                await (0, exports.wait)(Math.floor(Math.random() * 300) + 300);
            await (0, exports.wait)(delay);
        }
    }
    catch (e) {
        console.error('Ошибка печати:', e.message);
    }
};
exports.humanType = humanType;
/**
 * Генерирует массив точек для кубической кривой Безье
 */
const getBezierPoints = (p0, p1, p2, p3, steps = 30) => {
    const points = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = Math.pow(1 - t, 3) * p0.x +
            3 * Math.pow(1 - t, 2) * t * p1.x +
            3 * (1 - t) * Math.pow(t, 2) * p2.x +
            Math.pow(t, 3) * p3.x;
        const y = Math.pow(1 - t, 3) * p0.y +
            3 * Math.pow(1 - t, 2) * t * p1.y +
            3 * (1 - t) * Math.pow(t, 2) * p2.y +
            Math.pow(t, 3) * p3.y;
        points.push({ x, y });
    }
    return points;
};
exports.getBezierPoints = getBezierPoints;

/**
 * Плавное движение мыши по кривой
 */
const humanMove = async (page, targetX, targetY, options = {}) => {
    try {
        const steps = options.steps || (15 + Math.floor(Math.random() * 15));
        const startX = options.startX || 0;
        const startY = options.startY || 0;

        // Контрольные точки для кривой Безье
        const p1 = {
            x: startX + (targetX - startX) * Math.random(),
            y: startY + (targetY - startY) * Math.random()
        };
        const p2 = {
            x: startX + (targetX - startX) * Math.random(),
            y: startY + (targetY - startY) * Math.random()
        };

        const points = getBezierPoints(
            { x: startX, y: startY },
            p1,
            p2,
            { x: targetX, y: targetY },
            steps
        );

        for (const point of points) {
            // "Дрожание" (jitter) - добавляем случайное смещение
            const jitterX = (Math.random() - 0.5) * 3;
            const jitterY = (Math.random() - 0.5) * 3;

            // "Угловатость" - иногда пропускаем промежуточные точки или делаем резкие скачки
            if (Math.random() > 0.1) {
                await page.mouse.move(point.x + jitterX, point.y + jitterY);
            }

            // Рандомные паузы для имитации "неуверенности"
            if (Math.random() > 0.85) {
                await wait(Math.random() * 20 + 10);
            }
        }

        // Финальный микро-прыжок к цели
        await page.mouse.move(targetX, targetY);
    } catch (e) {
        await page.mouse.move(targetX, targetY);
    }
};
exports.humanMove = humanMove;

/**
 * Эмуляция наведения мыши
 */
const humanHover = async (page, selector) => {
    try {
        const element = typeof selector === 'string' ? page.locator(selector).first() : selector;
        const box = await element.boundingBox();
        if (box) {
            const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
            const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

            await humanMove(page, targetX, targetY);
            await wait(500 + Math.random() * 1000);
        }
    }
    catch (e) { }
};
exports.humanHover = humanHover;

/**
 * Эмуляция человеческого клика
 */
const humanClick = async (page, selectorOrHandle, options = {}) => {
    try {
        const element = typeof selectorOrHandle === 'string' ? page.locator(selectorOrHandle).first() : selectorOrHandle;
        const box = await element.boundingBox();
        if (box) {
            const targetX = box.x + box.width * (0.3 + Math.random() * 0.4);
            const targetY = box.y + box.height * (0.3 + Math.random() * 0.4);

            await humanMove(page, targetX, targetY);
            await wait(100 + Math.random() * 200);
            await element.click(options);
        } else {
            await element.click(options);
        }
    } catch (e) {
        console.error('Ошибка клика:', e.message);
    }
};
exports.humanClick = humanClick;
/**
 * Режим "Раздумье" (длительная пауза)
 */
const daydream = async (chance = 0.05) => {
    if (Math.random() < chance) {
        const delay = 15000 + Math.random() * 25000;
        console.log(`👤 [HUMAN] Задумался на ${Math.round(delay / 1000)}с...`);
        await (0, exports.wait)(delay);
    }
};
exports.daydream = daydream;
/**
 * Плавный скролл через JS ивенты
 */
const humanScroll = async (page, selector, direction = 'down', amount = 300) => {
    try {
        const steps = 10 + Math.floor(Math.random() * 10);
        const delta = direction === 'down' ? (amount / steps) : -(amount / steps);

        for (let i = 0; i < steps; i++) {
            const ease = 1 - Math.pow(1 - (i / steps), 2); // Quadratic ease out
            const stepDelta = delta * (1 + (Math.random() - 0.5) * 0.2); // Random variation

            await page.mouse.wheel(0, stepDelta);
            await (0, exports.wait)(30 + Math.random() * 40);
        }
    } catch (e) {
        // Fallback to JS scroll
        await page.evaluate(({ dir, amt }) => {
            window.scrollBy({ top: dir === 'down' ? amt : -amt, behavior: 'smooth' });
        }, { dir: direction, amt: amount });
    }
};
exports.humanScroll = humanScroll;
