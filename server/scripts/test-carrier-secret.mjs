import assert from 'node:assert/strict';
import { encryptCarrierSecret, decryptCarrierSecret } from '../dist/lib/carrier-secret.js';

const previous = process.env.CARRIER_ENCRYPTION_KEY;
try {
  process.env.CARRIER_ENCRYPTION_KEY = 'a'.repeat(64);
  const encrypted = encryptCarrierSecret('test-secret');
  assert.notEqual(encrypted, 'test-secret');
  assert.equal(decryptCarrierSecret(encrypted), 'test-secret');
  delete process.env.CARRIER_ENCRYPTION_KEY;
  assert.throws(() => encryptCarrierSecret('test-secret'), { code: 'carrier_key_missing' });
} finally {
  if (previous === undefined) delete process.env.CARRIER_ENCRYPTION_KEY;
  else process.env.CARRIER_ENCRYPTION_KEY = previous;
}
console.log('OK: СДЭК использует отдельный ключ и не подменяет его токеном бота');
