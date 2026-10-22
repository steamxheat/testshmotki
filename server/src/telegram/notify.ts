import { bot, webAppButton } from './bot.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import type { Product, ProductVariant } from '@prisma/client';

/**
 * Отправка уведомления пользователю через бота (§8).
 * Очередь сохраняет уведомление до отправки и повторяет временные сбои Telegram.
 * Она не должна ломать основной сценарий заказа.
 */
async function send(
  telegramId: bigint | number,
  text: string,
  button?: { text: string; path: string; storeSlug?: string },
): Promise<void> {
  if (!bot) {
    return;
  }
  try {
    const item = await prisma.botNotification.create({ data: {
      telegramId: BigInt(telegramId), body: text, buttonText: button?.text,
      buttonPath: button?.path, storeSlug: button?.storeSlug,
    } });
    await deliverNotification(item.id);
  } catch (e) {
    console.error('[notify] не удалось сохранить уведомление:', (e as Error).message);
  }
}

async function deliverNotification(id: string): Promise<void> {
  if (!bot) return;
  const now = new Date();
  const claimed = await prisma.botNotification.updateMany({
    where: { id, sentAt: null, attempts: { lt: 8 }, nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    data: { attempts: { increment: 1 }, lockedUntil: new Date(now.getTime() + 120_000) },
  });
  if (!claimed.count) return;
  const item = await prisma.botNotification.findUniqueOrThrow({ where: { id } });
  try {
    await bot.api.sendMessage(Number(item.telegramId), item.body, {
      parse_mode: 'HTML',
      reply_markup: item.buttonText && item.buttonPath ? webAppButton(item.buttonText, item.buttonPath, item.storeSlug ?? undefined) : undefined,
    });
    await prisma.botNotification.update({ where: { id }, data: { sentAt: new Date(), lockedUntil: null, error: null } });
  } catch (e) {
    const error = (e as Error).message.slice(0, 300);
    const permanent = /bot was blocked|user is deactivated|chat not found/i.test(error);
    await prisma.botNotification.update({ where: { id }, data: {
      lockedUntil: null, error,
      nextAttemptAt: new Date(Date.now() + Math.min(2 ** item.attempts * 60_000, 6 * 3600_000)),
      ...(permanent ? { attempts: 8 } : {}),
    } });
    console.warn('[notify] Telegram не принял уведомление:', error);
  }
}

export async function deliverPendingNotifications(): Promise<void> {
  if (!bot) return;
  const now = new Date();
  const pending = await prisma.botNotification.findMany({
    where: { sentAt: null, attempts: { lt: 8 }, nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
    orderBy: { createdAt: 'asc' }, take: 50, select: { id: true },
  });
  for (const item of pending) await deliverNotification(item.id);
}

export async function queueProductAlert(
  product: Product & { variants: ProductVariant[] },
  store: { name: string; slug: string },
  kind: 'newArrivals' | 'priceDrops',
  currency: 'RUB' | 'BYN' | 'USD',
): Promise<void> {
  let cursor: string | undefined;
  const sizes = new Set(product.variants.map((variant) => variant.size.toLowerCase()));
  const symbol = currency === 'USD' ? '$' : currency === 'BYN' ? 'Br' : '₽';
  const price = `${(product.priceAmount / 100).toLocaleString('ru-RU')} ${symbol}`;
  const body = kind === 'newArrivals'
    ? `Новинка в магазине «${escapeHtml(store.name)}»: <b>${escapeHtml(product.title)}</b> — ${price}.`
    : `Снижена цена в магазине «${escapeHtml(store.name)}»: <b>${escapeHtml(product.title)}</b> — теперь ${price}.`;
  do {
    const page = await prisma.productSubscription.findMany({
      where: { storeId: product.storeId, [kind]: true },
      include: { user: { select: { telegramId: true } } },
      orderBy: { id: 'asc' }, take: 200,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!page.length) break;
    const recipients = page.filter((subscription) => {
      if (!subscription.categoryIds.length && !subscription.brands.length && !subscription.sizes.length) return true;
      return Boolean(
        (product.categoryId && subscription.categoryIds.includes(product.categoryId)) ||
        (product.brand && subscription.brands.some((brand) => brand.toLowerCase() === product.brand!.toLowerCase())) ||
        subscription.sizes.some((size) => sizes.has(size.toLowerCase())),
      );
    });
    if (recipients.length) await prisma.botNotification.createMany({ data: recipients.map((subscription) => ({
      telegramId: subscription.user.telegramId, body, buttonText: 'Открыть товар',
      buttonPath: `/product/${product.id}`, storeSlug: store.slug,
    })) });
    cursor = page.length === 200 ? page[page.length - 1].id : undefined;
  } while (cursor);
}

// ---- покупателю (§8) ----

export const notifyBuyer = {
  orderCreated: (tgId: bigint, n: string, title: string, storeSlug?: string) =>
    send(tgId, `Заявка <b>#${n}</b> создана: «${escapeHtml(title)}». Товар забронирован на ${config.reservationHours} ч.`, {
      text: 'Мои заказы',
      path: '/orders', storeSlug,
    }),
  orderConfirmed: (tgId: bigint, n: string, storeSlug?: string) =>
    send(tgId, `Продавец принял заявку <b>#${n}</b>. На оплату и отправку чека есть ${config.reservationHours} ч. Реквизиты откройте в заказе.`, {
      text: 'К заказу',
      path: '/orders', storeSlug,
    }),
  deliveryAwaitingPrice: (tgId: bigint, n: string, storeSlug?: string) =>
    send(tgId, `Продавец принял заявку <b>#${n}</b>. Стоимость доставки СДЭК согласуют отдельно; пока не переводите деньги.`, { text: 'К заказу', path: '/orders', storeSlug }),
  orderRejected: (tgId: bigint, n: string, storeSlug?: string) =>
    send(tgId, `Заявка <b>#${n}</b> отклонена продавцом.`, { text: 'Мои заказы', path: '/orders', storeSlug }),
  reservationExpiringSoon: (tgId: bigint, n: string, storeSlug?: string) =>
    send(tgId, `Бронь по заявке <b>#${n}</b> скоро истечёт.`, { text: 'К заказу', path: '/orders', storeSlug }),
  reservationExpired: (tgId: bigint, n: string, storeSlug?: string) =>
    send(tgId, `Бронь по заявке <b>#${n}</b> истекла. Вещи снова доступны в магазине.`, { text: 'Мои заказы', path: '/orders', storeSlug }),
  orderCompleted: (tgId: bigint, n: string, storeSlug?: string) =>
    send(tgId, `Заказ <b>#${n}</b> завершён. Спасибо! Можно оставить отзыв.`, {
      text: 'Оставить отзыв',
      path: '/orders', storeSlug,
    }),
  orderSent: (tgId: bigint, n: string, tracking: string, storeSlug?: string) =>
    send(tgId, `Заказ <b>#${n}</b> передан перевозчику. Трек-номер: <b>${escapeHtml(tracking)}</b>.`, { text: 'Открыть заказ', path: '/orders', storeSlug }),
  orderRefunded: (tgId: bigint, n: string, storeSlug?: string) =>
    send(tgId, `Продавец отметил возврат средств по заказу <b>#${n}</b>. Если деньги не поступили, напишите продавцу в чате.`, { text: 'Открыть заказ', path: '/orders', storeSlug }),
  paymentRejected: (tgId: bigint, n: string, reason: string, storeSlug?: string) =>
    send(tgId, `Продавец не подтвердил получение денег по заказу <b>#${n}</b> и закрыл заявку. Причина: ${escapeHtml(reason)}. Если перевод был выполнен, напишите продавцу в чате и приложите подтверждение.`, { text: 'Открыть заказ', path: '/orders', storeSlug }),
  paymentConfirmed: (tgId: bigint, n: string, storeSlug?: string) =>
    send(tgId, `Продавец подтвердил получение оплаты по заказу <b>#${n}</b>.`, { text: 'Открыть заказ', path: '/orders', storeSlug }),
  deliveryPriceSet: (tgId: bigint, n: string, total: number, storeSlug?: string, currency: 'RUB' | 'BYN' | 'USD' = 'RUB') =>
    send(tgId, `Продавец согласовал доставку СДЭК по заказу <b>#${n}</b>. Итого с доставкой: <b>${total.toLocaleString('ru-RU')} ${currency === 'USD' ? '$' : currency === 'BYN' ? 'Br' : '₽'}</b>. Проверьте заказ перед переводом.`, { text: 'К заказу', path: '/orders', storeSlug }),
  shipmentRegistered: (tgId: bigint, n: string, tracking: string, storeSlug?: string) =>
    send(tgId, `Отправление СДЭК по заказу <b>#${n}</b> оформлено. Трек-номер: <b>${escapeHtml(tracking)}</b>.`, { text: 'Открыть заказ', path: '/orders', storeSlug }),
  shipmentRegisteredManual: (tgId: bigint, n: string, tracking: string, storeSlug?: string) =>
    send(tgId, `Продавец указал трек-номер по заказу <b>#${n}</b>: <b>${escapeHtml(tracking)}</b>.`, { text: 'Открыть заказ', path: '/orders', storeSlug }),
  newChatMessage: (tgId: bigint, storeName: string, storeSlug: string) =>
    send(tgId, `Новое сообщение от магазина «${escapeHtml(storeName)}».`, { text: 'Открыть чат', path: '/chat', storeSlug }),
};

// ---- продавцу (§8) ----

export const notifySeller = {
  paymentReviewReminder: (tgId: bigint, n: string, storeSlug?: string) =>
    send(tgId, `Чек по заказу <b>#${n}</b> всё ещё ждёт проверки. Подтвердите получение денег или укажите, что платёж не поступил.`, { text: 'Проверить заказ', path: '/admin/orders', storeSlug }),
  paymentReceipt: (tgId: bigint, n: string, storeSlug?: string) =>
    send(tgId, `Покупатель приложил чек по заказу <b>#${n}</b>. Проверьте поступление денег.`, { text: 'Открыть заказ', path: '/admin/orders', storeSlug }),
  newChatMessage: (tgId: bigint, storeName: string, storeSlug: string, buyerId: string) =>
    send(tgId, `Новое сообщение покупателя в магазине «${escapeHtml(storeName)}».`, { text: 'Открыть чат', path: `/admin/chats/${buyerId}`, storeSlug }),
  newOrder: (tgId: bigint, n: string, title: string, buyer: string, storeSlug?: string) =>
    send(
      tgId,
      `Новая заявка <b>#${n}</b>\nТовар: «${escapeHtml(title)}»\nПокупатель: ${escapeHtml(buyer)}\nОтветить можно в приложении.`,
      { text: 'Открыть заявку', path: '/admin/orders', storeSlug },
    ),
  orderCancelled: (tgId: bigint, n: string) =>
    send(tgId, `Покупатель отменил заявку <b>#${n}</b>.`, {
      text: 'Заявки',
      path: '/admin/orders',
    }),
  reservationExpiringSoon: (tgId: bigint, n: string, storeSlug?: string) =>
    send(tgId, `Бронь по заявке <b>#${n}</b> скоро истечёт.`, {
      text: 'Заявки',
      path: '/admin/orders', storeSlug,
    }),
  reservationExpired: (tgId: bigint, n: string, storeSlug?: string) =>
    send(tgId, `Бронь по заявке <b>#${n}</b> истекла, остаток освобождён.`, { text: 'Заявки', path: '/admin/orders', storeSlug }),
  newReview: (tgId: bigint, rating: number, storeSlug?: string) =>
    send(tgId, `Новый отзыв (${rating}/5) в вашем магазине.`, {
      text: 'Отзывы',
      path: '/admin/reviews', storeSlug,
    }),
  newQuestion: (tgId: bigint, title: string, buyer: string) =>
    send(tgId, `Вопрос по товару «${title}» от ${buyer}.`, {
      text: 'Открыть',
      path: '/admin/orders',
    }),
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
