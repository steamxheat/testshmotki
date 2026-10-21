import { Router } from 'express';
import { prisma } from '../db.js';
import { h } from '../lib/http.js';
import { presentCategory, presentStore, presentStoreSettings } from '../lib/present.js';
import { getStoreRating } from '../lib/stats.js';
import { authenticate } from '../middleware/auth.js';
import { resolveStore } from '../middleware/store.js';

export const storeRouter = Router();

// GET /api/store — витрина текущего магазина (§6.1)
storeRouter.get(
  '/',
  authenticate,
  resolveStore(),
  h(async (req, res) => {
    const store = req.store!;
    const { rating, reviewsCount } = await getStoreRating(store.id);
    res.json({ store: presentStore(store, { rating, reviewsCount }) });
  }),
);

// GET /api/store/categories — все активные категории, включая пустые.
storeRouter.get(
  '/categories',
  authenticate,
  resolveStore(),
  h(async (req, res) => {
    const storeId = req.store!.id;
    const categories = await prisma.category.findMany({
      where: {
        storeId,
        status: 'active',
      },
      orderBy: { sortOrder: 'asc' },
      include: {
        _count: { select: { products: { where: { status: { in: presentStoreSettings(req.store!).showSold ? ['published', 'reserved', 'sold'] : ['published', 'reserved'] } } } } },
      },
    });
    res.json({ categories: categories.map(presentCategory) });
  }),
);
