import { Router } from 'express';
import { z } from 'zod';
import { customAlphabet } from 'nanoid';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { badRequest, conflict, forbidden, h, notFound } from '../lib/http.js';
import { presentOrder } from '../lib/present.js';
import { logEvent } from '../lib/stats.js';
import { authenticate } from '../middleware/auth.js';
import { orderLimiter } from '../middleware/rateLimit.js';
import { notifyBuyer, notifySeller } from '../telegram/notify.js';

export const ordersRouter = Router();
ordersRouter.use(authenticate);

const publicNumber = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

const createSchema = z.object({
  productId: z.string(),
  buyerName: z.string().trim().min(1, 'Укажите имя').max(100),
  buyerPhone: z.string().trim().max(32).optional(),
  city: z.string().trim().max(100).optional(),
  deliveryMethod: z.enum(['meetup', 'cdek', 'russian_post', 'discuss']),
  comment: z.string().trim().max(1000).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: 'Нужно согласие на передачу данных' }) }),
});

// POST /api/orders — оформление заявки с атомарной бронью (§6.7, §9.1–9.2)
ordersRouter.post(
  '/',
  orderLimiter,
  h(async (req, res) => {
    const data = createSchema.parse(req.body);
    const user = req.auth!.user;

    const product = await prisma.product.findUnique({ where: { id: data.productId } });
    if (!product) throw notFound('Товар не найден');

    // покупатель может иметь только одну действующую заявку на эту вещь (критерий 8)
    const existing = await prisma.order.findFirst({
      where: { productId: product.id, buyerId: user.id, status: { in: ['pending', 'confirmed'] } },
    });
    if (existing) throw conflict('У вас уже есть активная заявка на этот товар', 'already_requested');

    const reservedUntil = new Date(Date.now() + config.reservationHours * 3600 * 1000);

    const order = await prisma.$transaction(async (tx) => {
      // Атомарная бронь: товар бронируется, только если он ещё опубликован.
      // Одновременные заявки — первая успешная забронирует, остальные получат 0 строк.
      const reserved = await tx.product.updateMany({
        where: { id: product.id, status: 'published' },
        data: { status: 'reserved' },
      });
      if (reserved.count === 0) {
        throw conflict('Товар уже недоступен', 'unavailable');
      }

      const created = await tx.order.create({
        data: {
          publicNumber: publicNumber(),
          storeId: product.storeId,
          productId: product.id,
          buyerId: user.id,
          productTitleSnapshot: product.title,
          priceAmountSnapshot: product.priceAmount,
          buyerName: data.buyerName,
          buyerUsername: req.auth!.username ?? null,
          buyerPhone: data.buyerPhone ?? null,
          city: data.city ?? null,
          deliveryMethod: data.deliveryMethod,
          comment: data.comment ?? null,
          status: 'pending',
          reservedUntil,
        },
      });

      await tx.orderStatusHistory.create({
        data: { orderId: created.id, oldStatus: null, newStatus: 'pending', changedByUserId: user.id },
      });

      return created;
    });

    logEvent({ storeId: product.storeId, userId: user.id, productId: product.id, type: 'order_created', meta: { orderId: order.id } });

    // уведомления (§8) — не в транзакции, best-effort
    const store = await prisma.store.findUnique({
      where: { id: product.storeId },
      include: { members: { where: { role: 'owner' }, include: { user: true }, take: 1 } },
    });
    const owner = store?.members[0]?.user;
    const contact = req.auth!.username ? `@${req.auth!.username}` : `tg://user?id=${user.telegramId}`;
    if (owner) {
      notifySeller.newOrder(owner.telegramId, order.publicNumber, product.title, data.buyerName, contact);
    }
    notifyBuyer.orderCreated(user.telegramId, order.publicNumber, product.title);

    res.status(201).json({
      order: presentOrder(order),
      chatUrl: store?.contactUsername ? `https://t.me/${store.contactUsername}` : null,
    });
  }),
);

// GET /api/orders — история заказов покупателя (§6.8)
ordersRouter.get(
  '/',
  h(async (req, res) => {
    const orders = await prisma.order.findMany({
      where: { buyerId: req.auth!.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } },
        history: { orderBy: { createdAt: 'asc' } },
      },
    });
    res.json({ items: orders.map(presentOrder) });
  }),
);

// POST /api/orders/:id/cancel — покупатель отменяет только «ожидает подтверждения» (§6.8)
ordersRouter.post(
  '/:id/cancel',
  h(async (req, res) => {
    const order = await prisma.order.findUnique({ where: { id: req.params.id } });
    if (!order) throw notFound('Заказ не найден');
    if (order.buyerId !== req.auth!.user.id) throw forbidden();
    if (order.status !== 'pending') throw badRequest('Отменить можно только ожидающую заявку');

    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: order.id }, data: { status: 'cancelled' } });
      await tx.orderStatusHistory.create({
        data: { orderId: order.id, oldStatus: 'pending', newStatus: 'cancelled', changedByUserId: req.auth!.user.id },
      });
      // освобождаем товар, если он всё ещё забронирован этой заявкой
      await tx.product.updateMany({ where: { id: order.productId, status: 'reserved' }, data: { status: 'published' } });
    });

    const store = await prisma.store.findUnique({
      where: { id: order.storeId },
      include: { members: { where: { role: 'owner' }, include: { user: true }, take: 1 } },
    });
    const owner = store?.members[0]?.user;
    if (owner) notifySeller.orderCancelled(owner.telegramId, order.publicNumber);

    res.json({ ok: true });
  }),
);
