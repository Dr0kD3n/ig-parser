import fs from 'fs';
import path from 'path';

const logFile = path.join(__dirname, '..', '..', 'data', 'logs', 'app.log');

function log(message: string, level: string = 'INFO') {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level}] ${message}`;

    // Print to console
    if (level === 'ERROR') {
        console.error(message);
    } else {
        console.log(message);
    }

    // Write to file
    try {
        if (!fs.existsSync(path.dirname(logFile))) {
            fs.mkdirSync(path.dirname(logFile), { recursive: true });
        }
        fs.appendFileSync(logFile, formattedMessage + '\n');
    } catch (err: any) {
        console.error('Failed to write to log file:', err.message);
    }
}

export const info = (msg: string) => log(msg, 'INFO');
export const error = (msg: string) => log(msg, 'ERROR');
export const warn = (msg: string) => log(msg, 'WARN');
export const debug = (msg: string) => log(msg, 'DEBUG');
export { logFile };
