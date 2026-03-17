const https = require('http'); // Not using https because local server is http

const login = (email, password) => {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ email, password });
    const req = https.request(
      {
        hostname: 'localhost',
        port: 5000,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(JSON.parse(body)));
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
};

const getSettings = (token) => {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'localhost',
        port: 5000,
        path: '/api/settings',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
};

async function runTest() {
  try {
    console.log('--- Phase 1: First login ---');
    const login1 = await login('admin@igbot.com', 'admin123');
    const token1 = login1.token;
    if (!token1) throw new Error('Login 1 failed: ' + JSON.stringify(login1));
    console.log('Login 1 success. Token obtained.');

    console.log('Verifying Token 1 works...');
    const test1 = await getSettings(token1);
    console.log('Token 1 test status:', test1.statusCode);
    if (test1.statusCode !== 200) throw new Error('Token 1 should work');

    console.log('\n--- Phase 2: Second login (different session) ---');
    const login2 = await login('admin@igbot.com', 'admin123');
    const token2 = login2.token;
    if (!token2) throw new Error('Login 2 failed: ' + JSON.stringify(login2));
    console.log('Login 2 success. Token obtained.');

    console.log('Verifying Token 2 works...');
    const test2 = await getSettings(token2);
    console.log('Token 2 test status:', test2.statusCode);
    if (test2.statusCode !== 200) throw new Error('Token 2 should work');

    console.log('\n--- Phase 3: Verify Token 1 is now invalid ---');
    console.log('Attempting request with Token 1...');
    const test3 = await getSettings(token1);
    console.log('Token 1 test status:', test3.statusCode);
    console.log('Token 1 test body:', test3.body);

    if (test3.statusCode === 401) {
      console.log('\nSUCCESS: Token 1 was successfully invalidated after Login 2.');
    } else {
      console.log('\nFAILURE: Token 1 is still valid! Status code:', test3.statusCode);
    }
  } catch (err) {
    console.error('Test error:', err.message);
  }
}

runTest();
