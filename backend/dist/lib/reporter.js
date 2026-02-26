"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveCrashReport = saveCrashReport;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger = __importStar(require("./logger"));
const utils_1 = require("./utils");
/**
 * Saves a crash report including screenshot, HTML, and logs.
 * @param page - Playwright page object
 * @param error - The error that triggered the report
 * @param contextName - Name of the context (e.g., 'checker', 'sender')
 */
async function saveCrashReport(page, error, contextName = 'crash') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportDirName = `crash_${timestamp}_${contextName}`;
    const reportPath = path_1.default.join((0, utils_1.getRootPath)(), 'data', 'reports', reportDirName);
    try {
        if (!fs_1.default.existsSync(reportPath)) {
            fs_1.default.mkdirSync(reportPath, { recursive: true });
        }
        const screenshotPath = path_1.default.join(reportPath, 'screenshot.jpg');
        const htmlPath = path_1.default.join(reportPath, 'page.html');
        const errorPath = path_1.default.join(reportPath, 'report.json');
        const logsSnapshotPath = path_1.default.join(reportPath, 'app.log.snapshot');
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
            if (html)
                fs_1.default.writeFileSync(htmlPath, html);
        }
        // 3. Save Error Details
        const errorData = {
            timestamp: new Date().toISOString(),
            context: contextName,
            url: page && !page.isClosed() ? page.url() : 'N/A',
            errorMessage: error.message,
            errorStack: error.stack
        };
        fs_1.default.writeFileSync(errorPath, JSON.stringify(errorData, null, 2));
        // 4. Snapshot Logs
        if (logger.logFile && fs_1.default.existsSync(logger.logFile)) {
            try {
                // Read last 100 lines of logs or just copy everything if small
                const logs = fs_1.default.readFileSync(logger.logFile, 'utf8');
                fs_1.default.writeFileSync(logsSnapshotPath, logs);
            }
            catch (e) {
                logger.error(`[REPORTER] Failed to snapshot logs: ${e.message}`);
            }
        }
        logger.info(`🚨 [REPORTER] Crash report saved to: ${reportPath}`);
    }
    catch (e) {
        logger.error(`💥 [REPORTER] FAILED TO GENERATE CRASH REPORT: ${e.message}`);
    }
}
