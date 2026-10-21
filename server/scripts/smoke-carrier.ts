import assert from 'node:assert/strict';
import { encryptCarrierSecret, decryptCarrierSecret } from '../src/lib/carrier-secret.js';
import { quoteCdek, verifyCdekConnection, type CdekConnection } from '../src/lib/cdek.js';
import { parseCdekShipmentResponse } from '../src/lib/shipment.js';

const encrypted = encryptCarrierSecret('demo-secret-not-for-production');
assert.notEqual(encrypted, 'demo-secret-not-for-production');
assert.equal(decryptCarrierSecret(encrypted), 'demo-secret-not-for-production');
assert.throws(() => decryptCarrierSecret(encrypted.replace(/.$/, 'A')));
assert.deepEqual(parseCdekShipmentResponse({ entity: { uuid: 'order-1', cdek_number: 1110035402 }, requests: [{ state: 'SUCCESSFUL' }] }), { state: 'created', tracking: '1110035402', externalUuid: 'order-1', error: null });
assert.equal(parseCdekShipmentResponse({ entity: { uuid: 'order-2' }, requests: [{ state: 'INVALID', errors: [{ message: 'Invalid package' }] }] }).error, 'Invalid package');

const connection: CdekConnection = { clientId: 'test-account', secret: 'test-secret', mode: 'test', originCityCode: 44, originPoint: 'MSK1', senderName: 'Test Seller', senderPhone: '+79990000000', weight: 500, length: 30, width: 25, height: 10 };
const originalFetch = globalThis.fetch;
const seen: { url: string; body?: unknown }[] = [];
globalThis.fetch = async (input, init) => {
  const url = String(input);
  seen.push({ url, body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
  if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'mock-token', expires_in: 3600 });
  if (url.includes('/deliverypoints')) return Response.json([{ code: 'MSK1', status: 'ACTIVE', is_reception: true }]);
  if (url.endsWith('/calculator/tarifflist')) return Response.json({ tariff_codes: [
    { tariff_code: 1, tariff_name: 'door', delivery_mode: 1, delivery_sum: 100 },
    { tariff_code: 2, tariff_name: 'warehouse', delivery_mode: 4, delivery_sum: 350, period_min: 2, period_max: 4 },
  ] });
  throw new Error(`Unexpected URL ${url}`);
};
try {
  await verifyCdekConnection(connection);
  const quote = await quoteCdek(connection, 137, 'SPB1');
  assert.equal(quote.tariffCode, 2);
  assert.equal(quote.price, 350);
  assert.equal(quote.originPoint, 'MSK1');
  assert.equal((seen.find((x) => x.url.endsWith('/calculator/tarifflist'))?.body as { delivery_point: string }).delivery_point, 'SPB1');
  assert(seen.every((x) => x.url.startsWith('https://api.edu.cdek.ru/v2/')));
  console.log('carrier smoke: ok');
} finally { globalThis.fetch = originalFetch; }
