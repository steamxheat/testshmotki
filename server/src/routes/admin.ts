import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, conflict, forbidden, h, notFound } from '../lib/http.js';
import { rublesToKopecks } from '../lib/money.js';
import { lockProducts, releaseOrderStock, syncProductStatus } from '../lib/inventory.js';
import { presentCategory, presentOrder, presentProduct, presentReview, presentStore, presentStoreSettings } from '../lib/present.js';
import { logEvent } from '../lib/stats.js';
import { authenticate } from '../middleware/auth.js';
import { requireStoreMember } from '../middleware/store.js';
import { notifyBuyer, queueProductAlert } from '../telegram/notify.js';
import { connectionFromSettings, quoteCdek, sellerCdekRequest, verifyCdekConnection, type CdekConnection } from '../lib/cdek.js';
import { refreshCdekShipment } from '../lib/shipment.js';
import { encryptCarrierSecret } from '../lib/carrier-secret.js';
import { config } from '../config.js';
import { bot } from '../telegram/bot.js';
import { publishProductToChannel } from '../telegram/channel.js';

export const adminRouter = Router();

// Все админ-роуты проверяют авторизацию и принадлежность к магазину (§7, §9.8).
adminRouter.use('/:storeId', authenticate, requireStoreMember);

const CONDITIONS = ['new_with_tag', 'new_no_tag', 'excellent', 'good', 'has_issues'] as const;
const imageUrl = z.string().regex(/^\/uploads\/[\w-]+\.(?:jpe?g|png|webp)$/, 'Сначала загрузите фото в магазин');

// ---------------- Обзор (§7.1) ----------------

adminRouter.get(
  '/:storeId/overview',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const now = Date.now();
    const d7 = new Date(now - 7 * 864e5);
    const d30 = new Date(now - 30 * 864e5);
    const today = new Date(); today.setHours(0, 0, 0, 0);

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

    const [sales, topProducts, todayVisitors, todayOrders] = await Promise.all([
      prisma.$queryRaw<{ revenue: bigint }[]>(Prisma.sql`SELECT COALESCE(SUM(oi.price_amount_snapshot::bigint * oi.quantity), 0)::bigint AS revenue
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.store_id = ${storeId} AND o.status = 'completed' AND o.refund_confirmed_at IS NULL AND o.updated_at >= ${d30}`),
      prisma.$queryRaw<{ productId: string; title: string; units: bigint; revenue: bigint }[]>(Prisma.sql`SELECT oi.product_id AS "productId", MAX(oi.title_snapshot) AS title,
        SUM(oi.quantity)::bigint AS units, SUM(oi.price_amount_snapshot::bigint * oi.quantity)::bigint AS revenue
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.store_id = ${storeId} AND o.status = 'completed' AND o.refund_confirmed_at IS NULL AND o.updated_at >= ${d30}
        GROUP BY oi.product_id ORDER BY revenue DESC LIMIT 5`),
      prisma.event.groupBy({ by: ['userId'], where: { storeId, type: 'store_view', createdAt: { gte: today } } }),
      prisma.order.count({ where: { storeId, createdAt: { gte: today } } }),
    ]);

    res.json({
      activeProducts: active,
      reservedProducts: reserved,
      newOrders,
      completedOrders: { d7: completed7, d30: completed30 },
      catalogViews: { d7: views7, d30: views30 },
      favoriteAdds: favAdds,
      // конверсия из просмотра карточки в заявку (§7.1, §16)
      conversion: productViews ? Math.round((orders / productViews) * 1000) / 10 : 0,
      todayVisitors: todayVisitors.length,
      todayOrders,
      revenue30: Number(sales[0]?.revenue ?? 0n) / 100,
      topProducts: topProducts.map((row) => ({ productId: row.productId, title: row.title, units: Number(row.units), revenue: Number(row.revenue) / 100 })),
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
    const page = z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
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
      orderBy: [orderBy, { id: 'desc' }],
      skip: (page - 1) * 40,
      take: 41,
      include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
    });
    res.json({ items: items.slice(0, 40).map((p) => presentProduct(p)), hasMore: items.length > 40 });
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
  variants: z.array(z.object({ size: z.string().trim().min(1).max(40), stock: z.number().int().min(0).max(10000) })).min(1).max(30).optional(),
  color: z.string().trim().max(40).nullish(),
  description: z.string().trim().max(4000).nullish(),
  defects: z.string().trim().max(1000).nullish(),
  gender: z.enum(['men', 'women', 'unisex']).nullish(),
  material: z.string().trim().max(200).nullish(),
  measurements: z.string().trim().max(2000).nullish(),
  defectImages: z.array(imageUrl).max(5).default([]),
  videoUrl: z.string().regex(/^\/uploads\/[0-9a-f-]+\.(?:mp4|webm|mov)$/).nullish(),
  sellerSku: z.string().trim().max(60).nullish(),
  images: z.array(imageUrl).max(10).default([]),
  publish: z.boolean().default(false),
}).superRefine((d, ctx) => {
  if (d.variants && new Set(d.variants.map((v) => v.size.toLowerCase())).size !== d.variants.length) {
    ctx.addIssue({ code: 'custom', path: ['variants'], message: 'Размеры не должны повторяться' });
  }
});

function assertPublishable(d: z.infer<typeof productSchema>) {
  // обязательные поля при публикации (§7.2)
  if (!d.categoryId) throw badRequest('Для публикации выберите категорию');
  if (!(d.price > 0)) throw badRequest('Цена должна быть больше нуля');
  if (!d.condition) throw badRequest('Укажите состояние');
  if (!d.images.length) throw badRequest('Добавьте хотя бы одну фотографию');
  if (d.variants && !d.variants.some((v) => v.stock > 0)) throw badRequest('Укажите хотя бы одну единицу товара');
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
        size: d.variants?.[0]?.size ?? d.size ?? null,
        variants: { create: (d.variants ?? [{ size: d.size || 'Единый размер', stock: 1 }]).map((v) => ({ size: v.size, stockQuantity: v.stock })) },
        color: d.color ?? null,
        description: d.description ?? null,
        defects: d.defects ?? null,
        gender: d.gender ?? null,
        material: d.material ?? null,
        measurements: d.measurements ?? null,
        defectImages: d.defectImages,
        videoUrl: d.videoUrl ?? null,
        sellerSku: d.sellerSku ?? null,
        status: d.publish ? 'published' : 'draft',
        publishedAt: d.publish ? new Date() : null,
        images: { create: d.images.map((url, i) => ({ url, sortOrder: i })) },
      },
      include: { images: true, variants: true },
    });
    if (d.publish) {
      await publishProductToChannel(product.id);
      await queueProductAlert(product, req.store!, 'newArrivals', presentStoreSettings(req.store!).currency).catch((error) => console.error('[alerts] new arrival', error));
    }
    res.status(201).json({ product: presentProduct(product) });
  }),
);

adminRouter.get(
  '/:storeId/products/:id',
  h(async (req, res) => {
    const product = await prisma.product.findFirst({
      where: { id: req.params.id, storeId: req.store!.id },
      include: { images: { orderBy: { sortOrder: 'asc' } }, variants: { orderBy: { size: 'asc' } } },
    });
    if (!product) throw notFound('Товар не найден');
    res.json({ product: presentProduct(product) });
  }),
);

adminRouter.patch(
  '/:storeId/products/:id',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const current = await prisma.product.findFirst({ where: { id: req.params.id, storeId }, include: { variants: true } });
    if (!current) throw notFound('Товар не найден');
    const d = productSchema.parse(req.body);
    const willPublish = d.publish || current.status === 'published';
    if (willPublish) assertPublishable(d);

    const product = await prisma.$transaction(async (tx) => {
      await lockProducts(tx, [current.id]);
      const locked = await tx.product.findUniqueOrThrow({ where: { id: current.id }, include: { variants: true } });
      if (d.variants) {
        for (const v of d.variants) {
          const existing = locked.variants.find((item) => item.size === v.size);
          if (existing) {
            if (v.stock < existing.reservedQuantity + existing.soldQuantity) throw conflict(`Нельзя уменьшить остаток размера ${v.size}: часть уже забронирована или продана`);
            await tx.productVariant.update({ where: { id: existing.id }, data: { stockQuantity: v.stock } });
          } else await tx.productVariant.create({ data: { productId: current.id, size: v.size, stockQuantity: v.stock } });
        }
        for (const v of locked.variants.filter((item) => !d.variants!.some((next) => next.size === item.size))) {
          if (v.reservedQuantity || v.soldQuantity || await tx.orderItem.count({ where: { variantId: v.id } })) throw conflict(`Размер ${v.size} есть в истории заказов: оставьте его с нулевым доступным остатком`);
          await tx.productVariant.delete({ where: { id: v.id } });
        }
      }
      await tx.productImage.deleteMany({ where: { productId: current.id } });
      await tx.product.update({
        where: { id: current.id },
        data: {
          categoryId: d.categoryId ?? null,
          title: d.title,
          priceAmount: rublesToKopecks(d.price),
          oldPriceAmount: d.oldPrice != null ? rublesToKopecks(d.oldPrice) : null,
          condition: d.condition ?? locked.condition,
          brand: d.brand ?? null,
          size: d.variants?.[0]?.size ?? d.size ?? null,
          color: d.color ?? null,
          description: d.description ?? null,
          defects: d.defects ?? null,
          gender: d.gender ?? null,
          material: d.material ?? null,
          measurements: d.measurements ?? null,
          defectImages: d.defectImages,
          videoUrl: d.videoUrl ?? null,
          sellerSku: d.sellerSku ?? null,
          status: d.publish && locked.status === 'draft' ? 'published' : locked.status,
          publishedAt: d.publish && !locked.publishedAt ? new Date() : locked.publishedAt,
          images: { create: d.images.map((url, i) => ({ url, sortOrder: i })) },
        },
      });
      await syncProductStatus(tx, [current.id]);
      return tx.product.findUniqueOrThrow({ where: { id: current.id }, include: { images: { orderBy: { sortOrder: 'asc' } }, variants: true } });
    });
    if (current.status !== 'published' && product.status === 'published') await publishProductToChannel(product.id);
    if (!current.publishedAt && product.status === 'published') await queueProductAlert(product, req.store!, 'newArrivals', presentStoreSettings(req.store!).currency).catch((error) => console.error('[alerts] new arrival', error));
    else if (current.status === 'published' && product.status === 'published' && product.priceAmount < current.priceAmount) await queueProductAlert(product, req.store!, 'priceDrops', presentStoreSettings(req.store!).currency).catch((error) => console.error('[alerts] price drop', error));
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
    const result = await prisma.$transaction(async (tx) => {
      await lockProducts(tx, [req.params.id]);
      const product = await tx.product.findFirst({ where: { id: req.params.id, storeId }, include: { images: true, variants: true } });
      if (!product) throw notFound('Товар не найден');
      if (product.variants.some((v) => v.reservedQuantity > 0)) throw conflict('Сначала завершите или отклоните бронь');
      if (status === 'published' && (!product.categoryId || product.priceAmount <= 0 || !product.images.length || !product.variants.some((v) => v.stockQuantity > v.soldQuantity))) {
        throw badRequest('Для публикации заполните категорию, цену, фотографию и остаток');
      }
      const updated = await tx.product.update({
        where: { id: product.id },
        data: { status, publishedAt: status === 'published' && !product.publishedAt ? new Date() : product.publishedAt },
        include: { images: { orderBy: { sortOrder: 'asc' } }, variants: true },
      });
      return { updated, becamePublished: status === 'published' && product.status !== 'published', firstPublished: status === 'published' && !product.publishedAt };
    });
    if (result.becamePublished) await publishProductToChannel(result.updated.id);
    if (result.firstPublished) await queueProductAlert(result.updated, req.store!, 'newArrivals', presentStoreSettings(req.store!).currency).catch((error) => console.error('[alerts] new arrival', error));
    res.json({ product: presentProduct(result.updated) });
  }),
);

// дублирование (§7.2)
adminRouter.post(
  '/:storeId/products/:id/duplicate',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const src = await prisma.product.findFirst({ where: { id: req.params.id, storeId }, include: { images: true, variants: true } });
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
        gender: src.gender,
        material: src.material,
        measurements: src.measurements,
        defectImages: src.defectImages ?? [],
        videoUrl: src.videoUrl,
        sellerSku: src.sellerSku,
        status: 'draft',
        variants: { create: src.variants.map((v) => ({ size: v.size, stockQuantity: Math.max(0, v.stockQuantity - v.reservedQuantity - v.soldQuantity) })) },
        images: { create: src.images.map((i) => ({ url: i.url, sortOrder: i.sortOrder })) },
      },
      include: { images: { orderBy: { sortOrder: 'asc' } }, variants: true },
    });
    res.status(201).json({ product: presentProduct(copy) });
  }),
);

// архивирование одного и массовое (§7.2). Удаление заменено архивированием.
adminRouter.post(
  '/:storeId/products/:id/archive',
  h(async (req, res) => {
    const storeId = req.store!.id;
    await prisma.$transaction(async (tx) => {
      await lockProducts(tx, [req.params.id]);
      const product = await tx.product.findFirst({ where: { id: req.params.id, storeId }, include: { variants: true } });
      if (!product) throw notFound('Товар не найден');
      if (product.variants.some((v) => v.reservedQuantity > 0)) throw conflict('Сначала завершите или отклоните бронь');
      await tx.product.update({ where: { id: product.id }, data: { status: 'archived' } });
    });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/:storeId/products/bulk-archive',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const ids = z.array(z.string()).max(500).parse(req.body?.ids ?? []);
    const result = await prisma.$transaction(async (tx) => {
      await lockProducts(tx, ids);
      return tx.product.updateMany({
        where: { id: { in: ids }, storeId, variants: { none: { reservedQuantity: { gt: 0 } } } },
        data: { status: 'archived' },
      });
    });
    res.json({ archived: result.count });
  }),
);

const bulkIds = z.array(z.string()).min(1).max(100).transform((ids) => [...new Set(ids)]);

adminRouter.post('/:storeId/products/bulk-price', h(async (req, res) => {
  const { ids, percent } = z.object({ ids: bulkIds, percent: z.number().int().min(-90).max(500).refine((value) => value !== 0) }).parse(req.body);
  const changed = await prisma.$transaction(async (tx) => {
    await lockProducts(tx, ids);
    const products = await tx.product.findMany({ where: { id: { in: ids }, storeId: req.store!.id }, include: { variants: true } });
    if (products.length !== ids.length) throw notFound('Один из товаров не найден в этом магазине');
    if (products.some((product) => product.status === 'sold' || product.status === 'archived' || product.status === 'reserved')) throw conflict('Забронированные, проданные и архивные товары не меняются массово');
    const updated = [];
    for (const product of products) {
      const priceAmount = Math.round(product.priceAmount * (100 + percent) / 100);
      if (priceAmount < 1 || priceAmount > 2_000_000_000) throw badRequest('Итоговая цена должна быть больше нуля и не превышать лимит');
      updated.push(await tx.product.update({ where: { id: product.id }, data: {
        priceAmount,
        oldPriceAmount: percent < 0 ? product.priceAmount : product.oldPriceAmount && product.oldPriceAmount > priceAmount ? product.oldPriceAmount : null,
      }, include: { variants: true } }));
    }
    return updated;
  }, { timeout: 20_000 });
  if (percent < 0) for (const product of changed.filter((item) => item.status === 'published')) {
    await queueProductAlert(product, req.store!, 'priceDrops', presentStoreSettings(req.store!).currency).catch((error) => console.error('[alerts] price drop', error));
  }
  res.json({ changed: changed.length });
}));

adminRouter.post('/:storeId/products/bulk-status', h(async (req, res) => {
  const { ids, status } = z.object({ ids: bulkIds, status: z.enum(['draft', 'published', 'archived']) }).parse(req.body);
  const published = await prisma.$transaction(async (tx) => {
    await lockProducts(tx, ids);
    const products = await tx.product.findMany({ where: { id: { in: ids }, storeId: req.store!.id }, include: { variants: true, images: true } });
    if (products.length !== ids.length) throw notFound('Один из товаров не найден в этом магазине');
    if (products.some((product) => product.status === 'reserved' || product.status === 'sold' || product.variants.some((variant) => variant.reservedQuantity > 0))) throw conflict('Забронированные и проданные товары нельзя менять массово');
    if (status === 'published' && products.some((product) => !product.categoryId || !product.priceAmount || !product.images.length || !product.variants.some((variant) => variant.stockQuantity > variant.soldQuantity))) throw badRequest('Для публикации каждому товару нужны категория, цена, фото и остаток');
    const activated = products.filter((product) => status === 'published' && product.status !== 'published');
    const newlyPublished = activated.filter((product) => !product.publishedAt).map((product) => product.id);
    await tx.product.updateMany({ where: { id: { in: ids }, storeId: req.store!.id }, data: { status } });
    if (newlyPublished.length) await tx.product.updateMany({ where: { id: { in: newlyPublished } }, data: { publishedAt: new Date() } });
    return { newIds: new Set(newlyPublished), products: activated.length ? await tx.product.findMany({ where: { id: { in: activated.map((product) => product.id) } }, include: { variants: true } }) : [] };
  }, { timeout: 20_000 });
  for (const product of published.products) {
    if (published.newIds.has(product.id)) await queueProductAlert(product, req.store!, 'newArrivals', presentStoreSettings(req.store!).currency).catch((error) => console.error('[alerts] new arrival', error));
    await publishProductToChannel(product.id);
  }
  res.json({ changed: ids.length });
}));

adminRouter.post('/:storeId/products/:id/channel', h(async (req, res) => {
  await requireOwner(req);
  const product = await prisma.product.findFirst({ where: { id: req.params.id, storeId: req.store!.id } });
  if (!product) throw notFound('Товар не найден');
  if (product.status !== 'published') throw badRequest('В канал можно отправить только опубликованный товар');
  await publishProductToChannel(product.id);
  const result = await prisma.product.findUniqueOrThrow({ where: { id: product.id }, select: { channelPostAt: true, channelPostError: true, channelPostChat: true } });
  if (result.channelPostError) throw badRequest(`Не удалось отправить в канал: ${result.channelPostError}`);
  res.json({ channel: result });
}));

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
    const page = z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
    const orders = await prisma.order.findMany({
      where: { storeId, ...(status ? { status: status as never } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * 30,
      take: 31,
      include: {
        product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } },
        history: { orderBy: { createdAt: 'asc' } },
        items: true,
        shipment: true,
      },
    });
    res.json({ items: orders.slice(0, 30).map((o) => presentOrder(o)), hasMore: orders.length > 30 });
  }),
);

// переходы статуса заявки и товара (§7.4)
async function transition(
  req: import('express').Request,
  action: 'accept' | 'reject' | 'send' | 'complete',
) {
  const storeId = req.store!.id;
  const order = await prisma.order.findFirst({ where: { id: req.params.id, storeId }, include: { buyer: true, shipment: true } });
  if (!order) throw notFound('Заказ не найден');

  const rules: Record<typeof action, { from: string[]; to: string; product?: string }> = {
    accept: { from: ['pending'], to: 'confirmed' }, // товар остаётся забронированным
    reject: { from: ['pending', 'confirmed'], to: 'rejected', product: 'published' },
    send: { from: ['confirmed'], to: 'sent' },
    complete: { from: ['confirmed', 'sent'], to: 'completed', product: 'sold' },
  };
  const rule = rules[action];
  if (!rule.from.includes(order.status)) throw badRequest('Недопустимый переход статуса');
  if (action === 'reject' && (order.paymentConfirmedAt || order.receiptSubmittedAt)) throw badRequest('Оплаченный заказ или заявку с чеком нельзя отклонить. Проверьте оплату и при необходимости оформите возврат.');
  if ((action === 'send' || action === 'complete') && !order.paymentConfirmedAt) throw badRequest('Сначала подтвердите получение оплаты');
  if (action === 'send' && (order.deliveryMethod === 'meetup' || order.deliveryMethod === 'discuss')) throw badRequest('Для личной встречи используйте завершение после передачи вещи');
  if (action === 'send' && (!order.shipment?.trackingNumber || order.shipment.state !== 'created')) throw badRequest('Сначала внесите действительный трек-номер или дождитесь оформления отправления');
  if (action === 'send' && order.shipment?.mode === 'test') throw badRequest('Тестовое отправление СДЭК нельзя отметить как реально переданное');
  if (action === 'complete' && order.status === 'confirmed' && !['meetup', 'discuss'].includes(order.deliveryMethod)) throw badRequest('Сначала отметьте передачу отправления перевозчику');

  await prisma.$transaction(async (tx) => {
    const changed = await tx.order.updateMany({ where: { id: order.id, status: order.status,
      ...(action === 'reject' ? { paymentConfirmedAt: null, receiptSubmittedAt: null } : {}),
      ...((action === 'send' || action === 'complete') ? { paymentConfirmedAt: { not: null } } : {}),
    }, data: {
      status: rule.to as never,
      ...(action === 'accept' ? { reservedUntil: new Date(Date.now() + config.reservationHours * 3600_000) } : {}),
    } });
    if (changed.count === 0) throw conflict('Заявку уже обработали');
    await tx.orderStatusHistory.create({
      data: { orderId: order.id, oldStatus: order.status, newStatus: rule.to as never, changedByUserId: req.auth!.user.id },
    });
    if (rule.product) {
      await releaseOrderStock(tx, order.id, action === 'complete');
    }
  });

  logEvent({ storeId, userId: req.auth!.user.id, type: 'order_status_change', meta: { orderId: order.id, to: rule.to } });

  // уведомления покупателю (§8)
  if (action === 'accept') {
    if (order.deliveryMethod === 'cdek' && order.deliveryPriceAmount == null) notifyBuyer.deliveryAwaitingPrice(order.buyer.telegramId, order.publicNumber, req.store!.slug);
    else notifyBuyer.orderConfirmed(order.buyer.telegramId, order.publicNumber, req.store!.slug);
  }
  if (action === 'reject') notifyBuyer.orderRejected(order.buyer.telegramId, order.publicNumber, req.store!.slug);
  if (action === 'send') notifyBuyer.orderSent(order.buyer.telegramId, order.publicNumber, order.shipment!.trackingNumber!, req.store!.slug);
  if (action === 'complete') notifyBuyer.orderCompleted(order.buyer.telegramId, order.publicNumber, req.store!.slug);
}

adminRouter.post('/:storeId/orders/:id/accept', h(async (req, res) => { await transition(req, 'accept'); res.json({ ok: true }); }));
adminRouter.post('/:storeId/orders/:id/reject', h(async (req, res) => { await transition(req, 'reject'); res.json({ ok: true }); }));
adminRouter.post('/:storeId/orders/:id/send', h(async (req, res) => { await transition(req, 'send'); res.json({ ok: true }); }));
adminRouter.post('/:storeId/orders/:id/complete', h(async (req, res) => { await transition(req, 'complete'); res.json({ ok: true }); }));

adminRouter.post('/:storeId/orders/:id/refund', h(async (req, res) => {
  const { reference } = z.object({ reference: z.string().trim().min(3).max(200) }).parse(req.body);
  const order = await prisma.order.findFirst({ where: { id: req.params.id, storeId: req.store!.id }, include: { buyer: true, shipment: true } });
  if (!order) throw notFound('Заказ не найден');
  if (order.status !== 'confirmed' || !order.paymentConfirmedAt) throw badRequest('Возврат доступен только для подтверждённого оплаченного заказа до отправки');
  if (order.shipment) throw badRequest('Сначала отмените отправление у перевозчика и обратитесь в поддержку магазина');
  const amount = order.priceAmountSnapshot + (order.deliveryPriceAmount ?? 0);
  await prisma.$transaction(async (tx) => {
    const changed = await tx.order.updateMany({ where: { id: order.id, status: 'confirmed', paymentConfirmedAt: { not: null }, refundConfirmedAt: null }, data: {
      status: 'cancelled', refundAmount: amount, refundConfirmedAt: new Date(), refundReference: reference,
    } });
    if (!changed.count) throw conflict('Статус заказа уже изменился');
    await tx.orderStatusHistory.create({ data: { orderId: order.id, oldStatus: 'confirmed', newStatus: 'cancelled', changedByUserId: req.auth!.user.id } });
    await releaseOrderStock(tx, order.id, false);
  });
  notifyBuyer.orderRefunded(order.buyer.telegramId, order.publicNumber, req.store!.slug);
  res.json({ ok: true });
}));

adminRouter.post('/:storeId/orders/:id/payment-reject', h(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(10).max(500) }).parse(req.body);
  const order = await prisma.order.findFirst({ where: { id: req.params.id, storeId: req.store!.id }, include: { buyer: true } });
  if (!order) throw notFound('Заказ не найден');
  if (order.status !== 'confirmed' || !order.receiptSubmittedAt || order.paymentConfirmedAt) throw badRequest('Можно отклонить только неподтверждённый платёж с приложенным чеком');
  await prisma.$transaction(async (tx) => {
    const changed = await tx.order.updateMany({ where: { id: order.id, status: 'confirmed', receiptSubmittedAt: { not: null }, paymentConfirmedAt: null }, data: { status: 'rejected', rejectionReason: reason } });
    if (!changed.count) throw conflict('Статус заказа уже изменился');
    await tx.orderStatusHistory.create({ data: { orderId: order.id, oldStatus: 'confirmed', newStatus: 'rejected', changedByUserId: req.auth!.user.id } });
    await releaseOrderStock(tx, order.id, false);
  });
  notifyBuyer.paymentRejected(order.buyer.telegramId, order.publicNumber, reason, req.store!.slug);
  res.json({ ok: true });
}));

adminRouter.post('/:storeId/orders/:id/payment-confirm', h(async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, storeId: req.store!.id }, include: { buyer: true } });
  if (!order) throw notFound('Заказ не найден');
  if (order.status !== 'confirmed' || order.paymentConfirmedAt) throw badRequest('Оплату нельзя подтвердить в этом статусе');
  if (order.deliveryMethod === 'cdek' && order.deliveryPriceAmount == null) throw badRequest('Сначала согласуйте стоимость доставки');
  const changed = await prisma.order.updateMany({ where: { id: order.id, status: 'confirmed', paymentConfirmedAt: null }, data: { paymentConfirmedAt: new Date() } });
  if (!changed.count) throw conflict('Оплату уже подтвердили');
  notifyBuyer.paymentConfirmed(order.buyer.telegramId, order.publicNumber, req.store!.slug);
  res.json({ ok: true });
}));

// Ключи перевозчика доступны только владельцу и никогда не возвращаются в ответах API.
async function requireOwner(req: import('express').Request) {
  const member = await prisma.storeMember.findUnique({ where: { storeId_userId: { storeId: req.store!.id, userId: req.auth!.user.id } } });
  if (member?.role !== 'owner') throw forbidden('Настройки магазина доступны только владельцу');
}

const cdekConnectionSchema = z.object({
  clientId: z.string().trim().min(4).max(200),
  clientSecret: z.string().trim().min(8).max(500),
  mode: z.enum(['test', 'live']),
  originCityCode: z.coerce.number().int().positive(),
  originPoint: z.string().trim().regex(/^[A-Za-z0-9-]{2,32}$/, 'Выберите ПВЗ сдачи из списка'),
  senderName: z.string().trim().min(2).max(100),
  senderPhone: z.string().trim().regex(/^\+?\d[\d\s()\-]{9,24}$/, 'Укажите телефон с кодом страны'),
  weight: z.coerce.number().int().min(100).max(30000),
  length: z.coerce.number().int().min(1).max(200),
  width: z.coerce.number().int().min(1).max(200),
  height: z.coerce.number().int().min(1).max(200),
});

adminRouter.get('/:storeId/delivery/cdek', h(async (req, res) => {
  await requireOwner(req);
  const raw = (req.store!.settings as Record<string, unknown>).cdekConnection as Record<string, unknown> | undefined;
  res.json({ connection: raw ? {
    connected: true, clientId: raw.clientId, mode: raw.mode, originCityCode: raw.originCityCode, originPoint: raw.originPoint,
    senderName: raw.senderName, senderPhone: raw.senderPhone,
    weight: raw.weight, length: raw.length, width: raw.width, height: raw.height,
  } : { connected: false } });
}));

adminRouter.put('/:storeId/delivery/cdek', h(async (req, res) => {
  await requireOwner(req);
  const d = cdekConnectionSchema.parse(req.body);
  const connection: CdekConnection = { ...d, secret: d.clientSecret };
  await verifyCdekConnection(connection);
  const fresh = await prisma.store.findUniqueOrThrow({ where: { id: req.store!.id } });
  await prisma.store.update({ where: { id: fresh.id }, data: { settings: {
    ...(fresh.settings as Record<string, unknown>),
    cdekConnection: { ...d, clientSecret: undefined, secret: encryptCarrierSecret(d.clientSecret) },
  } as Prisma.InputJsonValue } });
  res.json({ connected: true, mode: d.mode });
}));

adminRouter.delete('/:storeId/delivery/cdek', h(async (req, res) => {
  await requireOwner(req);
  const fresh = await prisma.store.findUniqueOrThrow({ where: { id: req.store!.id } });
  const settings = { ...(fresh.settings as Record<string, unknown>) };
  delete settings.cdekConnection;
  settings.cdekMode = 'manual';
  await prisma.store.update({ where: { id: fresh.id }, data: { settings: settings as Prisma.InputJsonValue } });
  res.json({ connected: false });
}));

adminRouter.post('/:storeId/orders/:id/cdek/quote', h(async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, storeId: req.store!.id } });
  if (!order) throw notFound('Заказ не найден');
  if (order.status !== 'confirmed' || !order.paymentConfirmedAt || order.deliveryMethod !== 'cdek' || !order.deliveryPointCode || !order.deliveryCityCode) {
    throw badRequest('Для расчёта нужен подтверждённый и оплаченный заказ с выбранным ПВЗ СДЭК');
  }
  if (await prisma.shipment.findUnique({ where: { orderId: order.id } })) throw conflict('Отправление по заказу уже начато');
  if (order.deliveryTariff === 'Ручное оформление') throw badRequest('Этот заказ оформляется вручную');
  const connection = connectionFromSettings(req.store!.settings);
  if (!connection) throw badRequest('Сначала подключите СДЭК в настройках');
  const quote = await quoteCdek(connection, order.deliveryCityCode, order.deliveryPointCode);
  if (order.deliveryPriceAmount != null && order.deliveryPriceAmount !== Math.round(quote.price * 100)) throw conflict('Тариф СДЭК изменился после заявки. Согласуйте разницу с покупателем и оформите отправление вручную.');
  res.json({ quote, mode: connection.mode });
}));

adminRouter.post('/:storeId/orders/:id/cdek/create', h(async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, storeId: req.store!.id }, include: { items: true } });
  if (!order) throw notFound('Заказ не найден');
  if (order.status !== 'confirmed' || !order.paymentConfirmedAt || order.deliveryMethod !== 'cdek' || !order.deliveryPointCode || !order.deliveryCityCode || !order.buyerPhone) {
    throw badRequest('Нужен подтверждённый оплаченный заказ с ПВЗ и телефоном покупателя');
  }
  if (order.deliveryTariff === 'Ручное оформление') throw badRequest('Этот заказ оформляется вручную');
  const connection = connectionFromSettings(req.store!.settings);
  if (!connection) throw badRequest('Сначала подключите СДЭК в настройках');
  if (req.body?.mode !== connection.mode || req.body?.confirmed !== true) throw badRequest('Подтвердите среду и оформление накладной');
  const quote = await quoteCdek(connection, order.deliveryCityCode, order.deliveryPointCode);
  if (order.deliveryPriceAmount != null && order.deliveryPriceAmount !== Math.round(quote.price * 100)) throw conflict('Цена СДЭК изменилась после заявки. Автоматическая накладная остановлена.');
  if (req.body?.tariffCode !== quote.tariffCode || req.body?.priceAmount !== Math.round(quote.price * 100)) throw conflict('Тариф или цена СДЭК изменились. Рассчитайте заново и подтвердите новую сумму.');
  const shipment = await prisma.shipment.create({ data: {
    orderId: order.id, storeId: order.storeId, carrier: 'cdek', mode: connection.mode, state: 'creating',
    originPoint: quote.originPoint, tariffCode: quote.tariffCode, tariffName: quote.tariffName,
    priceAmount: Math.round(quote.price * 100),
  } }).catch((error) => {
    if ((error as { code?: string }).code === 'P2002') throw conflict('Отправление уже оформляется — проверьте его статус');
    throw error;
  });
  try {
    const answer = await sellerCdekRequest(connection, '/orders', {
      type: 2, number: order.id, tariff_code: quote.tariffCode,
      shipment_point: quote.originPoint, delivery_point: order.deliveryPointCode,
      sender: { name: connection.senderName, company: req.store!.name, phones: [{ number: connection.senderPhone }] },
      recipient: { name: order.buyerName, phones: [{ number: order.buyerPhone }], ...(order.buyerEmail ? { email: order.buyerEmail } : {}) },
      packages: [{ number: '1', weight: connection.weight, length: connection.length, width: connection.width, height: connection.height, comment: order.productTitleSnapshot.slice(0, 255) }],
      comment: `Магазин ${req.store!.name}, заказ ${order.publicNumber}`.slice(0, 255),
    });
    const uuid = answer.entity?.uuid;
    if (typeof uuid !== 'string') throw new Error('CDEK did not return UUID');
    const updated = await prisma.shipment.update({ where: { id: shipment.id }, data: { externalUuid: uuid, requestUuid: answer.requests?.[0]?.request_uuid || null, state: 'submitted' } });
    res.status(202).json({ shipment: { state: updated.state, mode: updated.mode, requestUuid: updated.requestUuid } });
  } catch (error) {
    // shortcut: у заказа типа «Доставка» СДЭК не ищет по номеру ИМ; после таймаута нужен ответ поддержки, не повторное создание.
    await prisma.shipment.update({ where: { id: shipment.id }, data: { state: 'unknown', error: 'Результат отправки неизвестен. Не создавайте дубль: обратитесь в поддержку СДЭК с временем запроса и ID ' + order.id } });
    throw error;
  }
}));

adminRouter.post('/:storeId/orders/:id/cdek/check', h(async (req, res) => {
  const shipment = await prisma.shipment.findFirst({ where: { orderId: req.params.id, storeId: req.store!.id, carrier: 'cdek' } });
  if (!shipment) throw notFound('Отправление не найдено');
  res.json({ shipment: await refreshCdekShipment(shipment.id) });
}));

adminRouter.post('/:storeId/orders/:id/cdek/manual-price', h(async (req, res) => {
  const { price } = z.object({ price: z.number().finite().nonnegative().max(100000) }).parse(req.body);
  const order = await prisma.order.findFirst({ where: { id: req.params.id, storeId: req.store!.id }, include: { buyer: true } });
  if (!order) throw notFound('Заказ не найден');
  if (order.status !== 'confirmed' || order.deliveryMethod !== 'cdek' || order.deliveryTariff !== 'Ручное оформление' || order.deliveryPriceAmount != null || order.paymentConfirmedAt || order.receiptSubmittedAt) throw badRequest('Стоимость можно установить один раз до оплаты ручного заказа СДЭК');
  const changed = await prisma.order.updateMany({ where: { id: order.id, status: 'confirmed', deliveryPriceAmount: null, paymentConfirmedAt: null, receiptSubmittedAt: null }, data: { deliveryPriceAmount: rublesToKopecks(price), reservedUntil: new Date(Date.now() + config.reservationHours * 3600_000) } });
  if (!changed.count) throw conflict('Стоимость уже установлена');
  notifyBuyer.deliveryPriceSet(order.buyer.telegramId, order.publicNumber, (order.priceAmountSnapshot + rublesToKopecks(price)) / 100, req.store!.slug, presentStoreSettings(req.store!).currency);
  res.json({ ok: true });
}));

adminRouter.post('/:storeId/orders/:id/cdek/manual-tracking', h(async (req, res) => {
  const { trackingNumber } = z.object({ trackingNumber: z.string().trim().regex(/^[A-Za-z0-9-]{6,40}$/, 'Проверьте трек-номер СДЭК') }).parse(req.body);
  const order = await prisma.order.findFirst({ where: { id: req.params.id, storeId: req.store!.id }, include: { buyer: true } });
  if (!order) throw notFound('Заказ не найден');
  if (order.status !== 'confirmed' || !order.paymentConfirmedAt || order.deliveryMethod !== 'cdek' || order.deliveryTariff !== 'Ручное оформление') throw badRequest('Сначала подтвердите оплату ручного заказа СДЭК');
  if (await prisma.shipment.findUnique({ where: { orderId: order.id } })) throw conflict('Трек-номер по заказу уже указан');
  await prisma.shipment.create({ data: { orderId: order.id, storeId: order.storeId, carrier: 'cdek', mode: 'manual', state: 'created', trackingNumber, tariffName: order.deliveryTariff, priceAmount: order.deliveryPriceAmount } }).catch((error) => {
    if ((error as { code?: string }).code === 'P2002') throw conflict('Трек-номер по заказу уже указан');
    throw error;
  });
  notifyBuyer.shipmentRegistered(order.buyer.telegramId, order.publicNumber, trackingNumber, req.store!.slug);
  res.json({ ok: true });
}));

adminRouter.post('/:storeId/orders/:id/manual-shipment', h(async (req, res) => {
  const { trackingNumber } = z.object({ trackingNumber: z.string().trim().regex(/^[A-Za-z0-9-]{6,40}$/, 'Проверьте трек-номер') }).parse(req.body);
  const order = await prisma.order.findFirst({ where: { id: req.params.id, storeId: req.store!.id }, include: { buyer: true } });
  if (!order) throw notFound('Заказ не найден');
  if (order.status !== 'confirmed' || !order.paymentConfirmedAt || !['russian_post', 'yandex_delivery', 'dhl'].includes(order.deliveryMethod)) {
    throw badRequest('Сначала подтвердите оплату заказа с доставкой');
  }
  if (await prisma.shipment.findUnique({ where: { orderId: order.id } })) throw conflict('Отправление уже указано');
  await prisma.shipment.create({ data: { orderId: order.id, storeId: order.storeId, carrier: order.deliveryMethod, mode: 'manual', state: 'created', trackingNumber, tariffName: order.deliveryTariff, priceAmount: order.deliveryPriceAmount } });
  notifyBuyer.shipmentRegisteredManual(order.buyer.telegramId, order.publicNumber, trackingNumber, req.store!.slug);
  res.json({ ok: true });
}));

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

// Продавец может скрыть неподходящий отзыв или вернуть его в витрину.
adminRouter.post(
  '/:storeId/reviews/:id/visibility',
  h(async (req, res) => {
    const storeId = req.store!.id;
    const { status } = z.object({ status: z.enum(['published', 'hidden']) }).parse(req.body);
    const review = await prisma.review.findFirst({ where: { id: req.params.id, storeId } });
    if (!review) throw notFound('Отзыв не найден');
    const updated = await prisma.review.update({ where: { id: review.id }, data: { status } });
    await prisma.adminAuditLog.create({
      data: { actorTelegramId: req.auth!.telegramId, action: `review.${status}`, meta: { storeId, reviewId: review.id } },
    });
    res.json({ review: presentReview(updated) });
  }),
);

// ---------------- Настройки магазина (§7.6) ----------------

adminRouter.get(
  '/:storeId/settings',
  h(async (req, res) => {
    await requireOwner(req);
    const store = req.store!;
    const [members, me] = await Promise.all([
      prisma.storeMember.findMany({
        where: { storeId: store.id },
        include: { user: { select: { telegramId: true, firstName: true, username: true } } },
      }),
      prisma.storeMember.findUnique({ where: { storeId_userId: { storeId: store.id, userId: req.auth!.user.id } } }),
    ]);
    res.json({
      store: presentStore(store),
      paymentDetails: (store.settings as Record<string, unknown>).paymentDetails ?? '',
      currencyLocked: Boolean(await prisma.product.count({ where: { storeId: store.id } }) || await prisma.order.count({ where: { storeId: store.id } })),
      myRole: me?.role,
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
  logoUrl: imageUrl.nullish(),
  coverUrl: imageUrl.nullish(),
  settings: z
    .object({
      deliveryMethods: z.array(z.enum(['meetup', 'cdek', 'russian_post', 'yandex_delivery', 'dhl', 'discuss'])).min(1, 'Включите хотя бы один способ получения').optional(),
      cdekMode: z.enum(['manual', 'automatic']).optional(),
      responseSchedule: z.string().max(200).nullish(),
      reservationRules: z.string().max(500).nullish(),
      socialLinks: z.record(z.string().url().regex(/^https:\/\//, 'Ссылка должна начинаться с https://').max(500)).optional(),
      accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
      backgroundUrl: z.string().regex(/^\/uploads\/[\w-]+\.webp$/).nullish(),
      privacyUrl: z.string().url().regex(/^https:\/\//).max(500).nullish(),
      termsUrl: z.string().url().regex(/^https:\/\//).max(500).nullish(),
      legalName: z.string().trim().max(200).nullish(),
      legalInn: z.string().trim().regex(/^(\d{10}|\d{12})$/, 'ИНН: 10 или 12 цифр').nullish(),
      legalAddress: z.string().trim().max(500).nullish(),
      legalEmail: z.string().trim().email().max(200).nullish(),
      paymentDetails: z.string().trim().max(1000).nullish(),
      currency: z.enum(['RUB', 'BYN', 'USD']).optional(),
      channelUsername: z.union([z.literal(''), z.string().regex(/^@[A-Za-z0-9_]{5,32}$/, 'Укажите @имя публичного канала')]).nullish(),
      deliveryOptions: z.array(z.object({
        id: z.string().regex(/^[\w-]{1,60}$/),
        method: z.enum(['meetup', 'cdek', 'russian_post', 'yandex_delivery', 'dhl']),
        city: z.string().trim().min(2, 'Укажите город (от 2 символов)').max(100),
        point: z.string().trim().min(2, 'Укажите название места (от 2 символов)').max(120),
        address: z.string().trim().min(3, 'Укажите адрес (от 3 символов)').max(300),
        tariff: z.string().trim().min(2, 'Укажите тариф (от 2 символов)').max(100),
        price: z.number().nonnegative().max(100000),
        eta: z.string().trim().max(100).optional(),
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
      }).refine((o) => (o.lat === undefined) === (o.lon === undefined), 'Укажите обе координаты точки')).max(100).optional(),
      showSold: z.boolean().optional(),
      blocks: z.object({ newArrivals: z.boolean(), discounted: z.boolean(), recent: z.boolean() }).partial().optional(),
    })
    .optional(),
});

adminRouter.patch(
  '/:storeId/settings',
  h(async (req, res) => {
    await requireOwner(req);
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

    const mergedSettings: Record<string, unknown> = {
      ...(store.settings as Record<string, unknown>),
      ...(d.settings ?? {}),
      ...(d.slug && d.slug !== store.slug ? { slugChangedAt: new Date().toISOString() } : {}),
    };
    const currentCurrency = presentStoreSettings(store).currency;
    mergedSettings.currency ??= currentCurrency;
    if (mergedSettings.currency !== currentCurrency && (await prisma.product.count({ where: { storeId: store.id } }) || await prisma.order.count({ where: { storeId: store.id } }))) throw conflict('Валюту можно сменить только до добавления первого товара');
    if (mergedSettings.currency !== 'RUB' && mergedSettings.cdekMode === 'automatic') throw badRequest('Автоматический СДЭК считает тарифы только в рублях; выберите ручной режим');
    if (mergedSettings.cdekMode === 'automatic' && !mergedSettings.cdekConnection) throw badRequest('Для автоматического СДЭК сначала подключите кабинет');

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

adminRouter.get('/:storeId/channel/status', h(async (req, res) => {
  await requireOwner(req);
  const channel = presentStoreSettings(req.store!).channelUsername;
  if (!channel) return res.json({ ready: false, reason: 'Укажите канал в настройках' });
  if (!bot) return res.json({ ready: false, reason: 'Telegram-бот не настроен' });
  try {
    const me = await bot.api.getMe();
    const member = await bot.api.getChatMember(channel, me.id);
    const ready = member.status === 'creator' || (member.status === 'administrator' && member.can_post_messages !== false);
    res.json({ ready, reason: ready ? null : 'Добавьте бота администратором канала с правом публикации' });
  } catch (error) { res.json({ ready: false, reason: (error as Error).message.slice(0, 200) }); }
}));

// Сотрудников назначает владелец магазина.
adminRouter.post(
  '/:storeId/members',
  h(async (req, res) => {
    const store = req.store!;
    const me = await prisma.storeMember.findUnique({ where: { storeId_userId: { storeId: store.id, userId: req.auth!.user.id } } });
    if (me?.role !== 'owner') throw forbidden('Добавлять сотрудников может только владелец');
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
    const me = await prisma.storeMember.findUnique({ where: { storeId_userId: { storeId: store.id, userId: req.auth!.user.id } } });
    if (me?.role !== 'owner') throw forbidden('Удалять сотрудников может только владелец');
    const target = await prisma.storeMember.findUnique({ where: { storeId_userId: { storeId: store.id, userId: req.params.userId } } });
    if (!target) throw notFound('Сотрудник не найден');
    if (target.role === 'owner') throw badRequest('Нельзя удалить владельца');
    await prisma.storeMember.delete({ where: { storeId_userId: { storeId: store.id, userId: req.params.userId } } });
    res.json({ ok: true });
  }),
);
