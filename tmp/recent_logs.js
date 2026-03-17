const fs = require('fs');
const path = require('path');
const logsFile = path.join(process.cwd(), 'data', 'logs.json');

try {
  const data = fs.readFileSync(logsFile, 'utf8');
  const logs = JSON.parse(data);
  const recentLogs = logs.filter((log) => log.timestamp > '2026-03-13T18:00:00Z');
  console.log(`Found ${recentLogs.length} recent logs.`);
  recentLogs.slice(-20).forEach((log) => {
    console.log(`[${log.timestamp}] [${log.source}] ${log.message}`);
  });
} catch (e) {
  console.error('Error reading logs:', e);
}
