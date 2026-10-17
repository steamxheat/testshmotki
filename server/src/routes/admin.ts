import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, conflict, forbidden, h, notFound } from '../lib/http.js';
import { rublesToKopecks } from '../lib/money.js';
import { presentCategory, presentOrder, presentProduct, presentReview, presentStore } from '../lib/present.js';
import { logEvent } from '../lib/stats.js';
import { authenticate } from '../middleware/auth.js';
import { requireStoreMember } from '../middleware/store.js';
import { notifyBuyer } from '../telegram/notify.js';

export const adminRouter = Router();

// Все админ-роуты проверяют авторизацию и принадлежность к магазину (§7, §9.8).
adminRouter.use('/:storeId', authenticate, requireStoreMember);

const CONDITIONS = ['new_with_tag', 'new_no_tag', 'excellent', 'good', 'has_issues'] as const;

// ---------------- Обзор (§7.1) ----------------

adminRouter.get(
  '/:storeId/overview',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const now = Date.now();
    const d7 = new Date(now - 7 * 864e5);
    const d30 = new Date(now - 30 * 864e5);

    const [active, reserved, newOrders, completed7, completed30, views7, views30, favAdds, productViews, orders] =
      await Promise.all([
        prisma.product.count({ where: { storeId, status: 'published' } }),
        prisma.product.count({ where: { storeId, status: 'reserved' } }),
        prisma.order.count({ where: { storeId, status: 'pending' } }),
        prisma.order.count({ where: { storeId, status: 'completed', updatedAt: { gte: d7 } } }),
        prisma.order.count({ where: { storeId, status: 'completed', updatedAt: { gte: d30 } } }),
        prisma.event.count({ where: { storeId, type: 'catalog_view', createdAt: { gte: d7 } } }),
        prisma.event.count({ where: { storeId, type: 'catalog_view', createdAt: { gte: d30 } } }),
        prisma.event.count({ where: { storeId, type: 'favorite_add', createdAt: { gte: d30 } } }),
        prisma.event.count({ where: { storeId, type: 'product_view', createdAt: { gte: d30 } } }),
        prisma.event.count({ where: { storeId, type: 'order_created', createdAt: { gte: d30 } } }),
      ]);

    const recent = await prisma.event.findMany({
      where: { storeId },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    res.json({
      activeProducts: active,
      reservedProducts: reserved,
      newOrders,
      completedOrders: { d7: completed7, d30: completed30 },
      catalogViews: { d7: views7, d30: views30 },
      favoriteAdds: favAdds,
      // конверсия из просмотра карточки в заявку (§7.1, §16)
      conversion: productViews ? Math.round((orders / productViews) * 1000) / 10 : 0,
      recentEvents: recent.map((e) => ({ type: e.type, createdAt: e.createdAt, meta: e.meta })),
    });
  }),
);

// ---------------- Товары (§7.2) ----------------

adminRouter.get(
  '/:storeId/products',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const { q, status, category, sort } = req.query as Record<string, string | undefined>;
    const where: Prisma.ProductWhereInput = { storeId };
    const and: Prisma.ProductWhereInput[] = [];
    if (q) and.push({ OR: [{ title: { contains: q, mode: 'insensitive' } }, { brand: { contains: q, mode: 'insensitive' } }, { sellerSku: { contains: q, mode: 'insensitive' } }] });
    if (status) and.push({ status: status as never });
    if (category) and.push({ categoryId: category });
    if (and.length) where.AND = and;

    const orderBy: Prisma.ProductOrderByWithRelationInput =
      sort === 'price_asc' ? { priceAmount: 'asc' } : sort === 'price_desc' ? { priceAmount: 'desc' } : { createdAt: 'desc' };

    const items = await prisma.product.findMany({
      where,
      orderBy,
      include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
    });
    res.json({ items: items.map((p) => presentProduct(p)) });
  }),
);

const productSchema = z.object({
  title: z.string().trim().min(3, 'Название от 3 символов').max(120),
  categoryId: z.string().nullish(),
  price: z.coerce.number().nonnegative(),
  oldPrice: z.coerce.number().positive().nullish(),
  condition: z.enum(CONDITIONS).nullish(),
  brand: z.string().trim().max(80).nullish(),
  size: z.string().trim().max(40).nullish(),
  color: z.string().trim().max(40).nullish(),
  description: z.string().trim().max(4000).nullish(),
  defects: z.string().trim().max(1000).nullish(),
  sellerSku: z.string().trim().max(60).nullish(),
  images: z.array(z.string().url()).max(10).default([]),
  publish: z.boolean().default(false),
});

function assertPublishable(d: z.infer<typeof productSchema>) {
  // обязательные поля при публикации (§7.2)
  if (!d.categoryId) throw badRequest('Для публикации выберите категорию');
  if (!(d.price > 0)) throw badRequest('Цена должна быть больше нуля');
  if (!d.condition) throw badRequest('Укажите состояние');
  if (!d.images.length) throw badRequest('Добавьте хотя бы одну фотографию');
  // старая цена должна быть больше текущей (§7.2)
  if (d.oldPrice != null && rublesToKopecks(d.oldPrice) <= rublesToKopecks(d.price)) {
    throw badRequest('Старая цена должна быть больше текущей');
  }
}

adminRouter.post(
  '/:storeId/products',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const d = productSchema.parse(req.body);
    if (d.oldPrice != null && rublesToKopecks(d.oldPrice) <= rublesToKopecks(d.price)) {
      throw badRequest('Старая цена должна быть больше текущей');
    }
    if (d.publish) assertPublishable(d);

    const product = await prisma.product.create({
      data: {
        storeId,
        categoryId: d.categoryId ?? null,
        title: d.title,
        priceAmount: rublesToKopecks(d.price),
        oldPriceAmount: d.oldPrice != null ? rublesToKopecks(d.oldPrice) : null,
        condition: d.condition ?? 'good',
        brand: d.brand ?? null,
        size: d.size ?? null,
        color: d.color ?? null,
        description: d.description ?? null,
        defects: d.defects ?? null,
        sellerSku: d.sellerSku ?? null,
        status: d.publish ? 'published' : 'draft',
        publishedAt: d.publish ? new Date() : null,
        images: { create: d.images.map((url, i) => ({ url, sortOrder: i })) },
      },
      include: { images: true },
    });
    res.status(201).json({ product: presentProduct(product) });
  }),
);

adminRouter.get(
  '/:storeId/products/:id',
  h(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, storeId: req.store!.id },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!product) throw notFound('Товар не найден');
    res.json({ product: presentProduct(product) });
  }),
);

adminRouter.patch(
  '/:storeId/products/:id',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const current = await prisma.product.findFirst({ where: { id: req.params.id, storeId } });
    if (!current) throw notFound('Товар не найден');
    const d = productSchema.parse(req.body);
    const willPublish = d.publish || current.status === 'published';
    if (willPublish) assertPublishable(d);

    const product = await prisma.$transaction(async (tx) => {
      await tx.productImage.deleteMany({ where: { productId: current.id } });
      return tx.product.update({
        where: { id: current.id },
        data: {
          categoryId: d.categoryId ?? null,
          title: d.title,
          priceAmount: rublesToKopecks(d.price),
          oldPriceAmount: d.oldPrice != null ? rublesToKopecks(d.oldPrice) : null,
          condition: d.condition ?? current.condition,
          brand: d.brand ?? null,
          size: d.size ?? null,
          color: d.color ?? null,
          description: d.description ?? null,
          defects: d.defects ?? null,
          sellerSku: d.sellerSku ?? null,
          status: d.publish && current.status === 'draft' ? 'published' : current.status,
          publishedAt: d.publish && !current.publishedAt ? new Date() : current.publishedAt,
          images: { create: d.images.map((url, i) => ({ url, sortOrder: i })) },
        },
        include: { images: { orderBy: { sortOrder: 'asc' } } },
      });
    });
    res.json({ product: presentProduct(product) });
  }),
);

// быстрое изменение статуса (§7.2). Reserved/sold ставятся системой, не вручную.
const statusSchema = z.object({ status: z.enum(['draft', 'published', 'archived']) });
adminRouter.post(
  '/:storeId/products/:id/status',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const { status } = statusSchema.parse(req.body);
    const product = await prisma.product.findFirst({ where: { id: req.params.id, storeId }, include: { images: true } });
    if (!product) throw notFound('Товар не найден');
    if (product.status === 'reserved') throw conflict('Нельзя изменить статус забронированного товара');

    if (status === 'published') {
      // публикация требует обязательные поля
      if (!product.categoryId || product.priceAmount <= 0 || !product.images.length) {
        throw badRequest('Для публикации заполните категорию, цену и фотографию');
      }
    }
    const updated = await prisma.product.update({
      where: { id: product.id },
      data: { status, publishedAt: status === 'published' && !product.publishedAt ? new Date() : product.publishedAt },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });
    res.json({ product: presentProduct(updated) });
  }),
);

// дублирование (§7.2)
adminRouter.post(
  '/:storeId/products/:id/duplicate',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const src = await prisma.product.findFirst({ where: { id: req.params.id, storeId }, include: { images: true } });
    if (!src) throw notFound('Товар не найден');
    const copy = await prisma.product.create({
      data: {
        storeId,
        categoryId: src.categoryId,
        title: `${src.title} (копия)`,
        description: src.description,
        priceAmount: src.priceAmount,
        oldPriceAmount: src.oldPriceAmount,
        brand: src.brand,
        size: src.size,
        color: src.color,
        condition: src.condition,
        defects: src.defects,
        sellerSku: src.sellerSku,
        status: 'draft',
        images: { create: src.images.map((i) => ({ url: i.url, sortOrder: i.sortOrder })) },
      },
      include: { images: { orderBy: { sortOrder: 'asc' } } },
    });
    res.status(201).json({ product: presentProduct(copy) });
  }),
);

// архивирование одного и массовое (§7.2). Удаление заменено архивированием.
adminRouter.post(
  '/:storeId/products/:id/archive',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const product = await prisma.product.findFirst({ where: { id: req.params.id, storeId } });
    if (!product) throw notFound('Товар не найден');
    if (product.status === 'reserved') throw conflict('Сначала завершите или отклоните бронь');
    await prisma.product.update({ where: { id: product.id }, data: { status: 'archived' } });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/:storeId/products/bulk-archive',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const ids = z.array(z.string()).parse(req.body?.ids ?? []);
    const result = await prisma.product.updateMany({
      where: { id: { in: ids }, storeId, status: { not: 'reserved' } },
      data: { status: 'archived' },
    });
    res.json({ archived: result.count });
  }),
);

// ---------------- Категории (§7.3) ----------------

adminRouter.get(
  '/:storeId/categories',
  h(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { storeId: req.store!.id, status: { not: 'archived' } },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { products: { where: { status: { not: 'archived' } } } } } },
    });
    res.json({ categories: categories.map(presentCategory) });
  }),
);

adminRouter.post(
  '/:storeId/categories',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const d = z
      .object({ name: z.string().trim().min(1).max(60), parentId: z.string().nullish(), sortOrder: z.coerce.number().int().optional() })
      .parse(req.body);
    const count = await prisma.category.count({ where: { storeId } });
    const category = await prisma.category.create({
      data: { storeId, name: d.name, parentId: d.parentId ?? null, sortOrder: d.sortOrder ?? count },
    });
    res.status(201).json({ category: presentCategory(category) });
  }),
);

adminRouter.patch(
  '/:storeId/categories/:id',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const d = z
      .object({ name: z.string().trim().min(1).max(60).optional(), sortOrder: z.coerce.number().int().optional(), parentId: z.string().nullish() })
      .parse(req.body);
    const cat = await prisma.category.findFirst({ where: { id: req.params.id, storeId } });
    if (!cat) throw notFound('Категория не найдена');
    const category = await prisma.category.update({
      where: { id: cat.id },
      data: { name: d.name ?? cat.name, sortOrder: d.sortOrder ?? cat.sortOrder, parentId: d.parentId === undefined ? cat.parentId : d.parentId },
    });
    res.json({ category: presentCategory(category) });
  }),
);

// архивировать можно только категорию без активных товаров (§7.3)
adminRouter.post(
  '/:storeId/categories/:id/archive',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const cat = await prisma.category.findFirst({ where: { id: req.params.id, storeId } });
    if (!cat) throw notFound('Категория не найдена');
    const active = await prisma.product.count({ where: { categoryId: cat.id, status: { not: 'archived' } } });
    if (active > 0) throw conflict('Сначала перенесите или архивируйте товары категории');
    await prisma.category.update({ where: { id: cat.id }, data: { status: 'archived' } });
    res.json({ ok: true });
  }),
);

// ---------------- Заказы (§7.4) ----------------

adminRouter.get(
  '/:storeId/orders',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const { status } = req.query as Record<string, string | undefined>;
    const orders = await prisma.order.findMany({
      where: { storeId, ...(status ? { status: status as never } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } },
        history: { orderBy: { createdAt: 'asc' } },
      },
    });
    res.json({ items: orders.map(presentOrder) });
  }),
);

// переходы статуса заявки и товара (§7.4)
async function transition(
  req: import('express').Request,
  action: 'accept' | 'reject' | 'complete',
) {
  const storeId = req.store!.id;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, storeId }, include: { buyer: true } });
  if (!order) throw notFound('Заказ не найден');

  const rules: Record<typeof action, { from: string[]; to: string; product?: string }> = {
    accept: { from: ['pending'], to: 'confirmed' }, // товар остаётся забронированным
    reject: { from: ['pending', 'confirmed'], to: 'rejected', product: 'published' },
    complete: { from: ['pending', 'confirmed'], to: 'completed', product: 'sold' },
  };
  const rule = rules[action];
  if (!rule.from.includes(order.status)) throw badRequest('Недопустимый переход статуса');

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { status: rule.to as never } });
    await tx.orderStatusHistory.create({
      data: { orderId: order.id, oldStatus: order.status, newStatus: rule.to as never, changedByUserId: req.auth!.user.id },
    });
    if (rule.product) {
      await tx.product.update({ where: { id: order.productId }, data: { status: rule.product as never } });
    }
  });

  logEvent({ storeId, userId: req.auth!.user.id, type: 'order_status_change', meta: { orderId: order.id, to: rule.to } });

  // уведомления покупателю (§8)
  if (action === 'accept') notifyBuyer.orderConfirmed(order.buyer.telegramId, order.publicNumber);
  if (action === 'reject') notifyBuyer.orderRejected(order.buyer.telegramId, order.publicNumber);
  if (action === 'complete') notifyBuyer.orderCompleted(order.buyer.telegramId, order.publicNumber);
}

adminRouter.post('/:storeId/orders/:id/accept', h(async (req, res) => { await transition(req, 'accept'); res.json({ ok: true }); }));
adminRouter.post('/:storeId/orders/:id/reject', h(async (req, res) => { await transition(req, 'reject'); res.json({ ok: true }); }));
adminRouter.post('/:storeId/orders/:id/complete', h(async (req, res) => { await transition(req, 'complete'); res.json({ ok: true }); }));

// ---------------- Отзывы (§7.5) ----------------

adminRouter.get(
  '/:storeId/reviews',
  h(async (req, res) => {
    const reviews = await prisma.review.findMany({
      where: { storeId: req.store!.id },
      orderBy: { createdAt: 'desc' },
      include: { author: { select: { firstName: true, avatarUrl: true } }, order: { select: { publicNumber: true } } },
    });
    res.json({
      items: reviews.map((r) => ({ ...presentReview(r), orderNumber: r.order.publicNumber })),
    });
  }),
);

// ответ продавца — можно редактировать (§7.5). Негативный отзыв удалить нельзя (§6.9).
adminRouter.post(
  '/:storeId/reviews/:id/reply',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const { reply } = z.object({ reply: z.string().trim().max(1000) }).parse(req.body);
    const review = await prisma.review.findFirst({ where: { id: req.params.id, storeId } });
    if (!review) throw notFound('Отзыв не найден');
    const updated = await prisma.review.update({ where: { id: review.id }, data: { sellerReply: reply } });
    res.json({ review: presentReview(updated) });
  }),
);

// жалоба суперадмину (§7.5)
adminRouter.post(
  '/:storeId/reviews/:id/report',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const { reason } = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    const review = await prisma.review.findFirst({ where: { id: req.params.id, storeId } });
    if (!review) throw notFound('Отзыв не найден');
    await prisma.report.create({
      data: { storeId, targetType: 'review', targetId: review.id, reason: reason ?? null, createdByUserId: req.auth!.user.id },
    });
    res.json({ ok: true });
  }),
);

// ---------------- Настройки магазина (§7.6) ----------------

adminRouter.get(
  '/:storeId/settings',
  h(async (req, res) => {
    const store = req.store!;
    const members = await prisma.storeMember.findMany({
      where: { storeId: store.id },
      include: { user: { select: { telegramId: true, firstName: true, username: true } } },
    });
    res.json({
      store: presentStore(store),
      members: members.map((m) => ({
        userId: m.userId,
        role: m.role,
        telegramId: String(m.user.telegramId),
        firstName: m.user.firstName,
        username: m.user.username,
      })),
    });
  }),
);

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  slug: z.string().trim().regex(/^[a-z0-9_]{3,32}$/, 'Адрес: латиница, цифры, _ (3–32)').optional(),
  description: z.string().trim().max(2000).nullish(),
  city: z.string().trim().max(100).nullish(),
  contactUsername: z.string().trim().max(64).nullish(),
  logoUrl: z.string().url().nullish(),
  coverUrl: z.string().url().nullish(),
  settings: z
    .object({
      deliveryMethods: z.array(z.enum(['meetup', 'cdek', 'russian_post', 'discuss'])).optional(),
      responseSchedule: z.string().max(200).nullish(),
      reservationRules: z.string().max(500).nullish(),
      socialLinks: z.record(z.string()).optional(),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      showSold: z.boolean().optional(),
      blocks: z.object({ newArrivals: z.boolean(), discounted: z.boolean(), recent: z.boolean() }).partial().optional(),
    })
    .optional(),
});

adminRouter.patch(
  '/:storeId/settings',
  h(async (req, res) => {
    const store = req.store!;
    const d = settingsSchema.parse(req.body);

    // смена адреса не чаще 1 раза в 30 дней (§7.6)
    if (d.slug && d.slug !== store.slug) {
      const prev = (store.settings as Record<string, unknown>).slugChangedAt as string | undefined;
      if (prev && Date.now() - new Date(prev).getTime() < 30 * 864e5) {
        throw conflict('Адрес можно менять не чаще одного раза в 30 дней');
      }
      const taken = await prisma.store.findUnique({ where: { slug: d.slug } });
      if (taken) throw conflict('Такой адрес уже занят', 'slug_taken');
    }

    const mergedSettings = {
      ...(store.settings as Record<string, unknown>),
      ...(d.settings ?? {}),
      ...(d.slug && d.slug !== store.slug ? { slugChangedAt: new Date().toISOString() } : {}),
    };

    const updated = await prisma.store.update({
      where: { id: store.id },
      data: {
        name: d.name ?? store.name,
        slug: d.slug ?? store.slug,
        description: d.description === undefined ? store.description : d.description,
        city: d.city === undefined ? store.city : d.city,
        contactUsername: d.contactUsername === undefined ? store.contactUsername : d.contactUsername,
        logoUrl: d.logoUrl === undefined ? store.logoUrl : d.logoUrl,
        coverUrl: d.coverUrl === undefined ? store.coverUrl : d.coverUrl,
        settings: mergedSettings as Prisma.InputJsonValue,
      },
    });
    res.json({ store: presentStore(updated) });
  }),
);

// сотрудники: добавление по Telegram ID (§7.6). Только владелец или суперадмин.
adminRouter.post(
  '/:storeId/members',
  h(async (req, res) => {
    const store = req.store!;
    if (!req.isSuperadmin) {
      const me = await prisma.storeMember.findUnique({ where: { storeId_userId: { storeId: store.id, userId: req.auth!.user.id } } });
      if (me?.role !== 'owner') throw forbidden('Добавлять сотрудников может только владелец');
    }
    const { telegramId } = z.object({ telegramId: z.coerce.string().regex(/^\d+$/) }).parse(req.body);
    const tgId = BigInt(telegramId);
    const user = await prisma.user.upsert({ where: { telegramId: tgId }, create: { telegramId: tgId }, update: {} });
    await prisma.storeMember.upsert({
      where: { storeId_userId: { storeId: store.id, userId: user.id } },
      create: { storeId: store.id, userId: user.id, role: 'manager' },
      update: {},
    });
    res.status(201).json({ ok: true });
  }),
);

adminRouter.delete(
  '/:storeId/members/:userId',
  h(async (req, res) => {
    const store = req.store!;
    const target = await prisma.storeMember.findUnique({ where: { storeId_userId: { storeId: store.id, userId: req.params.userId } } });
    if (!target) throw notFound('Сотрудник не найден');
    if (target.role === 'owner') throw badRequest('Нельзя удалить владельца');
    await prisma.storeMember.delete({ where: { storeId_userId: { storeId: store.id, userId: req.params.userId } } });
    res.json({ ok: true });
  }),
);
