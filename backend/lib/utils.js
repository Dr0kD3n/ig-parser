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
 * Эмуляция наведения мыши
 */
const humanHover = async (page, selector) => {
    try {
        const element = typeof selector === 'string' ? page.locator(selector).first() : selector;
        const box = await element.boundingBox();
        if (box) {
            const x = box.x + box.width * (0.3 + Math.random() * 0.4);
            const y = box.y + box.height * (0.3 + Math.random() * 0.4);
            // Move to the element
            await page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 5) });
            await (0, exports.wait)(500 + Math.random() * 1000);
        }
    }
    catch (e) { }
};
exports.humanHover = humanHover;
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
