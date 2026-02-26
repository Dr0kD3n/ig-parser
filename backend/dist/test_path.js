"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const utils_1 = require("./lib/utils");
console.log('getRootPath():', (0, utils_1.getRootPath)());
console.log('__dirname:', __dirname);
const DB_PATH = path_1.default.join((0, utils_1.getRootPath)(), 'config', 'database.sqlite');
console.log('DB_PATH:', DB_PATH);
