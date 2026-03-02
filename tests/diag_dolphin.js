const http = require('http');
const https = require('https');

const DOLPHIN_LOCAL_API = 'http://127.0.0.1:3001';
const PROFILE_ID = process.argv[2];
const TOKEN = process.argv[3];

if (!PROFILE_ID) {
    console.error('Usage: node tests/diag_dolphin.js <PROFILE_ID> [TOKEN]');
    process.exit(1);
}

async function request(url, options = {}) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: data ? JSON.parse(data) : null
                    });
                } catch (e) {
                    resolve({
                        statusCode: res.statusCode,
                        headers: res.headers,
                        data: data
                    });
                }
            });
        }).on('error', reject);
    });
}

async function diag() {
    console.log(`🔍 [DIAG] Testing Dolphin Local API at ${DOLPHIN_LOCAL_API}`);

    try {
        const startUrl = `${DOLPHIN_LOCAL_API}/v1.0/browser_profiles/${PROFILE_ID}/start?automation=1`;
        console.log(`🚀 [DIAG] Attempting to start profile ${PROFILE_ID}...`);
        console.log(`URL: ${startUrl}`);

        const result = await request(startUrl);
        console.log(`Status: ${result.statusCode}`);
        console.log('Response:', JSON.stringify(result.data, null, 2));

        if (result.data && result.data.success) {
            console.log('✅ [DIAG] Profile started successfully!');
            console.log(`WS Endpoint: ${result.data.automation?.wsEndpoint}`);
        } else {
            console.log('❌ [DIAG] Profile start failed.');

            if (TOKEN) {
                console.log('🔑 [DIAG] Attempting authentication with token...');
                // Checking if auth/login-with-token exists (speculative)
                const authUrl = `${DOLPHIN_LOCAL_API}/v1.0/auth/login-with-token`;
                // Note: this usually needs a POST, but diag script uses GET for simplicity in first pass
                // Let's try passing it as a header instead or in start URL
                console.log('Retry starting with token in URL (speculative)...');
                const startWithTokenUrl = `${startUrl}&token=${TOKEN}`;
                const result2 = await request(startWithTokenUrl);
                console.log(`Status (with token param): ${result2.statusCode}`);
                console.log('Response:', JSON.stringify(result2.data, null, 2));
            }
        }
    } catch (e) {
        console.error('💥 [DIAG] Connection error:', e.message);
        if (e.code === 'ECONNREFUSED') {
            console.error('Is Dolphin Anty running?');
        }
    }
}

diag();
