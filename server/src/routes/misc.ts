import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { h } from '../lib/http.js';
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
  h(async (req, res) => {
    const user = req.auth!.user;
    const [ordersCount, memberships] = await Promise.all([
      prisma.order.count({ where: { buyerId: user.id } }),
      prisma.storeMember.findMany({
        where: { userId: user.id },
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
      isSuperadmin: req.isSuperadmin ?? false,
      // магазины, где пользователь — продавец (вход в админку, §7)
      stores: memberships.map((m) => ({ ...m.store, role: m.role })),
    });
  }),
);

// POST /api/uploads — загрузка изображений (§6.5, §7.2). До 10 файлов.
miscRouter.post(
  '/uploads',
  uploadLimiter,
  authenticate,
  uploadImages.array('files', 10),
  h(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? [];
    const processed = await processUploads(files);
    // urls — полноразмерные (совместимость), thumbs — миниатюры для списков
    res.json({ urls: processed.map((p) => p.url), thumbs: processed.map((p) => p.thumbUrl) });
  }),
);
