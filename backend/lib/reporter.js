'use strict';
const fs_1 = require('fs');
const path_1 = require('path');
Object.defineProperty(exports, '__esModule', { value: true });
exports.saveCrashReport = saveCrashReport;
const logger = require('./logger');
const utils_1 = require('./utils');
/**
 * Saves a crash report including screenshot, HTML, and logs.
 * @param page - Playwright page object
 * @param error - The error that triggered the report
 * @param contextName - Name of the context (e.g., 'checker', 'sender')
 */
async function saveCrashReport(page, error, contextName = 'crash') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDirName = `crash_${timestamp}_${contextName}`;
  const reportPath = path_1.join((0, utils_1.getRootPath)(), 'data', 'reports', reportDirName);
  try {
    if (!fs_1.existsSync(reportPath)) {
      fs_1.mkdirSync(reportPath, { recursive: true });
    }
    const screenshotPath = path_1.join(reportPath, 'screenshot.jpg');
    const htmlPath = path_1.join(reportPath, 'page.html');
    const errorPath = path_1.join(reportPath, 'report.json');
    const logsSnapshotPath = path_1.join(reportPath, 'app.log.snapshot');
    // 1. Capture Screenshot
    if (page && !page.isClosed()) {
      await page.screenshot({ path: screenshotPath, type: 'jpeg', quality: 60 }).catch((e) => {
        logger.error(`[REPORTER] Failed to save screenshot: ${e.message}`);
      });
    }
    // 2. Capture HTML
    if (page && !page.isClosed()) {
      const html = await page.content().catch((e) => {
        logger.error(`[REPORTER] Failed to get page content: ${e.message}`);
        return '';
      });
      if (html) fs_1.writeFileSync(htmlPath, html);
    }
    // 3. Save Error Details
    const errorData = {
      timestamp: new Date().toISOString(),
      context: contextName,
      url: page && !page.isClosed() ? page.url() : 'N/A',
      errorMessage: error.message,
      errorStack: error.stack,
    };
    fs_1.writeFileSync(errorPath, JSON.stringify(errorData, null, 2));
    // 4. Snapshot Logs
    if (logger.logFile && fs_1.existsSync(logger.logFile)) {
      try {
        // Read last 100 lines of logs or just copy everything if small
        const logs = fs_1.readFileSync(logger.logFile, 'utf8');
        fs_1.writeFileSync(logsSnapshotPath, logs);
      } catch (e) {
        logger.error(`[REPORTER] Failed to snapshot logs: ${e.message}`);
      }
    }
    logger.info(`🚨 [REPORTER] Crash report saved to: ${reportPath}`);
  } catch (e) {
    logger.error(`💥 [REPORTER] FAILED TO GENERATE CRASH REPORT: ${e.message}`);
  }
}
