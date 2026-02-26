"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.humanType = exports.shuffleArray = exports.randomDelay = exports.wait = exports.getRootPath = void 0;
const path_1 = __importDefault(require("path"));
const getRootPath = () => {
    return process.pkg
        ? path_1.default.dirname(process.execPath)
        : path_1.default.join(__dirname, '..', '..');
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
        await page.click(selector);
        for (const char of text) {
            await page.keyboard.type(char);
            let delay = Math.floor(Math.random() * (timeouts.typingDelayMax - timeouts.typingDelayMin + 1)) + timeouts.typingDelayMin;
            if (Math.random() < 0.05)
                delay += Math.floor(Math.random() * 300) + 300;
            await (0, exports.wait)(delay);
        }
    }
    catch (e) {
        console.error('Ошибка печати:', e.message);
    }
};
exports.humanType = humanType;
