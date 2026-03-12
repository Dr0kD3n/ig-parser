const http = require('http');

const data = JSON.stringify({
    showBrowser: true,
    names: ['TestName1', 'TestName2']
});

const options = {
    hostname: 'localhost',
    port: 1337,
    path: '/api/settings',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    res.on('data', (d) => {
        process.stdout.write(d);
    });
});

req.on('error', (error) => {
    console.error(error);
});

req.write(data);
req.end();
