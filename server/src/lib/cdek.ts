import { config } from '../config.js';
import { AppError, badRequest } from './http.js';
import { decryptCarrierSecret } from './carrier-secret.js';

export type CdekCity = { code: number; city: string; region: string };
export type CdekPoint = { code: string; name: string; address: string; city: string; cityCode: number; lat?: number; lon?: number };
export type CdekConnection = {
  clientId: string; secret: string; mode: 'test' | 'live'; originCityCode: number;
  originPoint: string;
  senderName: string; senderPhone: string; weight: number; length: number; width: number; height: number;
};

export function connectionFromSettings(settings: unknown): CdekConnection | null {
  const value = (settings as Record<string, unknown> | null)?.cdekConnection as Record<string, unknown> | undefined;
  if (!value || typeof value.clientId !== 'string' || typeof value.secret !== 'string') return null;
  return {
    clientId: value.clientId,
    secret: decryptCarrierSecret(value.secret),
    mode: value.mode === 'live' ? 'live' : 'test',
    originCityCode: Number(value.originCityCode), originPoint: String(value.originPoint), senderName: String(value.senderName), senderPhone: String(value.senderPhone),
    weight: Number(value.weight), length: Number(value.length), width: Number(value.width), height: Number(value.height),
  };
}

let token: { value: string; expiresAt: number } | null = null;
const sellerTokens = new Map<string, { value: string; expiresAt: number }>();
type PublicDirectory = { expiresAt: number; cities: CdekCity[]; pointsByCity: Map<number, CdekPoint[]> };
let publicDirectory: PublicDirectory | null = null;
let publicDirectoryLoading: Promise<PublicDirectory> | null = null;

export function cdekConfigured() {
  return Boolean(config.cdekClientId && config.cdekClientSecret);
}

async function accessToken() {
  if (!cdekConfigured()) throw new AppError(503, 'cdek_unavailable', 'СДЭК пока не подключён. Укажите желаемый ПВЗ вручную.');
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: config.cdekClientId, client_secret: config.cdekClientSecret });
  const response = await fetch(`${config.cdekApiUrl}/oauth/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new AppError(502, 'cdek_auth', 'Не удалось подключиться к СДЭК. Попробуйте позже.');
  const data = await response.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new AppError(502, 'cdek_auth', 'СДЭК не выдал токен доступа.');
  token = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return token.value;
}

function sellerBase(mode: 'test' | 'live') {
  return mode === 'test' ? 'https://api.edu.cdek.ru/v2' : 'https://api.cdek.ru/v2';
}

async function sellerToken(connection: CdekConnection) {
  const cacheKey = `${connection.mode}:${connection.clientId}:${connection.secret}`;
  const cached = sellerTokens.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value;
  let response: Response;
  try {
    response = await fetch(`${sellerBase(connection.mode)}/oauth/token`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: connection.clientId, client_secret: connection.secret }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { throw new AppError(502, 'cdek_unavailable', 'СДЭК не отвечает. Попробуйте позже.'); }
  if (!response.ok) throw new AppError(400, 'cdek_credentials', 'СДЭК отклонил ключи. Проверьте среду и доступы в кабинете.');
  const data = await response.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new AppError(502, 'cdek_auth', 'СДЭК не выдал токен доступа.');
  sellerTokens.set(cacheKey, { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
  return data.access_token;
}

export async function sellerCdekRequest(connection: CdekConnection, path: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(`${sellerBase(connection.mode)}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${await sellerToken(connection)}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(12000),
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'cdek_unavailable', 'СДЭК не отвечает. Проверьте заказ позже.');
  }
  const data = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new AppError(502, 'cdek_error', `СДЭК не принял запрос${data?.requests?.[0]?.errors?.[0]?.message ? `: ${String(data.requests[0].errors[0].message).slice(0, 180)}` : '. Проверьте данные и попробуйте позже.'}`);
  return data;
}

export async function verifyCdekConnection(connection: CdekConnection) {
  await sellerToken(connection);
  const points = await sellerCdekRequest(connection, `/deliverypoints?city_code=${connection.originCityCode}`);
  if (!Array.isArray(points) || !points.some((p) => p.code === connection.originPoint && p.is_reception !== false && p.status !== 'CLOSED')) {
    throw badRequest('Выбранный пункт сдачи СДЭК недоступен в этом городе');
  }
}

export async function quoteCdek(connection: CdekConnection, destinationCityCode: number, destinationPoint: string) {
  const originPoints = await sellerCdekRequest(connection, `/deliverypoints?city_code=${connection.originCityCode}`) as any[];
  const origin = originPoints.find((p) => p.code === connection.originPoint && p.is_reception !== false && p.status !== 'CLOSED');
  if (!origin) throw badRequest('Нет доступного ПВЗ для сдачи в городе продавца');
  const data = await sellerCdekRequest(connection, '/calculator/tarifflist', {
    type: 2, currency: 1, from_location: { code: connection.originCityCode }, to_location: { code: destinationCityCode },
    shipment_point: origin.code, delivery_point: destinationPoint,
    packages: [{ weight: connection.weight, length: connection.length, width: connection.width, height: connection.height }],
  });
  const tariffs = (Array.isArray(data.tariff_codes) ? data.tariff_codes : []).filter((t: any) => t.delivery_mode === 4 && Number.isInteger(t.tariff_code) && Number.isFinite(t.delivery_sum));
  tariffs.sort((a: any, b: any) => a.delivery_sum - b.delivery_sum);
  const tariff = tariffs[0];
  if (!tariff) throw badRequest('СДЭК не предложил тариф «ПВЗ → ПВЗ» для этого заказа');
  if (data.currency && data.currency !== 'RUB' && data.currency !== 1) throw badRequest('СДЭК вернул цену не в рублях — оформление остановлено');
  return { originPoint: origin.code as string, tariffCode: tariff.tariff_code as number, tariffName: String(tariff.tariff_name || 'ПВЗ → ПВЗ'), price: Number(tariff.delivery_sum), periodMin: tariff.period_min, periodMax: tariff.period_max };
}

async function getCdek(path: string): Promise<unknown> {
  try {
    const response = await fetch(`${config.cdekApiUrl}${path}`, { headers: { Authorization: `Bearer ${await accessToken()}` }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new AppError(502, 'cdek_error', 'СДЭК временно не отвечает. Укажите ПВЗ вручную или попробуйте позже.');
    return response.json();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, 'cdek_error', 'СДЭК временно не отвечает. Укажите ПВЗ вручную или попробуйте позже.');
  }
}

async function getPublicCdek(path: string): Promise<unknown> {
  try {
    const response = await fetch(`https://integration.cdek.ru${path}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch {
    throw new AppError(502, 'cdek_error', 'Список ПВЗ СДЭК временно недоступен. Укажите пункт вручную или попробуйте позже.');
  }
}

async function loadPublicDirectory(): Promise<PublicDirectory> {
  if (publicDirectory && publicDirectory.expiresAt > Date.now()) return publicDirectory;
  if (!publicDirectoryLoading) publicDirectoryLoading = (async () => {
    const data = await getPublicCdek('/pvzlist/v1/json?type=ALL');
    if (!data || !Array.isArray((data as { pvz?: unknown }).pvz)) throw new AppError(502, 'cdek_error', 'СДЭК вернул неверный список ПВЗ.');
    const cities = new Map<number, CdekCity>();
    const pointsByCity = new Map<number, CdekPoint[]>();
    for (const v of (data as { pvz: any[] }).pvz) {
      const cityCode = Number(v.cityCode);
      if (!Number.isInteger(cityCode) || cityCode <= 0 || typeof v.code !== 'string' || typeof v.city !== 'string' || !['RU', 'BY'].includes(v.countryCodeIso) || v.status !== 'ACTIVE' || v.isHandout === false) continue;
      if (!cities.has(cityCode)) cities.set(cityCode, { code: cityCode, city: v.city, region: String(v.regionName || (v.countryCodeIso === 'BY' ? 'Беларусь' : 'Россия')) });
      const points = pointsByCity.get(cityCode) ?? [];
      points.push({ code: v.code, name: String(v.name || 'ПВЗ СДЭК'), address: String(v.fullAddress || v.address || ''), city: v.city, cityCode, lat: v.coordY && Number.isFinite(Number(v.coordY)) ? Number(v.coordY) : undefined, lon: v.coordX && Number.isFinite(Number(v.coordX)) ? Number(v.coordX) : undefined });
      pointsByCity.set(cityCode, points);
    }
    // shortcut: публичный V1 может исчезнуть; при подключении ключей автоматически используется официальный V2.
    return { expiresAt: Date.now() + 24 * 60 * 60_000, cities: [...cities.values()], pointsByCity };
  })();
  try { return publicDirectory = await publicDirectoryLoading; }
  finally { publicDirectoryLoading = null; }
}

export async function findCdekCities(query: string): Promise<CdekCity[]> {
  if (query.trim().length < 2 || query.length > 100) throw badRequest('Введите не менее двух букв города');
  if (!cdekConfigured()) {
    const directory = await loadPublicDirectory();
    const needle = query.trim().toLocaleLowerCase('ru-RU');
    return directory.cities.filter((item) => item.city.toLocaleLowerCase('ru-RU').includes(needle))
      .sort((a, b) => Number(b.city.toLocaleLowerCase('ru-RU').startsWith(needle)) - Number(a.city.toLocaleLowerCase('ru-RU').startsWith(needle)) || a.city.localeCompare(b.city, 'ru-RU'))
      .slice(0, 30);
  }
  const data = await getCdek(`/location/suggest/cities?name=${encodeURIComponent(query.trim())}`);
  if (!Array.isArray(data)) throw new AppError(502, 'cdek_error', 'СДЭК вернул неверный список городов.');
  return data.filter((v) => Number.isInteger(v.code) && typeof v.full_name === 'string' && ['RU', 'BY'].includes(v.country_code)).slice(0, 30).map((v) => ({ code: v.code, city: v.full_name, region: v.country_code === 'BY' ? 'Беларусь' : 'Россия' }));
}

export async function getCdekPoints(cityCode: number): Promise<CdekPoint[]> {
  if (!Number.isInteger(cityCode) || cityCode <= 0) throw badRequest('Выберите город из списка');
  if (!cdekConfigured()) {
    return (await loadPublicDirectory()).pointsByCity.get(cityCode) ?? [];
  }
  const data = await getCdek(`/deliverypoints?city_code=${cityCode}`);
  if (!Array.isArray(data)) throw new AppError(502, 'cdek_error', 'СДЭК вернул неверный список ПВЗ.');
  return data.filter((v) => typeof v.code === 'string' && v.location?.city_code === cityCode && v.is_handout !== false && (!v.status || v.status === 'ACTIVE'))
    .map((v) => ({ code: v.code as string, name: String(v.name ?? 'ПВЗ СДЭК'), address: String(v.location.address_full ?? v.location.address ?? ''), city: String(v.location.city ?? ''), cityCode, lat: Number.isFinite(v.location.latitude) ? v.location.latitude : undefined, lon: Number.isFinite(v.location.longitude) ? v.location.longitude : undefined }));
}

export async function getCdekPoint(cityCode: number, pointCode: string) {
  if (!/^[A-Za-z0-9-]{2,32}$/.test(pointCode)) throw badRequest('Неверный код ПВЗ СДЭК');
  const points = await getCdekPoints(cityCode);
  const point = points.find((item) => item.code === pointCode);
  if (!point) throw badRequest('Этот ПВЗ СДЭК недоступен — выберите другой');
  return point;
}
