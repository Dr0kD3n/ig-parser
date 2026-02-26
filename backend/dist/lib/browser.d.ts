import { Browser, BrowserContext, Page } from 'playwright';
export declare function createBrowserContext(config: any, headless?: boolean): Promise<{
    browser: Browser;
    context: BrowserContext;
}>;
export declare function optimizeContextForScraping(context: BrowserContext): Promise<void>;
export declare function takeLiveScreenshot(page: Page): Promise<void>;
export declare function startLiveView(context: BrowserContext): NodeJS.Timeout;
export declare function checkLoginPage(page: Page): Promise<boolean>;
