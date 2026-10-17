import { Bot, InlineKeyboard } from 'grammy';
import { config } from '../config.js';

// Единый экземпляр бота. Если токен не задан (локальная разработка без Telegram) —
// бот не создаётся, а уведомления становятся no-op (см. notify.ts).
export const bot = config.botToken ? new Bot(config.botToken) : null;

export function startParamFor(slug: string): string {
  return `store_${slug}`;
}

export function storeDeepLink(slug: string): string {
  return `https://t.me/${config.botUsername}/app?startapp=${startParamFor(slug)}`;
}

/** Кнопка, открывающая нужный экран Mini App (§8). */
export function webAppButton(text: string, path: string): InlineKeyboard {
  const url = `${config.webappUrl}${path.startsWith('/') ? path : `/${path}`}`;
  return new InlineKeyboard().url(text, url);
}

export function initBot(): void {
  if (!bot) {
    console.warn('[bot] BOT_TOKEN не задан — бот и уведомления отключены');
    return;
  }

  bot.command('start', async (ctx) => {
    const payload = ctx.match?.trim();
    const keyboard = new InlineKeyboard();
    if (payload && payload.startsWith('store_')) {
      const slug = payload.slice('store_'.length);
      keyboard.webApp('🛍 Открыть магазин', `${config.webappUrl}/?startapp=${payload}`);
      await ctx.reply(`Магазин «${slug}» открывается в приложении 👇`, {
        reply_markup: keyboard,
      });
      return;
    }
    keyboard.webApp('🛍 Открыть Шмотки', config.webappUrl);
    await ctx.reply(
      'Привет! Это Шмотки — витрины продавцов прямо в Telegram.\n' +
        'Откройте приложение кнопкой ниже.',
      { reply_markup: keyboard },
    );
  });

  bot.catch((err) => {
    console.error('[bot] error', err.error);
  });

  if (config.botPolling) {
    bot.start({ onStart: (i) => console.log(`[bot] @${i.username} запущен (polling)`) });
  }
}
