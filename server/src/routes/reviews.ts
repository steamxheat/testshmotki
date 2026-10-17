import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { badRequest, conflict, forbidden, h, notFound } from '../lib/http.js';
import { presentReview } from '../lib/present.js';
import { getStoreRating, logEvent } from '../lib/stats.js';
import { authenticate } from '../middleware/auth.js';
import { resolveStore } from '../middleware/store.js';
import { notifySeller } from '../telegram/notify.js';

export const reviewsRouter = Router();

// GET /api/reviews — опубликованные отзывы магазина + средний рейтинг (§6.9)
reviewsRouter.get(
  '/',
  authenticate,
  resolveStore(),
  h(async (req, res) => {
    const storeId = req.store!.id;
    const [reviews, summary] = await Promise.all([
      prisma.review.findMany({
        where: { storeId, status: 'published' },
        orderBy: { createdAt: 'desc' },
        include: { author: { select: { firstName: true, avatarUrl: true } } },
      }),
      getStoreRating(storeId),
    ]);
    res.json({ items: reviews.map(presentReview), ...summary });
  }),
);

const createSchema = z.object({
  orderId: z.string(),
  rating: z.coerce.number().int().min(1).max(5),
  text: z.string().trim().max(1000).optional(),
  photos: z.array(z.string().url()).max(3).optional(),
});

// POST /api/reviews — отзыв по завершённому заказу, один раз (§6.9, §9.5)
reviewsRouter.post(
  '/',
  authenticate,
  h(async (req, res) => {
    const data = createSchema.parse(req.body);
    const order = await prisma.order.findUnique({ where: { id: data.orderId }, include: { review: true } });
    if (!order) throw notFound('Заказ не найден');
    if (order.buyerId !== req.auth!.user.id) throw forbidden('Отзыв доступен только участнику сделки');
    if (order.status !== 'completed') throw badRequest('Отзыв можно оставить только по завершённому заказу');
    if (order.review) throw conflict('Отзыв по этому заказу уже оставлен', 'already_reviewed');

    const review = await prisma.review.create({
      data: {
        orderId: order.id,
        storeId: order.storeId,
        authorId: req.auth!.user.id,
        rating: data.rating,
        text: data.text ?? null,
        photos: data.photos ?? [],
        status: 'published',
      },
      include: { author: { select: { firstName: true, avatarUrl: true } } },
    });

    logEvent({ storeId: order.storeId, userId: req.auth!.user.id, type: 'review_published', meta: { rating: data.rating } });

    const store = await prisma.store.findUnique({
      where: { id: order.storeId },
      include: { members: { where: { role: 'owner' }, include: { user: true }, take: 1 } },
    });
    const owner = store?.members[0]?.user;
    if (owner) notifySeller.newReview(owner.telegramId, data.rating);

    res.status(201).json({ review: presentReview(review) });
  }),
);
