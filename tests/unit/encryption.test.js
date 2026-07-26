import crypto from 'crypto';
import { describe, expect, it } from 'vitest';

const { JWT_SECRET } = require('../../backend/lib/auth-config');
const { decrypt, encrypt, encryptSafe, isEncrypted } = require('../../backend/lib/encryption');

function encryptLegacy(value) {
  const key = crypto.createHash('sha256').update(JWT_SECRET).digest();
  const iv = Buffer.alloc(16, 7);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

describe('credential encryption', () => {
  it('uses authenticated versioned ciphertext', () => {
    const encrypted = encrypt('secret');
    expect(encrypted).toMatch(/^v2:/);
    expect(isEncrypted(encrypted)).toBe(true);
    expect(decrypt(encrypted)).toBe('secret');
    expect(encryptSafe(encrypted)).toBe(encrypted);
  });

  it('keeps backward decryption for existing CBC values', () => {
    const legacy = encryptLegacy('legacy-secret');
    expect(isEncrypted(legacy)).toBe(true);
    expect(decrypt(legacy)).toBe('legacy-secret');
  });

  it('does not return plaintext from tampered ciphertext', () => {
    const encrypted = encrypt('secret');
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('0') ? '1' : '0'}`;
    expect(decrypt(tampered)).not.toBe('secret');
  });
});
