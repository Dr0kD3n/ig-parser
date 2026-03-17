const fs = require('fs');
const path = require('path');

// Logic from auth-config.js
const __dirname_sim = 'c:\\Users\\root\\Documents\\Projects\\ig-bot\\backend\\lib';
const PUBLIC_KEY_PATH = path.join(__dirname_sim, '../../config/auth_public_key.pem');
console.log('PUBLIC_KEY_PATH:', PUBLIC_KEY_PATH);
console.log('Exists:', fs.existsSync(PUBLIC_KEY_PATH));

if (fs.existsSync(PUBLIC_KEY_PATH)) {
  const content = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8');
  console.log('Content length:', content.length);
  console.log('IS_ASYMMETRIC: true');
} else {
  console.log('IS_ASYMMETRIC: false');
}
