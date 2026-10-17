import './types.js';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { UPLOAD_DIR } from './lib/upload.js';
import { errorHandler } from './middleware/error.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { adminRouter } from './routes/admin.js';
import { catalogRouter } from './routes/catalog.js';
import { favoritesRouter } from './routes/favorites.js';
import { miscRouter } from './routes/misc.js';
import { ordersRouter } from './routes/orders.js';
import { reviewsRouter } from './routes/reviews.js';
import { storeRouter } from './routes/store.js';
import { superadminRouter } from './routes/superadmin.js';
import { initBot } from './telegram/bot.js';
import { startReservationCron } from './jobs/reservations.js';

// BigInt (Telegram ID) сериализуется в строку в JSON-ответах
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const app = express();

// за обратным прокси (nginx) — доверяем первому хопу, чтобы req.ip и rate-limit были корректны
if (!config.isDev) app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // отдача картинок в Mini App
    contentSecurityPolicy: false,
  }),
);
app.use(
  cors({
    origin: config.isDev ? true : config.webOrigin,
    credentials: false,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, env: config.env }));

app.use('/api', generalLimiter);
app.use('/api/store', storeRouter);
app.use('/api/catalog', catalogRouter);
app.use('/api/favorites', favoritesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api', miscRouter);
app.use('/api/admin', adminRouter);
app.use('/api/superadmin', superadminRouter);

app.use(errorHandler);

initBot();
startReservationCron();

app.listen(config.port, () => {
  console.log(`[server] http://localhost:${config.port} (${config.env})`);
  if (!config.botToken) {
    console.warn('[server] BOT_TOKEN не задан: initData-проверка отключена, доступен dev-режим (X-Dev-User).');
  }
});
