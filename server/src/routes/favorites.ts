import { Router } from 'express';
import { prisma } from '../db.js';
import { h, notFound } from '../lib/http.js';
import { presentProduct } from '../lib/present.js';
import { logEvent } from '../lib/stats.js';
import { authenticate } from '../middleware/auth.js';
import { resolveStore } from '../middleware/store.js';

export const favoritesRouter = Router();
favoritesRouter.use(authenticate, resolveStore());

// GET /api/favorites — список избранного пользователя (§6.6).
// Проданные/снятые товары остаются в избранном с отметкой, но заказать нельзя.
favoritesRouter.get(
  '/',
  h(async (req, res) => {
    const favs = await prisma.favorite.findMany({
      where: { userId: req.auth!.user.id, product: { storeId: req.store!.id } },
      orderBy: { createdAt: 'desc' },
      include: { product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } } },
    });
    res.json({
      items: favs
        .filter((f) => f.product)
        .map((f) => presentProduct(f.product, { isFavorite: true })),
    });
  }),
);

// POST /api/favorites/:productId
favoritesRouter.post(
  '/:productId',
  h(async (req, res) => {
    const product = await prisma.product.findFirst({ where: { id: req.params.productId, storeId: req.store!.id, status: { in: ['published', 'reserved', 'sold'] } } });
    if (!product) throw notFound('Товар не найден');
    await prisma.favorite.upsert({
      where: { userId_productId: { userId: req.auth!.user.id, productId: product.id } },
      create: { userId: req.auth!.user.id, productId: product.id },
      update: {},
    });
    logEvent({ storeId: product.storeId, userId: req.auth!.user.id, productId: product.id, type: 'favorite_add' });
    res.json({ ok: true, isFavorite: true });
  }),
);

// DELETE /api/favorites/:productId
favoritesRouter.delete(
  '/:productId',
  h(async (req, res) => {
    const product = await prisma.product.findFirst({ where: { id: req.params.productId, storeId: req.store!.id }, select: { id: true } });
    if (!product) throw notFound('Товар не найден');
    await prisma.favorite
      .delete({ where: { userId_productId: { userId: req.auth!.user.id, productId: req.params.productId } } })
      .catch(() => undefined);
    logEvent({ storeId: req.store!.id, userId: req.auth!.user.id, productId: req.params.productId, type: 'favorite_remove' });
    res.json({ ok: true, isFavorite: false });
  }),
);

// DELETE /api/favorites — очистить список
favoritesRouter.delete(
  '/',
  h(async (req, res) => {
    await prisma.favorite.deleteMany({ where: { userId: req.auth!.user.id, product: { storeId: req.store!.id } } });
    res.json({ ok: true });
  }),
);
