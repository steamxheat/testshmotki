import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, forbidden, h } from '../lib/http.js';
import { logEvent } from '../lib/stats.js';
import { authenticate } from '../middleware/auth.js';
import { resolveStore } from '../middleware/store.js';
import { UPLOAD_DIR, uploadImages, processUploads } from '../lib/upload.js';
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
        contactName: user.contactName,
        contactEmail: user.contactEmail,
        deliveryCity: user.deliveryCity,
        deliveryAddress: user.deliveryAddress,
      },
      ordersCount,
      // магазины, где пользователь — продавец (вход в админку, §7)
      stores: memberships.map((m) => ({ ...m.store, role: m.role })),
    });
  }),
);

const profileSchema = z.object({
  contactName: z.string().trim().max(100),
  phone: z.string().trim().max(32),
  contactEmail: z.union([z.literal(''), z.string().trim().email().max(200)]),
  deliveryCity: z.string().trim().max(100),
  deliveryAddress: z.string().trim().max(300),
});

miscRouter.patch('/profile', authenticate, resolveStore(), h(async (req, res) => {
  const data = profileSchema.parse(req.body);
  await prisma.user.update({ where: { id: req.auth!.user.id }, data: {
    contactName: data.contactName || null,
    phone: data.phone || null,
    contactEmail: data.contactEmail || null,
    deliveryCity: data.deliveryCity || null,
    deliveryAddress: data.deliveryAddress || null,
  } });
  res.json({ ok: true });
}));

const subscriptionSchema = z.object({
  newArrivals: z.boolean(),
  priceDrops: z.boolean(),
  categoryIds: z.array(z.string()).max(30),
  brands: z.array(z.string().trim().min(1).max(80)).max(30),
  sizes: z.array(z.string().trim().min(1).max(40)).max(30),
});

miscRouter.get('/subscriptions', authenticate, resolveStore(), h(async (req, res) => {
  const subscription = await prisma.productSubscription.findUnique({ where: { storeId_userId: { storeId: req.store!.id, userId: req.auth!.user.id } } });
  res.json({ subscription: subscription ? {
    newArrivals: subscription.newArrivals, priceDrops: subscription.priceDrops,
    categoryIds: subscription.categoryIds, brands: subscription.brands, sizes: subscription.sizes,
  } : { newArrivals: false, priceDrops: false, categoryIds: [], brands: [], sizes: [] } });
}));

miscRouter.put('/subscriptions', authenticate, resolveStore(), h(async (req, res) => {
  const data = subscriptionSchema.parse(req.body);
  const categoryIds = [...new Set(data.categoryIds)];
  const count = await prisma.category.count({ where: { id: { in: categoryIds }, storeId: req.store!.id, status: 'active' } });
  if (count !== categoryIds.length) throw badRequest('Выберите категории этого магазина');
  const values = { ...data, categoryIds, brands: [...new Set(data.brands)], sizes: [...new Set(data.sizes)] };
  await prisma.productSubscription.upsert({
    where: { storeId_userId: { storeId: req.store!.id, userId: req.auth!.user.id } },
    create: { ...values, storeId: req.store!.id, userId: req.auth!.user.id },
    update: values,
  });
  res.json({ subscription: values });
}));

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

const productVideoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => {
  if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(file.mimetype)) return cb(badRequest('Видео товара: MP4, MOV или WebM до 20 МБ'));
  cb(null, true);
} });

miscRouter.post('/product-video', authenticate, resolveStore(), uploadLimiter, h(async (req, _res, next) => {
  const member = await prisma.storeMember.findUnique({ where: { storeId_userId: { storeId: req.store!.id, userId: req.auth!.user.id } } });
  if (!member) throw forbidden('Видео товара может загрузить только сотрудник магазина');
  next();
}), productVideoUpload.single('file'), h(async (req, res) => {
  const file = req.file;
  if (!file) throw badRequest('Выберите видео');
  const mp4 = file.buffer.subarray(4, 8).toString() === 'ftyp';
  const webm = file.buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (!mp4 && !webm) throw badRequest('Файл не является видео MP4, MOV или WebM');
  const disk = await fs.statfs(UPLOAD_DIR);
  if (disk.bavail * disk.bsize < 1024 ** 3 + file.size) throw badRequest('Недостаточно места для видео');
  const name = `${crypto.randomUUID()}.${webm ? 'webm' : file.mimetype === 'video/quicktime' ? 'mov' : 'mp4'}`;
  await fs.writeFile(path.join(UPLOAD_DIR, name), file.buffer, { flag: 'wx', mode: 0o600 });
  res.status(201).json({ url: `/uploads/${name}` });
}));
