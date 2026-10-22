import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { z } from 'zod';
import { customAlphabet } from 'nanoid';
import { config } from '../config.js';
import { connectionFromSettings, getCdekPoint, quoteCdek } from '../lib/cdek.js';
import { prisma } from '../db.js';
import { badRequest, conflict, h, notFound } from '../lib/http.js';
import { presentOrder, presentStoreSettings } from '../lib/present.js';
import { legalVersion } from '../lib/legal.js';
import { lockProducts, reserveVariant, syncProductStatus } from '../lib/inventory.js';
import { logEvent } from '../lib/stats.js';
import { authenticate } from '../middleware/auth.js';
import { orderLimiter, receiptLimiter } from '../middleware/rateLimit.js';
import { resolveStore } from '../middleware/store.js';
import { notifyBuyer, notifySeller } from '../telegram/notify.js';

export const ordersRouter = Router();
ordersRouter.use(authenticate, resolveStore());

const publicNumber = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

const createSchema = z.object({
  productId: z.string().optional(), // совместимость со старыми открытыми Mini App
  items: z.array(z.object({ productId: z.string(), variantId: z.string(), quantity: z.number().int().min(1).max(20) })).min(1).max(30).optional(),
  buyerName: z.string().trim().min(1, 'Укажите имя').max(100),
  buyerPhone: z.string().trim().max(32).optional(),
  buyerEmail: z.string().trim().email('Укажите корректную почту').max(200).optional(),
  city: z.string().trim().max(100).optional(),
  deliveryAddress: z.string().trim().max(300).optional(),
  deliveryOptionId: z.string().optional(),
  deliveryCityCode: z.number().int().positive().optional(),
  deliveryPointCode: z.string().max(32).optional(),
  expectedDeliveryPrice: z.number().nonnegative().max(100000).optional(),
  expectedTariffCode: z.number().int().positive().optional(),
  deliveryMethod: z.enum(['meetup', 'cdek', 'russian_post', 'yandex_delivery', 'dhl', 'discuss']),
  comment: z.string().trim().max(1000).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: 'Нужно согласие на передачу данных' }) }),
  termsAccepted: z.literal(true, { errorMap: () => ({ message: 'Подтвердите ознакомление с условиями покупки' }) }),
}).superRefine((data, ctx) => {
  if (!data.productId && !data.items?.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Корзина пуста' });
  if (data.items && new Set(data.items.map((i) => i.variantId)).size !== data.items.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Повторяющиеся позиции в корзине' });
  if (!['cdek', 'russian_post', 'yandex_delivery', 'dhl'].includes(data.deliveryMethod)) return;
  if (!data.buyerPhone) ctx.addIssue({ code: 'custom', path: ['buyerPhone'], message: 'Для доставки нужен телефон' });
  if (!data.buyerEmail) ctx.addIssue({ code: 'custom', path: ['buyerEmail'], message: 'Для доставки нужна почта' });
  if (!data.city) ctx.addIssue({ code: 'custom', path: ['city'], message: 'Укажите город' });
  if (!data.deliveryAddress && !data.deliveryOptionId && !data.deliveryPointCode) ctx.addIssue({ code: 'custom', path: ['deliveryAddress'], message: 'Выберите ПВЗ или укажите адрес' });
  if (data.deliveryPointCode && !data.deliveryCityCode) ctx.addIssue({ code: 'custom', path: ['deliveryCityCode'], message: 'Выберите город СДЭК' });
});

type DeliveryOption = { id: string; method: 'meetup' | 'cdek' | 'russian_post' | 'yandex_delivery' | 'dhl'; city: string; point: string; address: string; tariff: string; price: number; eta?: string; lat?: number; lon?: number };
const receiptDir = path.resolve(process.cwd(), '../.runtime/receipts');
const receiptUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => {
  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(file.mimetype)) return cb(badRequest('Чек: PDF или фото до 10 МБ'));
  cb(null, true);
} });

// POST /api/orders — оформление заявки с атомарной бронью (§6.7, §9.1–9.2)
ordersRouter.post(
  '/',
  orderLimiter,
  h(async (req, res) => {
    const data = createSchema.parse(req.body);
    const user = req.auth!.user;
    const legal = presentStoreSettings(req.store!);
    if (!legal.deliveryMethods.includes(data.deliveryMethod)) {
      throw badRequest('Этот способ получения недоступен в магазине');
    }

    const options = presentStoreSettings(req.store!).deliveryOptions as DeliveryOption[];
    const option = data.deliveryOptionId ? options.find((o) => o.id === data.deliveryOptionId && o.method === data.deliveryMethod && o.city.toLowerCase() === data.city?.toLowerCase()) : null;
    if (data.deliveryOptionId && !option) throw badRequest('Пункт или тариф больше не доступен — выберите заново');
    if (data.deliveryPointCode && data.deliveryMethod !== 'cdek') throw badRequest('Код ПВЗ разрешён только для СДЭК');
    if (data.deliveryPointCode && (data.deliveryOptionId || data.deliveryAddress)) throw badRequest('Выберите один ПВЗ СДЭК');
    const cdekPoint = data.deliveryPointCode ? await getCdekPoint(data.deliveryCityCode!, data.deliveryPointCode) : null;
    const connection = cdekPoint && legal.cdekMode === 'automatic' ? connectionFromSettings(req.store!.settings) : null;
    const cdekQuote = connection && cdekPoint ? await quoteCdek(connection, cdekPoint.cityCode, cdekPoint.code) : null;
    if (data.deliveryMethod === 'cdek' && data.expectedDeliveryPrice != null && !cdekQuote) throw conflict('Режим доставки СДЭК изменился. Обновите выбор ПВЗ и сумму', 'delivery_price_changed');
    if (cdekQuote && (data.expectedDeliveryPrice == null || data.expectedTariffCode == null)) throw badRequest('Тариф СДЭК изменился. Вернитесь к выбору ПВЗ и обновите расчёт');
    if (cdekQuote && (Math.round(cdekQuote.price * 100) !== Math.round(data.expectedDeliveryPrice! * 100) || cdekQuote.tariffCode !== data.expectedTariffCode)) throw conflict('Цена доставки СДЭК изменилась. Обновите расчёт перед заявкой', 'delivery_price_changed');
    if (cdekPoint && !data.city) throw badRequest('Укажите город доставки');
    const requested = data.items ?? [{ productId: data.productId!, variantId: '', quantity: 1 }];
    const ids = [...new Set(requested.map((i) => i.productId))];
    const reservedUntil = new Date(Date.now() + config.reservationHours * 3600 * 1000);

    const order = await prisma.$transaction(async (tx) => {
      await lockProducts(tx, ids);
      const existing = await tx.orderItem.findFirst({ where: { productId: { in: ids }, order: { buyerId: user.id, status: { in: ['pending', 'confirmed'] } } } });
      if (existing) throw conflict('У вас уже есть активная заявка на одну из этих вещей', 'already_requested');
      const products = await tx.product.findMany({ where: { id: { in: ids }, storeId: req.store!.id }, include: { variants: true } });
      if (products.length !== ids.length) throw notFound('Товар не найден');
      const lines = requested.map((item) => {
        const product = products.find((p) => p.id === item.productId);
        if (!product || product.status !== 'published') throw conflict('Одна из вещей уже недоступна', 'unavailable');
        const variant = product.variants.find((v) => v.id === (item.variantId || product.variants[0]?.id));
        if (!variant) throw badRequest('Выберите доступный размер');
        return { product, variant, quantity: item.quantity };
      });
      if (new Set(lines.map((l) => l.variant.id)).size !== lines.length) throw badRequest('Повторяющиеся позиции в корзине');
      for (const line of lines) await reserveVariant(tx, line.variant.id, line.quantity);
      const total = lines.reduce((sum, line) => sum + line.product.priceAmount * line.quantity, 0);
      if (total > 2_000_000_000) throw badRequest('Сумма заказа слишком большая');
      const first = lines[0];

      const created = await tx.order.create({
        data: {
          publicNumber: publicNumber(),
          storeId: req.store!.id,
          productId: first.product.id,
          buyerId: user.id,
          productTitleSnapshot: lines.length === 1 ? first.product.title : `${first.product.title} и ещё ${lines.length - 1}`,
          priceAmountSnapshot: total,
          buyerName: data.buyerName,
          buyerUsername: req.auth!.username ?? null,
          buyerPhone: data.buyerPhone ?? null,
          buyerEmail: data.buyerEmail ?? null,
          city: cdekPoint?.city || data.city || null,
          deliveryAddress: cdekPoint?.address ?? option?.address ?? data.deliveryAddress ?? null,
          deliveryPoint: cdekPoint?.name ?? option?.point ?? null,
          deliveryPointCode: cdekPoint?.code ?? null,
          deliveryCityCode: cdekPoint?.cityCode ?? null,
          deliveryTariff: data.deliveryMethod === 'cdek' && !cdekQuote ? 'Ручное оформление' : cdekQuote?.tariffName ?? option?.tariff ?? null,
          deliveryPriceAmount: data.deliveryMethod === 'cdek' && !cdekQuote ? null : cdekQuote ? Math.round(cdekQuote.price * 100) : option ? Math.round(option.price * 100) : null,
          deliveryLat: cdekPoint?.lat ?? option?.lat ?? null,
          deliveryLon: cdekPoint?.lon ?? option?.lon ?? null,
          deliveryMethod: data.deliveryMethod,
          comment: data.comment ?? null,
          personalDataConsentAt: new Date(),
          termsAcceptedAt: new Date(),
          legalVersion: legalVersion(req.store!),
          status: 'pending',
          reservedUntil,
          items: { create: lines.map((line) => ({ productId: line.product.id, variantId: line.variant.id, titleSnapshot: line.product.title, sizeSnapshot: line.variant.size, priceAmountSnapshot: line.product.priceAmount, quantity: line.quantity })) },
        },
        include: { items: true },
      });

      await tx.orderStatusHistory.create({
        data: { orderId: created.id, oldStatus: null, newStatus: 'pending', changedByUserId: user.id },
      });

      await syncProductStatus(tx, ids);
      return created;
    });

    logEvent({ storeId: req.store!.id, userId: user.id, productId: order.productId, type: 'order_created', meta: { orderId: order.id } });

    // уведомления (§8) — не в транзакции, best-effort
    const store = await prisma.store.findUnique({
      where: { id: req.store!.id },
      include: { members: { where: { role: 'owner' }, include: { user: true }, take: 1 } },
    });
    const owner = store?.members[0]?.user;
    if (owner) {
      notifySeller.newOrder(owner.telegramId, order.publicNumber, order.productTitleSnapshot, data.buyerName, req.store!.slug);
    }
    notifyBuyer.orderCreated(user.telegramId, order.publicNumber, order.productTitleSnapshot, req.store!.slug);

    res.status(201).json({ order: presentOrder(order) });
  }),
);
// GET /api/orders — история заказов покупателя (§6.8)
ordersRouter.get(
  '/',
  h(async (req, res) => {
    const orders = await prisma.order.findMany({
      where: { buyerId: req.auth!.user.id, storeId: req.store!.id },
      orderBy: { createdAt: 'desc' },
      include: {
        product: { include: { images: { orderBy: { sortOrder: 'asc' }, take: 1 } } },
        history: { orderBy: { createdAt: 'asc' } },
        items: true,
        shipment: true,
        review: { select: { id: true } },
      },
    });
    const paymentDetails = (req.store!.settings as Record<string, unknown>).paymentDetails as string | undefined;
    res.json({ items: orders.map((o) => presentOrder(o, paymentDetails)) });
  }),
);

ordersRouter.post('/:id/receipt', receiptLimiter, receiptUpload.single('file'), h(async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, buyerId: req.auth!.user.id, storeId: req.store!.id } });
  if (!order) throw notFound('Заказ не найден');
  if (order.status !== 'confirmed' || order.paymentConfirmedAt) throw badRequest('Сейчас загрузить чек нельзя');
  if (order.deliveryMethod === 'cdek' && order.deliveryPriceAmount == null) throw badRequest('Сначала дождитесь согласования стоимости доставки');
  const file = req.file;
  if (!file) throw badRequest('Выберите фото или PDF');
  await fs.mkdir(receiptDir, { recursive: true, mode: 0o700 });
  const disk = await fs.statfs(receiptDir);
  if (disk.bavail * disk.bsize < 1024 ** 3 + file.size) throw badRequest('Недостаточно места для чека');
  let buffer: Buffer;
  let ext: string;
  if (file.mimetype === 'application/pdf') {
    if (file.buffer.subarray(0, 5).toString() !== '%PDF-') throw badRequest('Это не PDF-файл');
    buffer = file.buffer;
    ext = 'pdf';
  } else {
    try { buffer = await sharp(file.buffer, { failOn: 'error' }).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer(); }
    catch { throw badRequest('Не удалось прочитать фото чека'); }
    ext = 'webp';
  }
  const filename = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(receiptDir, filename), buffer, { flag: 'wx', mode: 0o600 });
  try {
    const saved = await prisma.order.updateMany({ where: { id: order.id, status: 'confirmed', paymentConfirmedAt: null, OR: [{ reservedUntil: { gt: new Date() } }, { receiptSubmittedAt: { not: null } }] }, data: { receiptFilename: filename, receiptSubmittedAt: new Date(), receiptReviewRemindedAt: null } });
    if (!saved.count) throw conflict('Бронь уже завершилась. Обновите заказ перед отправкой чека');
  }
  catch (error) { await fs.unlink(path.join(receiptDir, filename)).catch(() => undefined); throw error; }
  if (order.receiptFilename) await fs.unlink(path.join(receiptDir, order.receiptFilename)).catch(() => undefined);
  const owners = await prisma.storeMember.findMany({ where: { storeId: order.storeId, role: 'owner' }, include: { user: true } });
  for (const owner of owners) notifySeller.paymentReceipt(owner.user.telegramId, order.publicNumber, req.store!.slug);
  res.json({ ok: true });
}));

ordersRouter.get('/:id/receipt', h(async (req, res) => {
  const order = await prisma.order.findFirst({ where: { id: req.params.id, storeId: req.store!.id } });
  if (!order?.receiptFilename) throw notFound('Чек не найден');
  if (order.buyerId !== req.auth!.user.id) {
    const member = await prisma.storeMember.findUnique({ where: { storeId_userId: { storeId: req.store!.id, userId: req.auth!.user.id } } });
    if (!member) throw notFound('Чек не найден');
  }
  const filename = path.basename(order.receiptFilename);
  if (!/^[\w-]+\.(?:pdf|webp)$/.test(filename)) throw notFound('Чек не найден');
  res.setHeader('Content-Type', filename.endsWith('.pdf') ? 'application/pdf' : 'image/webp');
  res.setHeader('Content-Disposition', `attachment; filename="receipt.${filename.endsWith('.pdf') ? 'pdf' : 'webp'}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(await fs.readFile(path.join(receiptDir, filename)));
}));
