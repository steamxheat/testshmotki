import './types.js';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { assertRuntimeConfig, config } from './config.js';
import { prisma } from './db.js';
import { UPLOAD_DIR } from './lib/upload.js';
import { errorHandler } from './middleware/error.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { adminRouter } from './routes/admin.js';
import { adminChatRouter, chatRouter } from './routes/chat.js';
import { catalogRouter } from './routes/catalog.js';
import { deliveryRouter } from './routes/delivery.js';
import { favoritesRouter } from './routes/favorites.js';
import { miscRouter } from './routes/misc.js';
import { ordersRouter } from './routes/orders.js';
import { reviewsRouter } from './routes/reviews.js';
import { storeRouter } from './routes/store.js';
import { initBot } from './telegram/bot.js';
import { startReservationCron } from './jobs/reservations.js';

// BigInt (Telegram ID) сериализуется в строку в JSON-ответах
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

const app = express();
assertRuntimeConfig();

// за обратным прокси (nginx) — доверяем первому хопу, чтобы req.ip и rate-limit были корректны
if (!config.isDev) app.set('trust proxy', 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // отдача картинок в Mini App
    contentSecurityPolicy: false,
    frameguard: false, // Telegram opens Mini Apps inside its own frame.
  }),
);
app.use(
  cors({
    origin: config.isDev ? true : config.webOrigin,
    credentials: false,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', async (req, res, next) => {
  let filename: string;
  try { filename = path.basename(decodeURIComponent(req.path)); }
  catch { return res.sendStatus(404); }
  if (!/^[\w-]+\.(?:webp|mp4|webm|mov)$/.test(filename)) return next();
  const url = `/uploads/${filename}`;
  try {
    const chatMedia = await prisma.chatMessage.findFirst({ where: { mediaUrl: url }, select: { id: true } });
    if (chatMedia) {
      const publicProduct = await prisma.productImage.findFirst({ where: { url }, select: { id: true } });
      if (!publicProduct) return res.sendStatus(404);
    }
    next();
  } catch (error) { next(error); }
});
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, env: config.env }));

app.use('/api', generalLimiter);
app.use('/api/store', storeRouter);
app.use('/api/catalog', catalogRouter);
app.use('/api/delivery', deliveryRouter);
app.use('/api/favorites', favoritesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/chat', chatRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api', miscRouter);
app.use('/api/admin', adminRouter);
app.use('/api/admin', adminChatRouter);

// Native production mode: one Express process serves both the API and built Mini App.
const webDist = process.env.WEB_DIST;
if (webDist) {
  app.use(express.static(webDist, { index: false }));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use(errorHandler);

initBot();
startReservationCron();

app.listen(config.port, config.allowDevAuth ? '127.0.0.1' : (process.env.HOST || '0.0.0.0'), () => {
  console.log(`[server] http://localhost:${config.port} (${config.env})`);
  if (!config.botToken) {
    console.warn(`[server] BOT_TOKEN не задан: Telegram-вход отключён${config.allowDevAuth ? ', X-Dev-User разрешён для локальных тестов' : ''}.`);
  }
});
