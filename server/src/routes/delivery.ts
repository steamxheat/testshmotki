import { Router } from 'express';
import { z } from 'zod';
import { cdekConfigured, connectionFromSettings, findCdekCities, getCdekPoint, getCdekPoints, quoteCdek } from '../lib/cdek.js';
import { h } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';
import { searchLimiter } from '../middleware/rateLimit.js';
import { resolveStore } from '../middleware/store.js';

export const deliveryRouter = Router();
deliveryRouter.use(authenticate, resolveStore(), searchLimiter);
deliveryRouter.get('/cdek/status', (_req, res) => res.json({ connected: true, source: cdekConfigured() ? 'api' : 'public' }));
deliveryRouter.get('/cdek/cities', h(async (req, res) => {
  const query = z.string().min(2).max(100).parse(req.query.query);
  res.json({ cities: await findCdekCities(query) });
}));
deliveryRouter.get('/cdek/points', h(async (req, res) => {
  const cityCode = z.coerce.number().int().positive().parse(req.query.cityCode);
  res.json({ points: await getCdekPoints(cityCode) });
}));
deliveryRouter.post('/cdek/quote', h(async (req, res) => {
  const { cityCode, pointCode } = z.object({ cityCode: z.number().int().positive(), pointCode: z.string().regex(/^[A-Za-z0-9-]{2,32}$/) }).parse(req.body);
  const connection = connectionFromSettings(req.store!.settings);
  if (!connection) { res.json({ available: false }); return; }
  await getCdekPoint(cityCode, pointCode);
  const quote = await quoteCdek(connection, cityCode, pointCode);
  res.json({ available: true, quote: { tariffCode: quote.tariffCode, tariffName: quote.tariffName, price: quote.price, periodMin: quote.periodMin, periodMax: quote.periodMax } });
}));
