import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { h, notFound } from '../lib/http.js';
import { rublesToKopecks } from '../lib/money.js';
import { presentProduct, presentStoreSettings } from '../lib/present.js';
import { logEvent } from '../lib/stats.js';
import { authenticate } from '../middleware/auth.js';
import { resolveStore } from '../middleware/store.js';
import { searchLimiter } from '../middleware/rateLimit.js';

export const catalogRouter = Router();

const catalogStatuses = (showSold: boolean): Prisma.ProductWhereInput['status'] =>
  ({ in: showSold ? ['published', 'reserved', 'sold'] : ['published', 'reserved'] });

const listQuery = z.object({
  store: z.string(),
  q: z.string().trim().optional(),
  category: z.string().optional(),
  subcategory: z.string().optional(),
  brand: z.union([z.string(), z.array(z.string())]).optional(),
  size: z.union([z.string(), z.array(z.string())]).optional(),
  color: z.union([z.string(), z.array(z.string())]).optional(),
  condition: z.union([z.string(), z.array(z.string())]).optional(),
  priceFrom: z.coerce.number().optional(),
  priceTo: z.coerce.number().optional(),
  discounted: z.enum(['1', 'true']).optional(),
  availableOnly: z.enum(['1', 'true']).optional(),
  sort: z.enum(['new', 'price_asc', 'price_desc', 'discount']).default('new'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const asArray = (v?: string | string[]): string[] | undefined => {
  if (v == null) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  return arr.filter(Boolean);
};

async function buildWhere(
  storeId: string,
  q: z.infer<typeof listQuery>,
  showSold: boolean,
): Promise<Prisma.ProductWhereInput> {
  const where: Prisma.ProductWhereInput = {
    storeId,
    status: q.availableOnly ? 'published' : catalogStatuses(showSold),
  };
  const and: Prisma.ProductWhereInput[] = [];

  // поиск без учёта регистра по названию/бренду/категории/описанию (§6.3)
  if (q.q && q.q.length >= 2) {
    const ci = { contains: q.q, mode: 'insensitive' as const };
    and.push({
      OR: [
        { title: ci },
        { brand: ci },
        { description: ci },
        { category: { name: ci } },
      ],
    });
  }

  // категория: если выбрана родительская — включаем её подкатегории
  if (q.category) {
    const children = await prisma.category.findMany({
      where: { parentId: q.category },
      select: { id: true },
    });
    and.push({ categoryId: { in: [q.category, ...children.map((c) => c.id)] } });
  }
  if (q.subcategory) and.push({ categoryId: q.subcategory });

  const brand = asArray(q.brand);
  const size = asArray(q.size);
  const color = asArray(q.color);
  const condition = asArray(q.condition);
  if (brand?.length) and.push({ brand: { in: brand } });
  if (q.availableOnly) {
    const available = await prisma.$queryRaw<{ product_id: string }[]>(Prisma.sql`
      SELECT DISTINCT product_id FROM product_variants
      WHERE stock_quantity > reserved_quantity + sold_quantity
      ${size?.length ? Prisma.sql`AND size IN (${Prisma.join(size)})` : Prisma.empty}
    `);
    and.push({ id: { in: available.map((item) => item.product_id) } });
  } else if (size?.length) and.push({ variants: { some: { size: { in: size } } } });
  if (color?.length) and.push({ color: { in: color } });
  if (condition?.length) and.push({ condition: { in: condition as never[] } });

  if (q.priceFrom != null) and.push({ priceAmount: { gte: rublesToKopecks(q.priceFrom) } });
  if (q.priceTo != null) and.push({ priceAmount: { lte: rublesToKopecks(q.priceTo) } });

  // товары со скидкой: старая цена больше текущей
  if (q.discounted) {
    and.push({ oldPriceAmount: { not: null } });
  }

  if (and.length) where.AND = and;
  return where;
}

function orderBy(sort: string): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'price_asc':
      return [{ priceAmount: 'asc' }];
    case 'price_desc':
      return [{ priceAmount: 'desc' }];
    default:
      return [{ publishedAt: 'desc' }, { createdAt: 'desc' }];
  }
}

// GET /api/catalog — список товаров витрины с фильтрами/поиском/сортировкой (§6.2–6.4)
catalogRouter.get(
  '/',
  searchLimiter,
  authenticate,
  resolveStore(),
  h(async (req, res) => {
    const q = listQuery.parse(req.query);
    const store = req.store!;
    const where = await buildWhere(store.id, q, presentStoreSettings(store).showSold);

    let total: number;
    let items;
    if (q.sort === 'discount') {
      // shortcut: ранжируем цены в памяти для каталога до нескольких тысяч вещей; при росте нужен индексированный процент в БД.
      const ranked = await prisma.product.findMany({ where, select: { id: true, priceAmount: true, oldPriceAmount: true } });
      ranked.sort((a, b) => {
        const aDiscount = a.oldPriceAmount && a.oldPriceAmount > a.priceAmount ? 1 - a.priceAmount / a.oldPriceAmount : 0;
        const bDiscount = b.oldPriceAmount && b.oldPriceAmount > b.priceAmount ? 1 - b.priceAmount / b.oldPriceAmount : 0;
        return bDiscount - aDiscount || a.id.localeCompare(b.id);
      });
      total = ranked.length;
      const ids = ranked.slice((q.page - 1) * q.pageSize, q.page * q.pageSize).map((item) => item.id);
      const pageItems = await prisma.product.findMany({ where: { id: { in: ids } }, include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } });
      const byId = new Map(pageItems.map((item) => [item.id, item]));
      items = ids.map((id) => byId.get(id)!).filter(Boolean);
    } else {
      [total, items] = await Promise.all([
        prisma.product.count({ where }),
        prisma.product.findMany({ where, orderBy: orderBy(q.sort), skip: (q.page - 1) * q.pageSize, take: q.pageSize,
          include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } },
        }),
      ]);
    }

    // отметка избранного для текущего пользователя (§6.6)
    const favIds = new Set(
      (
        await prisma.favorite.findMany({
          where: { userId: req.auth!.user.id, productId: { in: items.map((i) => i.id) } },
          select: { productId: true },
        })
      ).map((f) => f.productId),
    );

    if (q.q && q.q.length >= 2) {
      logEvent({ storeId: store.id, userId: req.auth!.user.id, type: 'search_query', meta: { len: q.q.length } });
    } else {
      logEvent({ storeId: store.id, userId: req.auth!.user.id, type: 'catalog_view' });
    }

    res.json({
      items: items.map((p) => presentProduct(p, { isFavorite: favIds.has(p.id) })),
      total,
      page: q.page,
      pageSize: q.pageSize,
      hasMore: q.page * q.pageSize < total,
    });
  }),
);

// GET /api/catalog/filters — доступные значения фильтров из актуального ассортимента (§6.4)
catalogRouter.get(
  '/filters',
  authenticate,
  resolveStore(),
  h(async (req, res) => {
    const storeId = req.store!.id;
    const base: Prisma.ProductWhereInput = { storeId, status: catalogStatuses(presentStoreSettings(req.store!).showSold) };

    // Пустые категории также доступны покупателю сразу после создания.
    const products = await prisma.product.findMany({
      where: base,
      select: {
        brand: true,
        variants: { select: { size: true } },
        color: true,
        condition: true,
        priceAmount: true,
        categoryId: true,
      },
    });

    const uniq = (vals: (string | null)[]) =>
      [...new Set(vals.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, 'ru'));

    const categories = await prisma.category.findMany({
      where: { storeId, status: 'active' },
      orderBy: { sortOrder: 'asc' },
    });

    const prices = products.map((p) => p.priceAmount);
    const hasDiscounted = products.some((p) => p.priceAmount >= 0) &&
      (await prisma.product.count({ where: { ...base, oldPriceAmount: { not: null } } })) > 0;
    logEvent({ storeId, userId: req.auth!.user.id, type: 'filter_apply' });

    res.json({
      // пустые наборы клиент не показывает — «фильтр без доступных значений не показывается»
      categories: categories.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId })),
      brands: uniq(products.map((p) => p.brand)),
      sizes: uniq(products.flatMap((p) => p.variants.map((v) => v.size))),
      colors: uniq(products.map((p) => p.color)),
      conditions: uniq(products.map((p) => p.condition)),
      priceMin: prices.length ? Math.min(...prices) / 100 : 0,
      priceMax: prices.length ? Math.max(...prices) / 100 : 0,
      hasDiscounted,
    });
  }),
);

// GET /api/catalog/home — блоки главной страницы магазина (§6.1)
catalogRouter.get(
  '/home',
  authenticate,
  resolveStore(),
  h(async (req, res) => {
    const storeId = req.store!.id;
    const include = { images: { orderBy: { sortOrder: 'asc' as const }, take: 1 } };

    const [newArrivals, discounted, recent] = await Promise.all([
      prisma.product.findMany({
        where: { storeId, status: 'published' },
        orderBy: { publishedAt: 'desc' },
        take: 10,
        include,
      }),
      prisma.product.findMany({
        where: { storeId, status: 'published', oldPriceAmount: { not: null } },
        orderBy: { publishedAt: 'desc' },
        take: 10,
        include,
      }),
      prisma.product.findMany({
        where: { storeId, status: catalogStatuses(presentStoreSettings(req.store!).showSold) },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include,
      }),
    ]);

    logEvent({ storeId, userId: req.auth!.user.id, type: 'store_view' });

    res.json({
      newArrivals: newArrivals.map((p) => presentProduct(p)),
      discounted: discounted.map((p) => presentProduct(p)),
      recent: recent.map((p) => presentProduct(p)),
    });
  }),
);

// GET /api/catalog/product/:id — карточка товара (§6.5)
catalogRouter.get(
  '/product/:id',
  authenticate,
  resolveStore(),
  h(async (req, res) => {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { images: { orderBy: { sortOrder: 'asc' } }, variants: { orderBy: { size: 'asc' } } },
    });
    if (!product) throw notFound('Товар не найден');
    if (product.storeId !== req.store!.id) throw notFound('Товар не найден');

    // покупателю доступны опубликованные, забронированные и проданные (прямая ссылка, §6.5)
    const member = await prisma.storeMember.findUnique({
      where: { storeId_userId: { storeId: product.storeId, userId: req.auth!.user.id } },
    });
    const buyerVisible = ['published', 'reserved', 'sold'].includes(product.status);
    if (!buyerVisible && !member) throw notFound('Товар недоступен');

    const fav = await prisma.favorite.findUnique({
      where: { userId_productId: { userId: req.auth!.user.id, productId: product.id } },
    });

    logEvent({ storeId: product.storeId, userId: req.auth!.user.id, productId: product.id, type: 'product_view' });

    res.json({ product: presentProduct(product, { isFavorite: !!fav }) });
  }),
);
