// Test the login via Vite proxy (port 5174)
async function testViteProxy() {
    try {
        const res = await fetch('http://localhost:5174/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'test@test.com', password: 'test123' })
        });
        const data = await res.json();
        console.log('Vite Proxy - Status:', res.status);
        console.log('Vite Proxy - Response:', JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Vite Proxy Error:', e.message);
    }
}
testViteProxy();
