import assert from 'node:assert/strict';

process.env.CDEK_CLIENT_ID = 'test-id';
process.env.CDEK_CLIENT_SECRET = 'test-secret';
const requests = [];
globalThis.fetch = async (url, options) => {
  requests.push({ url: String(url), options });
  if (String(url).endsWith('/oauth/token')) return Response.json({ access_token: 'test-token', expires_in: 3600 });
  if (String(url).includes('/location/suggest/cities')) return Response.json([{ code: 44, full_name: 'Тверь, Тверская область', country_code: 'RU' }, { code: 45, full_name: 'Минск', country_code: 'BY' }]);
  if (String(url).includes('/deliverypoints')) return Response.json([
    { code: 'TVR1', name: 'Тверь, центр', location: { city_code: 44, city: 'Тверь', address_full: 'Тверь, Советская, 1', latitude: 56.86, longitude: 35.91 }, is_handout: true },
    { code: 'OTHER', name: 'Другой город', location: { city_code: 99, city: 'Москва', address: 'Москва' } },
  ]);
  throw new Error('Unexpected URL');
};

const { findCdekCities, getCdekPoints, getCdekPoint } = await import('../dist/lib/cdek.js');
assert.equal((await findCdekCities('Тве'))[0].code, 44);
assert.equal((await findCdekCities('Мин'))[1].region, 'Беларусь');
assert.deepEqual((await getCdekPoints(44)).map((point) => point.code), ['TVR1']);
assert.equal((await getCdekPoint(44, 'TVR1')).address, 'Тверь, Советская, 1');
await assert.rejects(() => getCdekPoint(44, 'OTHER'), /недоступен/);
assert.equal(requests.filter((request) => request.url.endsWith('/oauth/token')).length, 1, 'OAuth token is reused');
assert(requests.every((request) => request.url.endsWith('/oauth/token') || request.options.headers.Authorization === 'Bearer test-token'));
console.log('CDEK city and pickup selection: OK');
