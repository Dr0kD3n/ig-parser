"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logFile = exports.debug = exports.warn = exports.error = exports.info = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const utils_1 = require("./utils");
const logFile = path_1.default.join((0, utils_1.getRootPath)(), 'data', 'logs', 'app.log');
exports.logFile = logFile;
function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level}] ${message}`;
    // Print to console
    if (level === 'ERROR') {
        console.error(message);
    }
    else {
        console.log(message);
    }
    // Write to file
    try {
        if (!fs_1.default.existsSync(path_1.default.dirname(logFile))) {
            fs_1.default.mkdirSync(path_1.default.dirname(logFile), { recursive: true });
        }
        fs_1.default.appendFileSync(logFile, formattedMessage + '\n');
    }
    catch (err) {
        console.error('Failed to write to log file:', err.message);
    }
}
const info = (msg) => log(msg, 'INFO');
exports.info = info;
const error = (msg) => log(msg, 'ERROR');
exports.error = error;
const warn = (msg) => log(msg, 'WARN');
exports.warn = warn;
const debug = (msg) => log(msg, 'DEBUG');
exports.debug = debug;
