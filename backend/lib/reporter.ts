import fs from 'fs';
import path from 'path';
import * as logger from './logger';
import { Page } from 'playwright';

/**
 * Saves a crash report including screenshot, HTML, and logs.
 * @param page - Playwright page object
 * @param error - The error that triggered the report
 * @param contextName - Name of the context (e.g., 'checker', 'sender')
 */
export async function saveCrashReport(page: Page | null, error: Error, contextName: string = 'crash'): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportDirName = `crash_${timestamp}_${contextName}`;
    const reportPath = path.join(__dirname, '..', '..', 'data', 'reports', reportDirName);

    try {
        if (!fs.existsSync(reportPath)) {
            fs.mkdirSync(reportPath, { recursive: true });
        }

        const screenshotPath = path.join(reportPath, 'screenshot.jpg');
        const htmlPath = path.join(reportPath, 'page.html');
        const errorPath = path.join(reportPath, 'report.json');
        const logsSnapshotPath = path.join(reportPath, 'app.log.snapshot');

        // 1. Capture Screenshot
        if (page && !page.isClosed()) {
            await page.screenshot({ path: screenshotPath, type: 'jpeg', quality: 60 }).catch((e: any) => {
                logger.error(`[REPORTER] Failed to save screenshot: ${e.message}`);
            });
        }

        // 2. Capture HTML
        if (page && !page.isClosed()) {
            const html = await page.content().catch((e: any) => {
                logger.error(`[REPORTER] Failed to get page content: ${e.message}`);
                return '';
            });
            if (html) fs.writeFileSync(htmlPath, html);
        }

        // 3. Save Error Details
        const errorData = {
            timestamp: new Date().toISOString(),
            context: contextName,
            url: page && !page.isClosed() ? page.url() : 'N/A',
            errorMessage: error.message,
            errorStack: error.stack
        };
        fs.writeFileSync(errorPath, JSON.stringify(errorData, null, 2));

        // 4. Snapshot Logs
        if (logger.logFile && fs.existsSync(logger.logFile)) {
            try {
                // Read last 100 lines of logs or just copy everything if small
                const logs = fs.readFileSync(logger.logFile, 'utf8');
                fs.writeFileSync(logsSnapshotPath, logs);
            } catch (e: any) {
                logger.error(`[REPORTER] Failed to snapshot logs: ${e.message}`);
            }
        }

        logger.info(`🚨 [REPORTER] Crash report saved to: ${reportPath}`);
    } catch (e: any) {
        logger.error(`💥 [REPORTER] FAILED TO GENERATE CRASH REPORT: ${e.message}`);
    }
}
