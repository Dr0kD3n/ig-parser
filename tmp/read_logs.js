const fs = require('fs');
const path = require('path');
const logsFile = path.join(process.cwd(), 'data', 'logs.json');

try {
    const data = fs.readFileSync(logsFile, 'utf8');
    const logs = JSON.parse(data);
    const lastLogs = logs.slice(-20);
    lastLogs.forEach(log => {
        console.log(`[${log.timestamp}] [${log.source}] ${log.message}`);
    });
} catch (e) {
    console.error('Error reading logs:', e);
}
