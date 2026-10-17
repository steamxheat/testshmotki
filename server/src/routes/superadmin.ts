import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest, conflict, h, notFound } from '../lib/http.js';
import { authenticate, requireSuperadmin } from '../middleware/auth.js';

export const superadminRouter = Router();
superadminRouter.use(authenticate, requireSuperadmin);

export const DEFAULT_CATEGORIES = [
  'Верхняя одежда',
  'Толстовки и свитшоты',
  'Футболки',
  'Рубашки',
  'Брюки',
  'Джинсы',
  'Шорты',
  'Обувь',
  'Головные уборы',
  'Аксессуары',
];

// Действия суперадмина записываются в журнал (§9.9)
async function audit(req: import('express').Request, action: string, meta: Record<string, unknown> = {}) {
  await prisma.adminAuditLog.create({ data: { actorTelegramId: req.auth!.telegramId, action, meta: meta as Prisma.InputJsonValue } });
}

// GET /api/superadmin/stores — список продавцов (§4.3)
superadminRouter.get(
  '/stores',
  h(async (_req, res) => {
    const stores = await prisma.store.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        members: { where: { role: 'owner' }, include: { user: { select: { telegramId: true, username: true, firstName: true } } }, take: 1 },
        _count: { select: { products: true, orders: true, reviews: true } },
      },
    });
    res.json({
      stores: stores.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        status: s.status,
        city: s.city,
        createdAt: s.createdAt,
        owner: s.members[0]
          ? { telegramId: String(s.members[0].user.telegramId), username: s.members[0].user.username, firstName: s.members[0].user.firstName }
          : null,
        counts: s._count,
      })),
    });
  }),
);

// POST /api/superadmin/stores — создать магазин и назначить владельца (§4.3, допущения §20)
superadminRouter.post(
  '/stores',
  h(async (req, res) => {
    const d = z
      .object({
        slug: z.string().trim().regex(/^[a-z0-9_]{3,32}$/),
        name: z.string().trim().min(1).max(80),
        ownerTelegramId: z.coerce.string().regex(/^\d+$/),
        city: z.string().trim().max(100).optional(),
        seedCategories: z.boolean().default(true),
      })
      .parse(req.body);

    const exists = await prisma.store.findUnique({ where: { slug: d.slug } });
    if (exists) throw conflict('Адрес занят', 'slug_taken');

    const owner = await prisma.user.upsert({
      where: { telegramId: BigInt(d.ownerTelegramId) },
      create: { telegramId: BigInt(d.ownerTelegramId) },
      update: {},
    });

    const store = await prisma.store.create({
      data: {
        slug: d.slug,
        name: d.name,
        city: d.city ?? null,
        members: { create: { userId: owner.id, role: 'owner' } },
        categories: d.seedCategories
          ? { create: DEFAULT_CATEGORIES.map((name, i) => ({ name, sortOrder: i })) }
          : undefined,
      },
    });
    await audit(req, 'store.create', { storeId: store.id, slug: store.slug });
    res.status(201).json({ store: { id: store.id, slug: store.slug, name: store.name } });
  }),
);

superadminRouter.post(
  '/stores/:id/block',
  h(async (req, res) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.id } });
    if (!store) throw notFound('Магазин не найден');
    await prisma.store.update({ where: { id: store.id }, data: { status: 'blocked' } });
    await audit(req, 'store.block', { storeId: store.id });
    res.json({ ok: true });
  }),
);

superadminRouter.post(
  '/stores/:id/unblock',
  h(async (req, res) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.id } });
    if (!store) throw notFound('Магазин не найден');
    await prisma.store.update({ where: { id: store.id }, data: { status: 'active' } });
    await audit(req, 'store.unblock', { storeId: store.id });
    res.json({ ok: true });
  }),
);

// назначить владельца магазина по Telegram ID (§4.3)
superadminRouter.post(
  '/stores/:id/owner',
  h(async (req, res) => {
    const store = await prisma.store.findUnique({ where: { id: req.params.id } });
    if (!store) throw notFound('Магазин не найден');
    const { telegramId } = z.object({ telegramId: z.coerce.string().regex(/^\d+$/) }).parse(req.body);
    const user = await prisma.user.upsert({ where: { telegramId: BigInt(telegramId) }, create: { telegramId: BigInt(telegramId) }, update: {} });
    await prisma.storeMember.upsert({
      where: { storeId_userId: { storeId: store.id, userId: user.id } },
      create: { storeId: store.id, userId: user.id, role: 'owner' },
      update: { role: 'owner' },
    });
    await audit(req, 'store.assign_owner', { storeId: store.id, telegramId });
    res.json({ ok: true });
  }),
);

// GET /api/superadmin/reports — жалобы (§4.3, §7.5)
superadminRouter.get(
  '/reports',
  h(async (req, res) => {
    const status = (req.query.status as string) ?? 'open';
    const reports = await prisma.report.findMany({ where: { status: status as never }, orderBy: { createdAt: 'desc' } });
    res.json({ reports });
  }),
);

// скрыть недопустимый товар или отзыв (§4.3)
superadminRouter.post(
  '/moderate',
  h(async (req, res) => {
    const d = z
      .object({ targetType: z.enum(['product', 'review']), targetId: z.string(), action: z.enum(['hide', 'restore']), reportId: z.string().optional() })
      .parse(req.body);

    if (d.targetType === 'product') {
      const p = await prisma.product.findUnique({ where: { id: d.targetId } });
      if (!p) throw notFound('Товар не найден');
      await prisma.product.update({ where: { id: p.id }, data: { status: d.action === 'hide' ? 'archived' : 'draft' } });
    } else {
      const r = await prisma.review.findUnique({ where: { id: d.targetId } });
      if (!r) throw notFound('Отзыв не найден');
      // рейтинг пересчитывается при скрытии/восстановлении отзыва (§9.6) — считается по published
      await prisma.review.update({ where: { id: r.id }, data: { status: d.action === 'hide' ? 'hidden' : 'published' } });
    }
    if (d.reportId) await prisma.report.update({ where: { id: d.reportId }, data: { status: 'resolved' } });
    await audit(req, `moderate.${d.targetType}.${d.action}`, { targetId: d.targetId });
    res.json({ ok: true });
  }),
);

superadminRouter.post(
  '/reports/:id/dismiss',
  h(async (req, res) => {
    const r = await prisma.report.findUnique({ where: { id: req.params.id } });
    if (!r) throw notFound('Жалоба не найдена');
    await prisma.report.update({ where: { id: r.id }, data: { status: 'dismissed' } });
    await audit(req, 'report.dismiss', { reportId: r.id });
    res.json({ ok: true });
  }),
);

// GET /api/superadmin/stats — общая техническая статистика (§4.3)
superadminRouter.get(
  '/stats',
  h(async (_req, res) => {
    const [stores, activeStores, users, products, orders, reviews] = await Promise.all([
      prisma.store.count(),
      prisma.store.count({ where: { status: 'active' } }),
      prisma.user.count(),
      prisma.product.count(),
      prisma.order.count(),
      prisma.review.count(),
    ]);
    res.json({ stores, activeStores, users, products, orders, reviews });
  }),
);

superadminRouter.get(
  '/audit',
  h(async (_req, res) => {
    const logs = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    res.json({ logs: logs.map((l) => ({ ...l, actorTelegramId: String(l.actorTelegramId) })) });
  }),
);
