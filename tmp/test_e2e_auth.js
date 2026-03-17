// End-to-end test: auth via Vite proxy (5173) and direct (5000)
async function test() {
  const payload = JSON.stringify({ email: 'test@test.com', password: 'test123' });

  // Test 1: Direct to backend
  try {
    const res = await fetch('http://localhost:5000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    const data = await res.json();
    console.log('[Direct :5000] Status:', res.status, '| Body:', JSON.stringify(data));
  } catch (e) {
    console.error('[Direct :5000] Error:', e.message);
  }

  // Test 2: Via Vite proxy
  try {
    const res = await fetch('http://localhost:5173/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
    const data = await res.json();
    console.log('[Proxy  :5173] Status:', res.status, '| Body:', JSON.stringify(data));
  } catch (e) {
    console.error('[Proxy  :5173] Error:', e.message);
  }
}
test();
