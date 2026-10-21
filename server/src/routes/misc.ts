import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, forbidden, h } from '../lib/http.js';
import { logEvent } from '../lib/stats.js';
import { authenticate } from '../middleware/auth.js';
import { resolveStore } from '../middleware/store.js';
import { uploadImages, processUploads } from '../lib/upload.js';
import { uploadLimiter } from '../middleware/rateLimit.js';

export const miscRouter = Router();

// POST /api/events — клиентские аналитические события (§16)
const eventSchema = z.object({
  type: z.enum([
    'store_view',
    'catalog_view',
    'filter_apply',
    'search_query',
    'product_view',
    'favorite_add',
    'favorite_remove',
    'buy_click',
    'order_created',
    'chat_open',
    'order_status_change',
    'review_published',
  ]),
  productId: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

miscRouter.post(
  '/events',
  authenticate,
  resolveStore({ optional: true }),
  h(async (req, res) => {
    const data = eventSchema.parse(req.body);
    logEvent({
      storeId: req.store?.id ?? null,
      userId: req.auth!.user.id,
      productId: data.productId ?? null,
      type: data.type,
      meta: data.meta ?? {},
    });
    res.json({ ok: true });
  }),
);

// GET /api/profile — профиль покупателя (§6.10)
miscRouter.get(
  '/profile',
  authenticate,
  resolveStore(),
  h(async (req, res) => {
    const user = req.auth!.user;
    const [ordersCount, memberships] = await Promise.all([
      prisma.order.count({ where: { buyerId: user.id, storeId: req.store!.id } }),
      prisma.storeMember.findMany({
        where: { userId: user.id, storeId: req.store!.id },
        include: { store: { select: { id: true, slug: true, name: true, logoUrl: true } } },
      }),
    ]);
    res.json({
      user: {
        telegramId: String(user.telegramId),
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        avatarUrl: user.avatarUrl,
        phone: user.phone,
      },
      ordersCount,
      // магазины, где пользователь — продавец (вход в админку, §7)
      stores: memberships.map((m) => ({ ...m.store, role: m.role })),
    });
  }),
);

// POST /api/uploads — загрузка изображений (§6.5, §7.2). До 10 файлов.
miscRouter.post(
  '/uploads',
  authenticate,
  resolveStore(),
  uploadLimiter,
  h(async (req, _res, next) => {
    const purpose = req.query.purpose;
    if (purpose === 'review') {
      const orderId = req.query.orderId;
      if (typeof orderId !== 'string') throw badRequest('Не указан заказ для отзыва');
      const order = await prisma.order.findFirst({ where: { id: orderId, storeId: req.store!.id, buyerId: req.auth!.user.id }, include: { review: { select: { id: true } } } });
      if (!order || order.status !== 'completed' || order.review) throw forbidden('Фото отзыва доступны только после завершения вашего заказа');
    } else if (purpose === 'store') {
      const member = await prisma.storeMember.findUnique({ where: { storeId_userId: { storeId: req.store!.id, userId: req.auth!.user.id } } });
      if (!member) throw forbidden('Загрузка товаров доступна только сотрудникам магазина');
    } else {
      throw badRequest('Укажите назначение загрузки');
    }
    next();
  }),
  uploadImages.array('files', 10),
  h(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (!files.length || (req.query.purpose === 'review' && files.length > 3)) throw badRequest('Для отзыва выберите от 1 до 3 фото');
    const processed = await processUploads(files);
    // urls — полноразмерные (совместимость), thumbs — миниатюры для списков
    res.json({ urls: processed.map((p) => p.url), thumbs: processed.map((p) => p.thumbUrl) });
  }),
);
