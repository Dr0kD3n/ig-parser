const { spawn } = require('child_process');
const http = require('http');

async function testStop() {
    console.log('Starting test...');

    // 1. Start a dummy process via API
    // We can't easily trigger the real /api/bot/start because it looks for index.js
    // But we can simulate the logic manually or just trust the server.js change.
    // Actually, let's just check if the server is running and try to stop index if it's "running"

    const postData = JSON.stringify({ type: 'index' });

    // First, start it
    const startReq = http.request({
        hostname: 'localhost',
        port: 1337,
        path: '/api/bot/start',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': postData.length
        }
    }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
            console.log('Start response:', data);

            // Wait 2 seconds for it to fully start
            setTimeout(() => {
                console.log('Sending stop request...');
                const start = Date.now();
                const stopReq = http.request({
                    hostname: 'localhost',
                    port: 1337,
                    path: '/api/bot/stop',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': postData.length
                    }
                }, (resStop) => {
                    let dataStop = '';
                    resStop.on('data', (chunk) => dataStop += chunk);
                    resStop.on('end', () => {
                        const duration = Date.now() - start;
                        console.log(`Stop response (${duration}ms):`, dataStop);
                        if (duration > 100) {
                            console.log('SUCCESS: Stop request waited for process exit.');
                        } else {
                            console.warn('WARNING: Stop request was too fast, might still have race condition.');
                        }
                        process.exit(0);
                    });
                });
                stopReq.write(postData);
                stopReq.end();
            }, 2000);
        });
    });

    startReq.on('error', (e) => {
        console.error('Error: Is the server running? Run npm run dev first.');
        process.exit(1);
    });

    startReq.write(postData);
    startReq.end();
}

testStop();
