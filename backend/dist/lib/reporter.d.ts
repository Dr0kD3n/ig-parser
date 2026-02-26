import { Page } from 'playwright';
/**
 * Saves a crash report including screenshot, HTML, and logs.
 * @param page - Playwright page object
 * @param error - The error that triggered the report
 * @param contextName - Name of the context (e.g., 'checker', 'sender')
 */
export declare function saveCrashReport(page: Page | null, error: Error, contextName?: string): Promise<void>;
