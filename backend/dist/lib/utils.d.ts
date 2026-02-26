import { Page } from 'playwright';
export declare const getRootPath: () => string;
export declare const wait: (ms: number) => Promise<void>;
export declare const randomDelay: (min?: number, max?: number) => Promise<void>;
export declare const shuffleArray: <T>(array: T[]) => T[];
interface Timeouts {
    typingDelayMin: number;
    typingDelayMax: number;
}
/**
 * Функция эмуляции человеческого ввода текста
 */
export declare const humanType: (page: Page, selector: string, text: string, timeouts: Timeouts) => Promise<void>;
export {};
