const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// Constants from the app
const JWT_SECRET = 'super_secret_key_123';
const PUBLIC_KEY_PATH = 'c:\\Users\\root\\Documents\\Projects\\ig-bot\\config\\auth_public_key.pem';
let JWT_PUBLIC_KEY = null;

if (fs.existsSync(PUBLIC_KEY_PATH)) {
  JWT_PUBLIC_KEY = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
}

const IS_ASYMMETRIC = false; // Force false for testing failure case

console.log('IS_ASYMMETRIC:', IS_ASYMMETRIC);

// The token from the user's curl
const token =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwiZW1haWwiOiJhZG1pbkBpZ2JvdC5jb20iLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NzM0NTM5NjMsImV4cCI6MTc3NDA1ODc2M30.M5WeCZbt4aYEmEc2UMezBL6No_FCo4j-wJ7GxPux6VwhU6nufAM5kE_kOLloMFYxSzvvr-Ock0ECHCweLxY8Q3Ut-4S60wIzJYQPPTB-ND8nbgWIgNFVCzjckLzh8KBd8mpytVDc1CTy-cNzw4m9vpIppJQ_raCh2RFRBeruWY_XAJQc0cGp_cBlAlE08v10QYBqOSqHpfHdK1NWd_txGPU1YlB791zZw_9CF_BTQdKf1i2zy0yTcPEExF9ISPEvdnO6m_scGDJmWgoFRtY1hQjyol9zKNtSekHNMfaSmep11cQoE6JFtaLyO1c3NgoVVnqm0Uj1j8HNgh2X-tez_A';

try {
  const key = IS_ASYMMETRIC ? JWT_PUBLIC_KEY : JWT_SECRET;
  const decoded = jwt.verify(token, key, {
    algorithms: IS_ASYMMETRIC ? ['RS256'] : ['HS256'],
  });
  console.log('Verification Success:', decoded);
} catch (error) {
  console.error('Verification Failed:', error.message);
  console.error('Code:', error.code);
  console.error('Stack:', error.stack);
}
