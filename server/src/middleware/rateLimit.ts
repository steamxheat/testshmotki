import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

// Ограничение частоты запросов для авторизации, поиска, заказов и загрузки (§Безопасность).
const keyByUser = (req: Request) =>
  req.auth ? String(req.auth.telegramId) : req.ip ?? 'anon';

export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
});

export const searchLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  keyGenerator: keyByUser,
});

export const orderLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  keyGenerator: keyByUser,
  message: { error: { code: 'rate_limited', message: 'Слишком часто, подождите немного' } },
});

export const uploadLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  keyGenerator: keyByUser,
});
