const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min = 200, max = 600) => wait(min + Math.random() * (max - min));

const shuffleArray = (array) => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

// Функция эмуляции человеческого ввода текста
const humanType = async (page, selector, text, timeouts) => {
    try {
        await page.click(selector);
        for (const char of text) {
            await page.keyboard.type(char);
            let delay = Math.floor(Math.random() * (timeouts.typingDelayMax - timeouts.typingDelayMin + 1)) + timeouts.typingDelayMin;
            if (Math.random() < 0.05) delay += Math.floor(Math.random() * 300) + 300;
            await wait(delay);
        }
    } catch (e) {
        console.error('Ошибка печати:', e.message);
    }
};

module.exports = {
    wait,
    randomDelay,
    shuffleArray,
    humanType
};
