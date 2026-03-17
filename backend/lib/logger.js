'use strict';
const fs_1 = require('fs');
const path_1 = require('path');
Object.defineProperty(exports, '__esModule', { value: true });
exports.logFile = exports.debug = exports.warn = exports.error = exports.info = void 0;

const utils_1 = require('./utils');
const logFile = path_1.join((0, utils_1.getRootPath)(), 'data', 'logs', 'app.log');
exports.logFile = logFile;
function log(message, level = 'INFO') {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] [${level}] ${message}`;
  // Print to console
  if (level === 'ERROR') {
    const errorMsg =
      typeof message === 'object' ? message.message || JSON.stringify(message) : message;
    console.error(errorMsg);
  } else {
    console.log(message);
  }
  // Write to file
  try {
    if (!fs_1.existsSync(path_1.dirname(logFile))) {
      fs_1.mkdirSync(path_1.dirname(logFile), { recursive: true });
    }
    fs_1.appendFileSync(logFile, formattedMessage + '\n');
  } catch (err) {
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
