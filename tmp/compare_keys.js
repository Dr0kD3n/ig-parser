const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

try {
  const privKey = fs.readFileSync(
    'c:\\Users\\root\\Documents\\Projects\\ig-bot-backend\\auth_private_key.pem',
    'utf8'
  );
  const pubKeyObj = crypto.createPublicKey(privKey);
  const pubKeyPem = pubKeyObj.export({ type: 'spki', format: 'pem' });

  console.log('--- GENERATED PUBLIC KEY ---');
  console.log(pubKeyPem);

  const existingPubKey = fs.readFileSync(
    'c:\\Users\\root\\Documents\\Projects\\ig-bot\\config\\auth_public_key.pem',
    'utf8'
  );
  console.log('--- EXISTING PUBLIC KEY ---');
  console.log(existingPubKey);

  if (pubKeyPem.trim() === existingPubKey.trim()) {
    console.log('MATCH: YES');
  } else {
    console.log('MATCH: NO');
  }
} catch (e) {
  console.error('Error:', e.message);
}
