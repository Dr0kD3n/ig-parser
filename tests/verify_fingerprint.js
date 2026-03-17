const { generateFingerprint } = require('../backend/lib/fingerprint');

const fp = generateFingerprint();
console.log('--- GENERATED FINGERPRINT ---');
console.log(JSON.stringify(fp, null, 2));

if (fp.webgl && fp.hardware && fp.userAgent) {
  console.log('\n✅ Fingerprint contains required detailed fields.');
} else {
  console.log('\n❌ Fingerprint is missing some detailed fields.');
}

if (fp.fingerprint && fp.fingerprint.navigator) {
  console.log('✅ Fingerprint contains base fingerprint-generator data.');
} else {
  console.log('❌ Fingerprint is missing base fingerprint-generator data.');
}
