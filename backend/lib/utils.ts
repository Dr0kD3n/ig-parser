import { Page } from 'playwright';

export const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export const randomDelay = (min = 200, max = 600): Promise<void> => wait(min + Math.random() * (max - min));

export const shuffleArray = <T>(array: T[]): T[] => {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};

interface Timeouts {
    typingDelayMin: number;
    typingDelayMax: number;
}

/**
 * Функция эмуляции человеческого ввода текста
 */
export const humanType = async (page: Page, selector: string, text: string, timeouts: Timeouts): Promise<void> => {
    try {
        await page.click(selector);
        for (const char of text) {
            await page.keyboard.type(char);
            let delay = Math.floor(Math.random() * (timeouts.typingDelayMax - timeouts.typingDelayMin + 1)) + timeouts.typingDelayMin;
            if (Math.random() < 0.05) delay += Math.floor(Math.random() * 300) + 300;
            await wait(delay);
        }
    } catch (e: any) {
        console.error('Ошибка печати:', e.message);
    }
};
