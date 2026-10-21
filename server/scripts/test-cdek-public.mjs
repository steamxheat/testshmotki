import assert from 'node:assert/strict';

delete process.env.CDEK_CLIENT_ID;
delete process.env.CDEK_CLIENT_SECRET;
const requests = [];
globalThis.fetch = async (url) => {
  requests.push(String(url));
  if (String(url).includes('/pvzlist/v1/json')) return Response.json({ pvz: [
    { code: 'TVR1', name: 'СДЭК Тверь', cityCode: '245', city: 'Тверь', regionName: 'Тверская область', countryCodeIso: 'RU', fullAddress: 'Тверь, Советская, 1', coordY: '56.86', coordX: '35.91', status: 'ACTIVE', isHandout: true },
    { code: 'CLOSED', cityCode: '245', status: 'CLOSED' },
  ] });
  throw new Error(`Unexpected URL: ${url}`);
};

const { findCdekCities, getCdekPoints, getCdekPoint } = await import('../dist/lib/cdek.js');
assert.deepEqual(await findCdekCities('Тве'), [{ code: 245, city: 'Тверь', region: 'Тверская область' }]);
assert.deepEqual((await getCdekPoints(245)).map((point) => point.code), ['TVR1']);
assert.equal((await getCdekPoint(245, 'TVR1')).lat, 56.86);
await assert.rejects(() => getCdekPoint(245, 'CLOSED'), /недоступен/);
assert.equal(requests.filter((url) => url.includes('/pvzlist/v1/json')).length, 1, 'Directory is cached');
console.log('Public CDEK city and pickup selection: OK');
