const fetch = require('node-fetch');

async function test() {
    try {
        const res = await fetch('http://localhost:1337/api/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'test@example.com',
                password: 'password123',
                registrationCode: 'WELCOME'
            })
        });
        const data = await res.json();
        console.log('Status:', res.status);
        console.log('Data:', data);
    } catch (e) {
        console.error('Fetch error:', e);
    }
}

test();
