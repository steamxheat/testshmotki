import { bot, webAppButton } from './bot.js';

/**
 * Отправка уведомления пользователю через бота (§8).
 * Если бот не настроен (нет токена) или пользователь не нажимал /start —
 * тихо игнорируем (уведомления best-effort, не должны ломать основной поток).
 */
async function send(
  telegramId: bigint | number,
  text: string,
  button?: { text: string; path: string },
): Promise<void> {
  if (!bot) {
    console.log(`[notify:mock] → ${telegramId}: ${text}`);
    return;
  }
  try {
    await bot.api.sendMessage(Number(telegramId), text, {
      parse_mode: 'HTML',
      reply_markup: button ? webAppButton(button.text, button.path) : undefined,
    });
  } catch (e) {
    // пользователь мог не запускать бота — это не ошибка приложения
    console.warn(`[notify] не удалось отправить ${telegramId}:`, (e as Error).message);
  }
}

// ---- покупателю (§8) ----

export const notifyBuyer = {
  orderCreated: (tgId: bigint, n: string, title: string) =>
    send(tgId, `✅ Заявка <b>#${n}</b> создана: «${title}». Товар забронирован на 24 часа.`, {
      text: 'Мои заказы',
      path: '/orders',
    }),
  orderConfirmed: (tgId: bigint, n: string) =>
    send(tgId, `🎉 Продавец принял заявку <b>#${n}</b>. Свяжитесь, чтобы договориться.`, {
      text: 'К заказу',
      path: '/orders',
    }),
  orderRejected: (tgId: bigint, n: string) =>
    send(tgId, `❌ Заявка <b>#${n}</b> отклонена продавцом.`, { text: 'Мои заказы', path: '/orders' }),
  reservationExpiringSoon: (tgId: bigint, n: string) =>
    send(tgId, `⏳ Бронь по заявке <b>#${n}</b> скоро истечёт.`, { text: 'К заказу', path: '/orders' }),
  orderCompleted: (tgId: bigint, n: string) =>
    send(tgId, `🤝 Заказ <b>#${n}</b> завершён. Спасибо! Можно оставить отзыв.`, {
      text: 'Оставить отзыв',
      path: '/orders',
    }),
};

// ---- продавцу (§8) ----

export const notifySeller = {
  newOrder: (tgId: bigint, n: string, title: string, buyer: string, contact: string) =>
    send(
      tgId,
      `🆕 Новая заявка <b>#${n}</b>\nТовар: «${title}»\nПокупатель: ${buyer}\nКонтакт: ${contact}`,
      { text: 'Открыть заявку', path: '/admin/orders' },
    ),
  orderCancelled: (tgId: bigint, n: string) =>
    send(tgId, `↩️ Покупатель отменил заявку <b>#${n}</b>.`, {
      text: 'Заявки',
      path: '/admin/orders',
    }),
  reservationExpiringSoon: (tgId: bigint, n: string) =>
    send(tgId, `⏳ Бронь по заявке <b>#${n}</b> скоро истечёт.`, {
      text: 'Заявки',
      path: '/admin/orders',
    }),
  newReview: (tgId: bigint, rating: number) =>
    send(tgId, `⭐ Новый отзыв (${rating}/5) в вашем магазине.`, {
      text: 'Отзывы',
      path: '/admin/reviews',
    }),
  newQuestion: (tgId: bigint, title: string, buyer: string) =>
    send(tgId, `💬 Вопрос по товару «${title}» от ${buyer}.`, {
      text: 'Открыть',
      path: '/admin/orders',
    }),
};
