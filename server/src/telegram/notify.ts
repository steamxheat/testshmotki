import { bot, webAppButton } from './bot.js';
import { config } from '../config.js';

/**
 * Отправка уведомления пользователю через бота (§8).
 * Если бот не настроен (нет токена) или пользователь не нажимал /start —
 * тихо игнорируем (уведомления best-effort, не должны ломать основной поток).
 */
async function send(
  telegramId: bigint | number,
  text: string,
  button?: { text: string; path: string; storeSlug?: string },
): Promise<void> {
  if (!bot) {
    console.log(`[notify:mock] → ${telegramId}: ${text}`);
    return;
  }
  try {
    await bot.api.sendMessage(Number(telegramId), text, {
      parse_mode: 'HTML',
      reply_markup: button ? webAppButton(button.text, button.path, button.storeSlug) : undefined,
    });
  } catch (e) {
    // пользователь мог не запускать бота — это не ошибка приложения
    console.warn(`[notify] не удалось отправить ${telegramId}:`, (e as Error).message);
  }
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
  paymentConfirmed: (tgId: bigint, n: string, storeSlug?: string) =>
    send(tgId, `Продавец подтвердил получение оплаты по заказу <b>#${n}</b>.`, { text: 'Открыть заказ', path: '/orders', storeSlug }),
  shipmentRegistered: (tgId: bigint, n: string, tracking: string, storeSlug?: string) =>
    send(tgId, `Отправление СДЭК по заказу <b>#${n}</b> оформлено. Трек-номер: <b>${escapeHtml(tracking)}</b>.`, { text: 'Открыть заказ', path: '/orders', storeSlug }),
  newChatMessage: (tgId: bigint, storeName: string, storeSlug: string) =>
    send(tgId, `Новое сообщение от магазина «${escapeHtml(storeName)}».`, { text: 'Открыть чат', path: '/chat', storeSlug }),
};

// ---- продавцу (§8) ----

export const notifySeller = {
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
